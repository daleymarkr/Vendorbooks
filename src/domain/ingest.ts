import { resolveAttribution, type AttributionCatalog } from "./attribution";
import { moneyAmount, periodYm, prorate, quantityMicros, stableHash, addMonthsYm } from "./money";
import { computeLineEconomics, feeSharesForLines, recomputeEarn, serviceChargeDisposition } from "./payout";
import type {
  FeeMode,
  LedgerLine,
  PayoutSettings,
  SquareOrder,
  SquareOrderLine,
  SquarePayment,
  SquareReturnLine,
  StatementStatus,
} from "./types";

export type IngestContext = {
  shopId: string;
  timezone: string;
  settings: PayoutSettings;
  locationIdBySquareId: Record<string, string>;
  catalog: AttributionCatalog;
  /** Existing ledger lines for this shop, used to reverse itemized refunds. */
  priorLines: LedgerLine[];
  /** statement id → status, so closed periods are not rewritten. */
  statementStatus: Record<string, StatementStatus | undefined>;
  /** Vendor id → period YMs that already have an approved or paid statement. */
  closedPeriods: Record<string, string[]>;
  payments: SquarePayment[];
  nowIso?: string;
};

export type IngestOutcome = {
  lines: LedgerLine[];
  unassigned: { naturalKey: string; reason: string }[];
  orderTotalCents: number;
  orderCurrency: string;
};

const LOCKED: StatementStatus[] = ["approved", "paid"];

export function ingestOrder(order: SquareOrder, ctx: IngestContext): IngestOutcome {
  const soldAt = order.closed_at || order.created_at || ctx.nowIso || new Date().toISOString();
  const payments = ctx.payments.filter((payment) => !payment.order_id || payment.order_id === order.id);
  const completed = payments.filter((payment) => !payment.status || payment.status === "COMPLETED");
  const feeTotal = completed.reduce((sum, payment) => {
    const fees = payment.processing_fee ?? [];
    return sum + fees.reduce((inner, fee) => inner + (fee.amount_money?.amount ?? 0), 0);
  }, 0);
  const tipTotal = completed.reduce((sum, payment) => sum + (payment.tip_money?.amount ?? 0), 0);
  const offline = payments.some((payment) => payment.is_offline_payment === true);
  const paymentId = completed[0]?.id ?? payments[0]?.id ?? null;
  const locationId = order.location_id ? ctx.locationIdBySquareId[order.location_id] ?? null : null;
  const currency = (order.total_money?.currency ?? order.line_items?.[0]?.gross_sales_money?.currency ?? "USD").toUpperCase();

  const rawLines = order.line_items ?? [];
  const prelim = rawLines.map((line, index) => prepareSale(line, index, currency));
  const basesForFee = prelim.map((line) => Math.max(0, line.grossCents - line.discountCents));
  const feeShares = feeSharesForLines(basesForFee, feeTotal);
  const tipShares = feeSharesForLines(basesForFee, tipTotal);
  const serviceShares = apportionServiceCharges(order, prelim.map((line) => line.grossCents), ctx);

  const drafts: LedgerLine[] = [];
  const unassigned: { naturalKey: string; reason: string }[] = [];

  prelim.forEach((line, index) => {
    const attr = line.customAmount
      ? { vendorId: null as string | null, source: "unassigned" as const }
      : resolveAttribution(
          {
            catalogObjectId: line.catalogObjectId,
            itemName: line.itemName,
            sku: line.sku,
            categoryName: line.categoryName,
          },
          ctx.catalog,
        );
    const vendor = attr.vendorId ? ctx.catalog.vendors.find((row) => row.id === attr.vendorId) : undefined;
    const serviceChargeCents = serviceShares.byLine[index] ?? 0;
    const economics = computeLineEconomics({
      grossCents: line.grossCents,
      discountCents: line.discountCents,
      taxCents: line.taxCents,
      tipCents: tipShares[index] ?? 0,
      feeCents: feeShares[index] ?? 0,
      serviceChargeCents,
      commissionBps: vendor && !line.customAmount && currency === "USD" ? vendor.commissionBps : null,
      settings: ctx.settings,
    });
    const reason = line.customAmount ? "custom_amount" : currency !== "USD" ? "non_usd" : !attr.vendorId ? "unattributed" : null;
    const draft = makeLine({
      ctx,
      orderId: order.id,
      uid: line.uid,
      locationId,
      vendorId: reason ? null : attr.vendorId,
      catalogObjectId: line.catalogObjectId,
      catalogVersion: line.catalogVersion,
      lineKind: "sale",
      soldAt,
      quantity: line.quantity,
      grossCents: line.grossCents,
      discountCents: line.discountCents,
      taxCents: line.taxCents,
      tipCents: tipShares[index] ?? 0,
      feeCents: feeShares[index] ?? 0,
      serviceChargeCents,
      baseCents: currency === "USD" ? economics.baseCents : 0,
      vendorEarnCents: reason ? 0 : economics.vendorEarnCents,
      commissionBps: vendor?.commissionBps ?? null,
      attributionSource: reason ? "unassigned" : attr.source,
      isOffline: offline,
      paymentId,
      itemName: line.itemName,
      currency,
      sourceOrderId: null,
      sourceLineUid: null,
    });
    drafts.push(draft);
    if (reason) unassigned.push({ naturalKey: naturalKey(draft), reason });
  });

  for (const ret of order.returns ?? []) {
    const sourceOrderId = ret.source_order_id ?? order.id;
    (ret.return_line_items ?? []).forEach((rline, index) => {
      const built = buildRefundLine({
        rline,
        index,
        order,
        sourceOrderId,
        ctx,
        soldAt,
        locationId,
        offline,
        paymentId,
        drafts,
      });
      drafts.push(built.line);
      if (built.reason) unassigned.push({ naturalKey: naturalKey(built.line), reason: built.reason });
    });
  }

  const vendorService = serviceShares.vendorLines;
  vendorService.forEach((extra, index) => {
    const vendor = ctx.catalog.vendors.find((row) => row.id === extra.vendorId);
    const economics = computeLineEconomics({
      grossCents: extra.amountCents,
      discountCents: 0,
      taxCents: 0,
      tipCents: 0,
      feeCents: 0,
      commissionBps: vendor?.commissionBps ?? null,
      settings: ctx.settings,
    });
    drafts.push(
      makeLine({
        ctx,
        orderId: order.id,
        uid: `service:${index}:${extra.name}`,
        locationId,
        vendorId: extra.vendorId,
        catalogObjectId: null,
        catalogVersion: null,
        lineKind: "adjustment",
        soldAt,
        quantity: "1",
        grossCents: extra.amountCents,
        discountCents: 0,
        taxCents: 0,
        tipCents: 0,
        feeCents: 0,
        serviceChargeCents: extra.amountCents,
        baseCents: economics.baseCents,
        vendorEarnCents: economics.vendorEarnCents,
        commissionBps: vendor?.commissionBps ?? null,
        attributionSource: "manual",
        isOffline: offline,
        paymentId,
        itemName: extra.name,
        currency,
        sourceOrderId: order.id,
        sourceLineUid: null,
      }),
    );
  });

  return {
    lines: drafts,
    unassigned,
    orderTotalCents: order.total_money?.amount ?? 0,
    orderCurrency: currency,
  };
}

/**
 * A later payment.updated webhook can carry the processing fee and tip.
 * Locked statement lines are left alone; the caller records an adjustment
 * when the earn delta is non-zero on a locked line.
 */
export function applyPaymentsToLines(lines: LedgerLine[], payments: SquarePayment[], settings: PayoutSettings): {
  lines: LedgerLine[];
  adjustments: LedgerLine[];
} {
  const byOrder = new Map<string, LedgerLine[]>();
  for (const line of lines) {
    const list = byOrder.get(line.squareOrderId) ?? [];
    list.push(line);
    byOrder.set(line.squareOrderId, list);
  }
  const adjustments: LedgerLine[] = [];
  const next = lines.map((line) => ({ ...line }));

  for (const [orderId, group] of byOrder) {
    const related = payments.filter((payment) => payment.order_id === orderId);
    if (related.length === 0) continue;
    const completed = related.filter((payment) => !payment.status || payment.status === "COMPLETED");
    const feeTotal = completed.reduce(
      (sum, payment) => sum + (payment.processing_fee ?? []).reduce((inner, fee) => inner + (fee.amount_money?.amount ?? 0), 0),
      0,
    );
    const tipTotal = completed.reduce((sum, payment) => sum + (payment.tip_money?.amount ?? 0), 0);
    const offline = related.some((payment) => payment.is_offline_payment === true);
    const sales = group.filter((line) => line.lineKind === "sale");
    const shares = feeSharesForLines(
      sales.map((line) => Math.max(0, line.grossCents - line.discountCents)),
      feeTotal,
    );
    const tips = feeSharesForLines(
      sales.map((line) => Math.max(0, line.grossCents - line.discountCents)),
      tipTotal,
    );
    sales.forEach((sale, index) => {
      const target = next.find((line) => line.id === sale.id);
      if (!target) return;
      const fee = shares[index] ?? 0;
      const tip = tips[index] ?? 0;
      const economics = computeLineEconomics({
        grossCents: target.grossCents,
        discountCents: target.discountCents,
        taxCents: target.taxCents,
        tipCents: tip,
        feeCents: fee,
        serviceChargeCents: target.serviceChargeCents,
        commissionBps: target.vendorId ? target.commissionBps : null,
        settings: { ...settings, feeMode: target.feeMode },
      });
      const locked = isLocked(target);
      if (!locked) {
        target.feeCents = fee;
        target.tipCents = tip;
        target.baseCents = economics.baseCents;
        target.vendorEarnCents = target.vendorId ? economics.vendorEarnCents : 0;
        target.isOffline = offline || target.isOffline;
        target.squarePaymentId = completed[0]?.id ?? target.squarePaymentId;
        target.rawHash = hashLine(target);
      } else if (target.vendorId && economics.vendorEarnCents !== target.vendorEarnCents) {
        adjustments.push(deltaAdjustment(target, economics.vendorEarnCents - target.vendorEarnCents, completed[0]?.id ?? null));
      }
    });
  }
  return { lines: next, adjustments };
}

export function mergeLines(existing: LedgerLine[], incoming: LedgerLine[], statementStatus: Record<string, StatementStatus | undefined>): LedgerLine[] {
  const out = existing.map((line) => ({ ...line }));
  for (const line of incoming) {
    const idx = out.findIndex((row) => sameLine(row, line));
    if (idx === -1) {
      out.push(line);
      continue;
    }
    const prev = out[idx];
    if (prev.rawHash === line.rawHash) continue;
    if (isLocked(prev, statementStatus)) {
      const delta = line.vendorEarnCents - prev.vendorEarnCents;
      if (delta !== 0) {
        const adjUid = `${line.squareLineUid}:delta:${line.rawHash.slice(0, 8)}`;
        if (!out.some((row) => row.squareOrderId === line.squareOrderId && row.squareLineUid === adjUid && row.lineKind === "adjustment")) {
          out.push({
            ...line,
            id: crypto.randomUUID(),
            squareLineUid: adjUid,
            lineKind: "adjustment",
            grossCents: line.grossCents - prev.grossCents,
            discountCents: line.discountCents - prev.discountCents,
            taxCents: line.taxCents - prev.taxCents,
            baseCents: line.baseCents - prev.baseCents,
            vendorEarnCents: delta,
            statementId: null,
            sourceOrderId: prev.squareOrderId,
            sourceLineUid: prev.squareLineUid,
          });
        }
      }
      continue;
    }
    out[idx] = { ...line, id: prev.id, statementId: prev.statementId, createdAt: prev.createdAt };
  }
  return out;
}

function prepareSale(line: SquareOrderLine, index: number, orderCurrency: string) {
  const gross = moneyAmount(line.gross_sales_money ?? line.variation_total_price_money);
  const discountFromApplied = (line.applied_discounts ?? []).reduce((sum, discount) => sum + (discount.applied_money?.amount ?? 0), 0);
  const hasApplied = (line.applied_discounts ?? []).length > 0;
  const discount = hasApplied ? discountFromApplied : (line.total_discount_money?.amount ?? 0);
  const tax = line.total_tax_money?.amount ?? 0;
  const currency = (gross.currency || orderCurrency || "USD").toUpperCase();
  return {
    uid: line.uid || `line:${index}`,
    itemName: line.name ?? null,
    quantity: line.quantity ?? "1",
    catalogObjectId: line.catalog_object_id ?? null,
    catalogVersion: line.catalog_version ?? null,
    sku: line.sku ?? null,
    categoryName: line.category_name ?? null,
    grossCents: gross.amount,
    discountCents: discount,
    taxCents: tax,
    customAmount: (line.item_type ?? "").toUpperCase() === "CUSTOM_AMOUNT",
    currency,
  };
}

function buildRefundLine(args: {
  rline: SquareReturnLine;
  index: number;
  order: SquareOrder;
  sourceOrderId: string;
  ctx: IngestContext;
  soldAt: string;
  locationId: string | null;
  offline: boolean;
  paymentId: string | null;
  drafts: LedgerLine[];
}): { line: LedgerLine; reason: string | null } {
  const { rline, index, order, sourceOrderId, ctx, soldAt, locationId, offline, paymentId, drafts } = args;
  const uid = rline.uid || `return:${index}`;
  const custom = (rline.item_type ?? "").toUpperCase() === "CUSTOM_AMOUNT";
  const source = rline.source_line_item_uid
    ? findSource(ctx.priorLines, drafts, sourceOrderId, rline.source_line_item_uid)
    : undefined;

  if (custom || (!rline.source_line_item_uid && !rline.catalog_object_id && !source)) {
    const gross = rline.gross_return_money?.amount ?? rline.total_money?.amount ?? 0;
    const line = makeLine({
      ctx,
      orderId: order.id,
      uid,
      locationId,
      vendorId: null,
      catalogObjectId: null,
      catalogVersion: null,
      lineKind: "refund",
      soldAt,
      quantity: rline.quantity ?? "1",
      grossCents: -Math.abs(gross),
      discountCents: 0,
      taxCents: -(rline.total_tax_money?.amount ?? 0),
      tipCents: 0,
      feeCents: 0,
      serviceChargeCents: 0,
      baseCents: -Math.abs(gross),
      vendorEarnCents: 0,
      commissionBps: null,
      attributionSource: "unassigned",
      isOffline: offline,
      paymentId,
      itemName: rline.name ?? "Custom amount refund",
      currency: (rline.gross_return_money?.currency ?? "USD").toUpperCase(),
      sourceOrderId,
      sourceLineUid: rline.source_line_item_uid ?? null,
    });
    return { line, reason: custom || !rline.catalog_object_id ? "custom_amount_refund" : "unattributed" };
  }

  if (source) {
    const origQty = Math.max(1, quantityMicros(source.quantity));
    const retQty = quantityMicros(rline.quantity ?? source.quantity);
    const full = retQty === origQty;
    const scale = (amount: number) => (full ? amount : prorate(amount, retQty, origQty));
    const locked = isLocked(source, ctx.statementStatus);
    let period = periodYm(soldAt, ctx.timezone);
    let lineKind: LedgerLine["lineKind"] = locked ? "adjustment" : "refund";
    if (locked && source.vendorId) {
      period = openPeriod(period, ctx.closedPeriods[source.vendorId] ?? []);
    }
    const line = makeLine({
      ctx,
      orderId: order.id,
      uid,
      locationId: source.locationId ?? locationId,
      vendorId: source.vendorId,
      catalogObjectId: source.catalogObjectId,
      catalogVersion: source.catalogVersion,
      lineKind,
      soldAt,
      quantity: rline.quantity ?? source.quantity,
      grossCents: -scale(source.grossCents),
      discountCents: -scale(source.discountCents),
      taxCents: -scale(source.taxCents),
      tipCents: -scale(source.tipCents),
      feeCents: -scale(source.feeCents),
      serviceChargeCents: -scale(source.serviceChargeCents),
      baseCents: -scale(source.baseCents),
      vendorEarnCents: source.vendorId ? -scale(source.vendorEarnCents) : 0,
      commissionBps: source.commissionBps,
      attributionSource: source.attributionSource,
      isOffline: offline,
      paymentId,
      itemName: rline.name ?? source.itemName,
      currency: source.currency,
      sourceOrderId,
      sourceLineUid: source.squareLineUid,
      periodOverride: period,
      feeMode: source.feeMode,
    });
    return { line, reason: source.vendorId ? null : "unattributed" };
  }

  const attr = resolveAttribution(
    { catalogObjectId: rline.catalog_object_id, itemName: rline.name },
    ctx.catalog,
  );
  const gross = rline.gross_return_money?.amount ?? 0;
  const discount = (rline.applied_discounts ?? []).reduce((sum, row) => sum + (row.applied_money?.amount ?? 0), 0) || (rline.total_discount_money?.amount ?? 0);
  const vendor = attr.vendorId ? ctx.catalog.vendors.find((row) => row.id === attr.vendorId) : undefined;
  const economics = computeLineEconomics({
    grossCents: -Math.abs(gross),
    discountCents: -Math.abs(discount),
    taxCents: -(rline.total_tax_money?.amount ?? 0),
    tipCents: 0,
    feeCents: 0,
    commissionBps: vendor?.commissionBps ?? null,
    settings: ctx.settings,
  });
  const line = makeLine({
    ctx,
    orderId: order.id,
    uid,
    locationId,
    vendorId: attr.vendorId,
    catalogObjectId: rline.catalog_object_id ?? null,
    catalogVersion: null,
    lineKind: "refund",
    soldAt,
    quantity: rline.quantity ?? "1",
    grossCents: -Math.abs(gross),
    discountCents: -Math.abs(discount),
    taxCents: -(rline.total_tax_money?.amount ?? 0),
    tipCents: 0,
    feeCents: 0,
    serviceChargeCents: 0,
    baseCents: economics.baseCents,
    vendorEarnCents: attr.vendorId ? economics.vendorEarnCents : 0,
    commissionBps: vendor?.commissionBps ?? null,
    attributionSource: attr.source,
    isOffline: offline,
    paymentId,
    itemName: rline.name ?? null,
    currency: "USD",
    sourceOrderId,
    sourceLineUid: null,
  });
  return { line, reason: attr.vendorId ? null : "unattributed" };
}

function apportionServiceCharges(
  order: SquareOrder,
  grosses: number[],
  ctx: IngestContext,
): { byLine: number[]; vendorLines: { vendorId: string; amountCents: number; name: string }[] } {
  const byLine = grosses.map(() => 0);
  const vendorLines: { vendorId: string; amountCents: number; name: string }[] = [];
  for (const charge of order.service_charges ?? []) {
    const amount = charge.total_money?.amount ?? charge.applied_money?.amount ?? charge.amount_money?.amount ?? 0;
    const name = charge.name ?? "Service charge";
    const disposition = serviceChargeDisposition(name, ctx.settings.serviceChargeMode, ctx.settings.serviceChargeRules);
    if (!disposition.includeInBase || amount === 0) continue;
    if (disposition.vendorId) {
      vendorLines.push({ vendorId: disposition.vendorId, amountCents: amount, name });
      continue;
    }
    const shares = feeSharesForLines(grosses, amount);
    shares.forEach((share, index) => {
      byLine[index] += share;
    });
  }
  return { byLine, vendorLines };
}

function findSource(prior: LedgerLine[], drafts: LedgerLine[], orderId: string, lineUid: string): LedgerLine | undefined {
  return (
    drafts.find((line) => line.squareOrderId === orderId && line.squareLineUid === lineUid && line.lineKind === "sale") ??
    prior.find((line) => line.squareOrderId === orderId && line.squareLineUid === lineUid && line.lineKind === "sale")
  );
}

function openPeriod(start: string, closed: string[]): string {
  let period = start;
  const blocked = new Set(closed);
  while (blocked.has(period)) period = addMonthsYm(period, 1);
  return period;
}

function isLocked(line: LedgerLine, statementStatus?: Record<string, StatementStatus | undefined>): boolean {
  if (!line.statementId) return false;
  if (!statementStatus) return true;
  const status = statementStatus[line.statementId];
  return status != null && LOCKED.includes(status);
}

function deltaAdjustment(source: LedgerLine, deltaEarn: number, paymentId: string | null): LedgerLine {
  const now = new Date().toISOString();
  const uid = `${source.squareLineUid}:paydelta:${stableHash(String(deltaEarn)).slice(0, 8)}`;
  return {
    ...source,
    id: crypto.randomUUID(),
    squareLineUid: uid,
    squarePaymentId: paymentId,
    lineKind: "adjustment",
    grossCents: 0,
    discountCents: 0,
    taxCents: 0,
    tipCents: 0,
    feeCents: 0,
    serviceChargeCents: 0,
    baseCents: 0,
    vendorEarnCents: deltaEarn,
    statementId: null,
    sourceOrderId: source.squareOrderId,
    sourceLineUid: source.squareLineUid,
    itemName: `Payment update for ${source.itemName ?? "item"}`,
    rawHash: stableHash(`${source.id}:${deltaEarn}`),
    createdAt: now,
  };
}

function makeLine(input: {
  ctx: IngestContext;
  orderId: string;
  uid: string;
  locationId: string | null;
  vendorId: string | null;
  catalogObjectId: string | null;
  catalogVersion: number | null;
  lineKind: LedgerLine["lineKind"];
  soldAt: string;
  quantity: string;
  grossCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  feeCents: number;
  serviceChargeCents: number;
  baseCents: number;
  vendorEarnCents: number;
  commissionBps: number | null;
  attributionSource: string | null;
  isOffline: boolean;
  paymentId: string | null;
  itemName: string | null;
  currency: string;
  sourceOrderId: string | null;
  sourceLineUid: string | null;
  periodOverride?: string;
  feeMode?: FeeMode;
}): LedgerLine {
  const now = input.ctx.nowIso ?? new Date().toISOString();
  const line: LedgerLine = {
    id: crypto.randomUUID(),
    shopId: input.ctx.shopId,
    locationId: input.locationId,
    vendorId: input.vendorId,
    squareOrderId: input.orderId,
    squareLineUid: input.uid,
    squarePaymentId: input.paymentId,
    catalogObjectId: input.catalogObjectId,
    catalogVersion: input.catalogVersion,
    lineKind: input.lineKind,
    soldAt: input.soldAt,
    periodYm: input.periodOverride ?? periodYm(input.soldAt, input.ctx.timezone),
    quantity: input.quantity,
    grossCents: input.grossCents,
    discountCents: input.discountCents,
    taxCents: input.taxCents,
    tipCents: input.tipCents,
    feeCents: input.feeCents,
    serviceChargeCents: input.serviceChargeCents,
    baseCents: input.baseCents,
    vendorEarnCents: input.vendorEarnCents,
    commissionBps: input.commissionBps,
    feeMode: input.feeMode ?? input.ctx.settings.feeMode,
    attributionSource: input.attributionSource,
    isOffline: input.isOffline,
    statementId: null,
    sourceOrderId: input.sourceOrderId,
    sourceLineUid: input.sourceLineUid,
    itemName: input.itemName,
    currency: input.currency,
    rawHash: "",
    createdAt: now,
  };
  line.rawHash = hashLine(line);
  line.vendorEarnCents = line.vendorId
    ? recomputeEarn({
        baseCents: line.baseCents,
        commissionBps: line.commissionBps,
        feeCents: line.feeCents,
        feeMode: line.feeMode,
      })
    : 0;
  // Custom-amount and non-USD lines stay at zero earn until an owner allocates them.
  if (!input.vendorId) line.vendorEarnCents = 0;
  else line.vendorEarnCents = input.vendorEarnCents;
  line.rawHash = hashLine(line);
  return line;
}

export function hashLine(line: Pick<
  LedgerLine,
  | "vendorId"
  | "lineKind"
  | "quantity"
  | "grossCents"
  | "discountCents"
  | "taxCents"
  | "tipCents"
  | "feeCents"
  | "serviceChargeCents"
  | "baseCents"
  | "vendorEarnCents"
  | "periodYm"
  | "isOffline"
  | "currency"
>): string {
  return stableHash(
    JSON.stringify([
      line.vendorId,
      line.lineKind,
      line.quantity,
      line.grossCents,
      line.discountCents,
      line.taxCents,
      line.tipCents,
      line.feeCents,
      line.serviceChargeCents,
      line.baseCents,
      line.vendorEarnCents,
      line.periodYm,
      line.isOffline,
      line.currency,
    ]),
  );
}

/** Reprice unlocked sale lines after the owner reopens an unapproved period. */
export function recomputeUnlockedSales(
  lines: LedgerLine[],
  settings: PayoutSettings,
  statementStatus: Record<string, StatementStatus | undefined>,
): LedgerLine[] {
  return lines.map((line) => {
    if (line.lineKind !== "sale") return line;
    if (isLocked(line, statementStatus)) return line;
    const economics = computeLineEconomics({
      grossCents: line.grossCents,
      discountCents: line.discountCents,
      taxCents: line.taxCents,
      tipCents: line.tipCents,
      feeCents: line.feeCents,
      serviceChargeCents: line.serviceChargeCents,
      commissionBps: line.vendorId ? line.commissionBps : null,
      settings,
    });
    const next: LedgerLine = {
      ...line,
      baseCents: economics.baseCents,
      vendorEarnCents: line.vendorId ? economics.vendorEarnCents : 0,
      feeMode: settings.feeMode,
      rawHash: "",
    };
    next.rawHash = hashLine(next);
    return next;
  });
}

export function allocateLine(line: LedgerLine, vendor: { id: string; commissionBps: number } | null): LedgerLine {
  const next: LedgerLine = {
    ...line,
    vendorId: vendor?.id ?? null,
    commissionBps: vendor?.commissionBps ?? null,
    attributionSource: vendor ? "override" : "manual",
    vendorEarnCents: vendor
      ? recomputeEarn({
          baseCents: line.baseCents,
          commissionBps: vendor.commissionBps,
          feeCents: line.feeCents,
          feeMode: line.feeMode,
        })
      : 0,
    rawHash: "",
  };
  next.rawHash = hashLine(next);
  return next;
}

export function naturalKey(line: Pick<LedgerLine, "shopId" | "squareOrderId" | "squareLineUid" | "lineKind">): string {
  return `${line.shopId}|${line.squareOrderId}|${line.squareLineUid}|${line.lineKind}`;
}

export function sameLine(a: Pick<LedgerLine, "shopId" | "squareOrderId" | "squareLineUid" | "lineKind">, b: typeof a): boolean {
  return naturalKey(a) === naturalKey(b);
}

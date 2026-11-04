import type { AttributionCatalog } from "@/domain/attribution";
import { ingestOrder, mergeLines, naturalKey } from "@/domain/ingest";
import {
  orderIdFromWebhook,
  paymentIdFromWebhook,
  refundIdFromWebhook,
  shouldIngestOrder,
  type SquareWebhookBody,
} from "@/domain/square";
import { verifySquareSignature } from "@/domain/webhook";
import type { SquareOrder, SquarePayment, StatementStatus } from "@/domain/types";
import type { AppStore } from "@/server/store/types";

export type SquareGateway = {
  retrieveOrder(orderId: string): Promise<SquareOrder | null>;
  retrievePayment(paymentId: string): Promise<SquarePayment | null>;
  retrieveRefund(refundId: string): Promise<{ id: string; order_id?: string; payment_id?: string } | null>;
};

export async function handleSquareWebhook(
  request: Request,
  deps: {
    store: AppStore;
    gatewayForMerchant: (merchantId: string) => Promise<SquareGateway | null>;
    signatureKey: string;
    notificationUrl: string;
  },
): Promise<Response> {
  const raw = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature");
  const valid = await verifySquareSignature(raw, signature, deps.notificationUrl, deps.signatureKey);
  if (!valid) return Response.json({ error: "invalid signature" }, { status: 401 });

  let body: SquareWebhookBody;
  try {
    body = JSON.parse(raw) as SquareWebhookBody;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.event_id || !body.type) return Response.json({ error: "missing event" }, { status: 400 });

  const existing = await deps.store.getWebhookEvent(body.event_id);
  if (existing && existing.status !== "error") {
    return Response.json({ ok: true, duplicate: true });
  }
  if (!existing) {
    await deps.store.insertWebhookEvent({
      eventId: body.event_id,
      merchantId: body.merchant_id ?? null,
      eventType: body.type,
      receivedAt: deps.store.now().toISOString(),
      processedAt: null,
      status: "received",
      error: null,
    });
  }

  try {
    const result = await processSquareEvent(body, deps.store, deps.gatewayForMerchant);
    await deps.store.markWebhook(body.event_id, {
      status: result,
      processedAt: deps.store.now().toISOString(),
      error: null,
    });
    return Response.json({ ok: true, status: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "processing failed";
    await deps.store.markWebhook(body.event_id, { status: "error", error: message });
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function processSquareEvent(
  body: SquareWebhookBody,
  store: AppStore,
  gatewayForMerchant: (merchantId: string) => Promise<SquareGateway | null>,
): Promise<"processed" | "ignored"> {
  const type = body.type ?? "";
  const merchantId = body.merchant_id ?? "";
  if (type === "oauth.authorization.revoked") {
    await store.deleteSellerSquareData(merchantId);
    return "processed";
  }
  if (type === "catalog.version.updated") return "ignored";
  if (!type.startsWith("order.") && !type.startsWith("payment.") && !type.startsWith("refund.")) return "ignored";

  const shopId = await store.findShopIdByMerchant(merchantId);
  if (!shopId) return "ignored";
  const gateway = await gatewayForMerchant(merchantId);
  if (!gateway) return "ignored";

  let orderId = orderIdFromWebhook(body);
  const paymentId = paymentIdFromWebhook(body);
  const refundId = refundIdFromWebhook(body);
  let payment: SquarePayment | null = null;
  if (!orderId && paymentId) {
    payment = await gateway.retrievePayment(paymentId);
    orderId = payment?.order_id ?? null;
  }
  if (!orderId && refundId) {
    const refund = await gateway.retrieveRefund(refundId);
    orderId = refund?.order_id ?? null;
    if (!payment && refund?.payment_id) payment = await gateway.retrievePayment(refund.payment_id);
  }
  if (!orderId) return "ignored";
  const order = await gateway.retrieveOrder(orderId);
  if (!order || !shouldIngestOrder(order)) return "ignored";

  const payments: SquarePayment[] = [];
  if (payment) payments.push(payment);
  for (const tender of order.tenders ?? []) {
    if (!tender.payment_id) continue;
    if (payments.some((row) => row.id === tender.payment_id)) continue;
    const loaded = await gateway.retrievePayment(tender.payment_id);
    if (loaded) payments.push(loaded);
  }
  await ingestIntoStore(store, shopId, order, payments);
  return "processed";
}

export async function ingestIntoStore(
  store: AppStore,
  shopId: string,
  order: SquareOrder,
  payments: SquarePayment[],
): Promise<{ lineCount: number; unassigned: number }> {
  const shop = await store.getShop(shopId);
  if (!shop) throw new Error("Shop not found");
  const [settings, locations, vendors, items, attrs, rules, priorLines, statements] = await Promise.all([
    store.getSettings(shopId),
    store.listLocations(shopId),
    store.listVendors(shopId, true),
    store.listCatalogItems(shopId),
    store.listCatalogAttrs(shopId),
    store.listRules(shopId),
    store.listLedger(shopId),
    store.listStatements(shopId),
  ]);
  const catalog: AttributionCatalog = { items, attrs, rules, vendors };
  const statementStatus: Record<string, StatementStatus | undefined> = {};
  const closedPeriods: Record<string, string[]> = {};
  for (const statement of statements) {
    statementStatus[statement.id] = statement.status;
    if (statement.status === "approved" || statement.status === "paid") {
      closedPeriods[statement.vendorId] = [...(closedPeriods[statement.vendorId] ?? []), statement.periodYm];
    }
  }
  const outcome = ingestOrder(order, {
    shopId,
    timezone: shop.timezone,
    settings,
    locationIdBySquareId: Object.fromEntries(locations.map((location) => [location.squareLocationId, location.id])),
    catalog,
    priorLines,
    statementStatus,
    closedPeriods,
    payments,
    nowIso: store.now().toISOString(),
  });
  const merged = mergeLines(priorLines, outcome.lines, statementStatus);
  const incomingKeys = new Set(outcome.lines.map(naturalKey));
  const toSave = merged.filter((line) => incomingKeys.has(naturalKey(line)) || !priorLines.some((row) => row.id === line.id));
  await store.upsertLedgerLines(toSave);
  const saved = await store.listLedger(shopId);
  let unassigned = 0;
  for (const flag of outcome.unassigned) {
    const line = saved.find((row) => naturalKey(row) === flag.naturalKey);
    if (!line || line.vendorId) continue;
    await store.ensureUnassigned({ shopId, ledgerLineId: line.id, reason: flag.reason });
    unassigned += 1;
  }
  return { lineCount: toSave.length, unassigned };
}

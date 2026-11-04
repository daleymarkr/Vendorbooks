import type { LedgerLine, NegativeBalanceMode, Statement, Vendor } from "./types";

export type StatementMath = {
  openingBalanceCents: number;
  salesEarnCents: number;
  refundsCents: number;
  adjustmentsCents: number;
  boothRentCents: number;
  payoutCents: number;
};

export function openingBalance(
  prior: Pick<Statement, "payoutCents" | "writtenOffAt"> | null,
  mode: NegativeBalanceMode,
): number {
  if (!prior) return 0;
  if (mode === "forgive" || prior.writtenOffAt) return 0;
  return prior.payoutCents < 0 ? prior.payoutCents : 0;
}

export function computeStatementMath(input: {
  openingCents: number;
  lines: Pick<LedgerLine, "lineKind" | "vendorEarnCents">[];
  boothRentCents: number;
  deductRent: boolean;
}): StatementMath {
  const sum = (kind: LedgerLine["lineKind"]) =>
    input.lines.filter((line) => line.lineKind === kind).reduce((total, line) => total + line.vendorEarnCents, 0);
  const salesEarnCents = sum("sale") + sum("fee_passthrough");
  const refundsCents = sum("refund");
  const adjustmentsCents = sum("adjustment");
  const boothRentCents = input.deductRent ? input.boothRentCents : 0;
  const payoutCents = input.openingCents + salesEarnCents + refundsCents + adjustmentsCents - boothRentCents;
  return { openingBalanceCents: input.openingCents, salesEarnCents, refundsCents, adjustmentsCents, boothRentCents, payoutCents };
}

export function closeBlockers(input: { openUnassigned: number; readOnly: boolean; overCap: boolean }): string[] {
  const blockers: string[] = [];
  if (input.openUnassigned > 0) {
    blockers.push(
      `${input.openUnassigned} unassigned sale${input.openUnassigned === 1 ? "" : "s"} must be allocated or marked as kept by the shop before approval.`,
    );
  }
  if (input.readOnly) blockers.push("Billing is past the grace period, so monthly close is paused.");
  if (input.overCap) blockers.push("Active vendors are over the plan limit. Archive vendors or upgrade before closing.");
  return blockers;
}

export type BuiltStatement = {
  vendorId: string;
  periodYm: string;
  math: StatementMath;
  lineIds: string[];
};

export function buildPeriodStatements(input: {
  periodYm: string;
  vendors: Vendor[];
  lines: LedgerLine[];
  priorStatements: Statement[];
  deductRent: boolean;
  negativeBalanceMode: NegativeBalanceMode;
}): BuiltStatement[] {
  return input.vendors
    .filter((vendor) => !vendor.archivedAt)
    .map((vendor) => {
      const prior = latestPrior(input.priorStatements, vendor.id, input.periodYm);
      const opening = openingBalance(prior, input.negativeBalanceMode);
      const lines = input.lines.filter((line) => line.vendorId === vendor.id && line.periodYm === input.periodYm && !line.statementId);
      const math = computeStatementMath({
        openingCents: opening,
        lines,
        boothRentCents: vendor.boothRentCents,
        deductRent: input.deductRent,
      });
      return { vendorId: vendor.id, periodYm: input.periodYm, math, lineIds: lines.map((line) => line.id) };
    });
}

function latestPrior(statements: Statement[], vendorId: string, periodYm: string): Statement | null {
  const prior = statements
    .filter((statement) => statement.vendorId === vendorId && statement.periodYm < periodYm)
    .sort((a, b) => (a.periodYm < b.periodYm ? 1 : -1));
  return prior[0] ?? null;
}

export function reconcileOrders(input: {
  squareOrders: { id: string; totalCents: number; currency?: string }[];
  ledgerLines: Pick<LedgerLine, "squareOrderId" | "lineKind" | "grossCents" | "discountCents" | "taxCents" | "currency">[];
}): {
  squareOrderCount: number;
  ledgerOrderCount: number;
  mismatchCount: number;
  squareSalesTotalCents: number;
  ledgerRecognizedCents: number;
  deltaCents: number;
  missingInLedger: string[];
  missingInSquare: string[];
} {
  const squareIds = new Set(input.squareOrders.map((order) => order.id));
  const ledgerIds = new Set(
    input.ledgerLines.filter((line) => line.lineKind === "sale").map((line) => line.squareOrderId),
  );
  const missingInLedger = [...squareIds].filter((id) => !ledgerIds.has(id));
  const missingInSquare = [...ledgerIds].filter((id) => !squareIds.has(id));
  const squareSalesTotalCents = input.squareOrders.reduce((sum, order) => {
    if ((order.currency ?? "USD").toUpperCase() !== "USD") return sum;
    return sum + order.totalCents;
  }, 0);
  const ledgerRecognizedCents = input.ledgerLines
    .filter((line) => line.lineKind === "sale" && line.currency === "USD")
    .reduce((sum, line) => sum + line.grossCents - line.discountCents + line.taxCents, 0);
  return {
    squareOrderCount: squareIds.size,
    ledgerOrderCount: ledgerIds.size,
    mismatchCount: missingInLedger.length + missingInSquare.length,
    squareSalesTotalCents,
    ledgerRecognizedCents,
    deltaCents: squareSalesTotalCents - ledgerRecognizedCents,
    missingInLedger,
    missingInSquare,
  };
}

export type StatementDocument = {
  title: string;
  shopName: string;
  vendorName: string;
  periodYm: string;
  lines: string[];
  detail: string[][];
  watermark: string | null;
  disclaimer: string;
};

export function statementDocument(input: {
  shopName: string;
  vendorName: string;
  periodYm: string;
  math: StatementMath;
  payoutMethod: string | null;
  status: string;
  watermark: boolean;
  detail: { soldAt: string; orderId: string; item: string; kind: string; grossCents: number; discountCents: number; baseCents: number; earnCents: number }[];
}): StatementDocument {
  const { math } = input;
  const text = [
    `${input.shopName} — vendor statement`,
    `Vendor: ${input.vendorName}`,
    `Period: ${input.periodYm}`,
    `Status: ${input.status}`,
    `Opening balance: ${money(math.openingBalanceCents)}`,
    `Sales earned: ${money(math.salesEarnCents)}`,
    `Refunds: ${money(math.refundsCents)}`,
    `Adjustments: ${money(math.adjustmentsCents)}`,
    `Booth rent: ${money(math.boothRentCents)}`,
    `Amount for the shop to pay this vendor: ${money(math.payoutCents)}`,
    input.payoutMethod ? `Vendor prefers: ${input.payoutMethod}` : "Payout method is on file with the shop.",
  ];
  return {
    title: `VendorBooks statement ${input.periodYm} — ${input.vendorName}`,
    shopName: input.shopName,
    vendorName: input.vendorName,
    periodYm: input.periodYm,
    lines: text,
    detail: [
      ["Date", "Order", "Item", "Kind", "Gross", "Discount", "Base", "Vendor amount"],
      ...input.detail.map((row) => [
        row.soldAt.slice(0, 10),
        row.orderId,
        row.item,
        row.kind,
        money(row.grossCents),
        money(row.discountCents),
        money(row.baseCents),
        money(row.earnCents),
      ]),
    ],
    watermark: input.watermark ? "VendorBooks Free" : null,
    disclaimer:
      "VendorBooks calculated this amount from Square sales and the shop's payout rules. The shop pays the vendor directly by check, ACH, Zelle, or another method the shop chooses. VendorBooks does not hold, receive, or move that money.",
  };
}

function money(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? "-" : ""}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function statementToCsv(doc: StatementDocument, math: StatementMath): string {
  const summary = [
    ["shop", doc.shopName],
    ["vendor", doc.vendorName],
    ["period", doc.periodYm],
    ["opening_balance", String(math.openingBalanceCents)],
    ["sales_earn", String(math.salesEarnCents)],
    ["refunds", String(math.refundsCents)],
    ["adjustments", String(math.adjustmentsCents)],
    ["booth_rent", String(math.boothRentCents)],
    ["amount_for_shop_to_pay", String(math.payoutCents)],
    ["note", doc.disclaimer],
  ];
  const lines = [toCsv(summary), "", toCsv(doc.detail)];
  return lines.join("\n");
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export type YearVendorTotal = {
  vendorId: string;
  vendorName: string;
  grossCents: number;
  discountCents: number;
  refundCents: number;
  earnCents: number;
  boothRentCents: number;
  paidCents: number;
};

export function yearEndTotals(input: {
  year: string;
  vendors: Vendor[];
  lines: LedgerLine[];
  statements: Statement[];
}): YearVendorTotal[] {
  return input.vendors.map((vendor) => {
    const lines = input.lines.filter((line) => line.vendorId === vendor.id && line.periodYm.startsWith(input.year));
    const statements = input.statements.filter(
      (statement) => statement.vendorId === vendor.id && statement.periodYm.startsWith(input.year) && statement.status === "paid",
    );
    return {
      vendorId: vendor.id,
      vendorName: vendor.displayName,
      grossCents: lines.filter((line) => line.lineKind === "sale").reduce((sum, line) => sum + line.grossCents, 0),
      discountCents: lines.filter((line) => line.lineKind === "sale").reduce((sum, line) => sum + line.discountCents, 0),
      refundCents: lines.filter((line) => line.lineKind === "refund" || line.lineKind === "adjustment").reduce((sum, line) => sum + line.vendorEarnCents, 0),
      earnCents: lines
        .filter((line) => line.lineKind !== "booth_rent")
        .reduce((sum, line) => sum + line.vendorEarnCents, 0),
      boothRentCents: input.statements
        .filter((statement) => statement.vendorId === vendor.id && statement.periodYm.startsWith(input.year))
        .reduce((sum, statement) => sum + statement.boothRentCents, 0),
      paidCents: statements.reduce((sum, statement) => sum + Math.max(0, statement.payoutCents), 0),
    };
  });
}

export function yearEndCsv(rows: YearVendorTotal[]): string {
  const header = ["vendor", "gross_cents", "discount_cents", "refund_and_adjustment_cents", "net_vendor_amount_cents", "booth_rent_cents", "marked_paid_cents"];
  const body = rows.map((row) => [
    row.vendorName,
    String(row.grossCents),
    String(row.discountCents),
    String(row.refundCents),
    String(row.earnCents),
    String(row.boothRentCents),
    String(row.paidCents),
  ]);
  return toCsv([header, ...body]);
}

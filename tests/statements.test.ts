import { describe, expect, it } from "vitest";
import { findForbiddenMoneyPhrases } from "@/domain/copy";
import { calculateCsvPayouts, calculatorResultCsv, parseSalesCsv } from "@/domain/csv";
import { paymentFailedEmail, statementReadyEmail } from "@/domain/emails";
import {
  buildPeriodStatements,
  closeBlockers,
  computeStatementMath,
  openingBalance,
  reconcileOrders,
  statementDocument,
  statementToCsv,
} from "@/domain/statements";
import { line, vendor } from "./helpers";

describe("statements", () => {
  it("F — deducts booth rent and carries a negative balance", () => {
    const math = computeStatementMath({
      openingCents: 0,
      lines: [{ lineKind: "sale", vendorEarnCents: 4000 }],
      boothRentCents: 7500,
      deductRent: true,
    });
    expect(math.payoutCents).toBe(-3500);
    expect(openingBalance({ payoutCents: math.payoutCents, writtenOffAt: null }, "carry")).toBe(-3500);
    expect(openingBalance({ payoutCents: math.payoutCents, writtenOffAt: "2026-11-01" }, "carry")).toBe(0);

    const separate = computeStatementMath({
      openingCents: 0,
      lines: [{ lineKind: "sale", vendorEarnCents: 4000 }],
      boothRentCents: 7500,
      deductRent: false,
    });
    expect(separate.boothRentCents).toBe(0);
    expect(separate.payoutCents).toBe(4000);
  });

  it("builds a period with opening balance, sales, refunds, and adjustments", () => {
    const bob = vendor({ id: "bob", displayName: "Bob", commissionBps: 5000, boothRentCents: 7500 });
    const built = buildPeriodStatements({
      periodYm: "2026-11",
      vendors: [bob],
      lines: [
        line({
          id: "sale",
          squareOrderId: "o",
          squareLineUid: "s",
          vendorId: "bob",
          lineKind: "sale",
          periodYm: "2026-11",
          vendorEarnCents: 900,
        }),
        line({
          id: "adj",
          squareOrderId: "r",
          squareLineUid: "a",
          vendorId: "bob",
          lineKind: "adjustment",
          periodYm: "2026-11",
          vendorEarnCents: -200,
        }),
      ],
      priorStatements: [
        {
          id: "prior",
          shopId: bob.shopId,
          vendorId: "bob",
          periodYm: "2026-10",
          status: "approved",
          openingBalanceCents: 0,
          salesEarnCents: 4000,
          refundsCents: 0,
          adjustmentsCents: 0,
          boothRentCents: 7500,
          payoutCents: -3500,
          squareSalesTotalCents: null,
          reconcileDeltaCents: null,
          pdfPath: null,
          csvPath: null,
          approvedAt: "2026-11-01",
          paidAt: null,
          paidMethod: null,
          paidReference: null,
          writtenOffAt: null,
        },
      ],
      deductRent: true,
      negativeBalanceMode: "carry",
    });
    expect(built[0].math).toMatchObject({
      openingBalanceCents: -3500,
      salesEarnCents: 900,
      adjustmentsCents: -200,
      boothRentCents: 7500,
      payoutCents: -3500 + 900 - 200 - 7500,
    });
  });

  it("blocks approval while unassigned lines are open", () => {
    expect(closeBlockers({ openUnassigned: 2, readOnly: false, overCap: false })).toHaveLength(1);
    expect(closeBlockers({ openUnassigned: 0, readOnly: false, overCap: false })).toEqual([]);
  });

  it("compares Square order totals with the ledger", () => {
    const report = reconcileOrders({
      squareOrders: [
        { id: "a", totalCents: 10800 },
        { id: "missing", totalCents: 500 },
      ],
      ledgerLines: [
        line({ id: "1", squareOrderId: "a", squareLineUid: "1", lineKind: "sale", grossCents: 10000, discountCents: 0, taxCents: 800 }),
        line({ id: "2", squareOrderId: "extra", squareLineUid: "1", lineKind: "sale", grossCents: 100, taxCents: 0 }),
      ],
    });
    expect(report.missingInLedger).toEqual(["missing"]);
    expect(report.missingInSquare).toEqual(["extra"]);
    expect(report.mismatchCount).toBe(2);
    expect(report.deltaCents).toBe(10800 + 500 - (10000 + 800 + 100));
  });

  it("writes a statement without money-movement language", () => {
    const math = computeStatementMath({
      openingCents: 0,
      lines: [{ lineKind: "sale", vendorEarnCents: 6000 }],
      boothRentCents: 0,
      deductRent: true,
    });
    const doc = statementDocument({
      shopName: "Harbor & Pine",
      vendorName: "Alice Hart",
      periodYm: "2026-10",
      math,
      payoutMethod: "check",
      status: "approved",
      watermark: true,
      detail: [],
    });
    const text = [...doc.lines, doc.disclaimer, doc.watermark ?? ""].join("\n");
    expect(findForbiddenMoneyPhrases(text)).toEqual([]);
    expect(text).toContain("$60.00");
    expect(text).toContain("does not hold");
    expect(statementToCsv(doc, math)).toContain("amount_for_shop_to_pay");
  });
});

describe("csv calculator", () => {
  it("produces payout rows without a Square connection", () => {
    const rows = parseSalesCsv(
      ["vendor,gross,discount,tax,commission_percent,booth_rent", "Alice,100,0,8,60,0", "Bob,20,2,1.60,50,75"].join("\n"),
    );
    const totals = calculateCsvPayouts(rows);
    expect(totals.find((row) => row.vendor === "Alice")?.amountToPayCents).toBe(6000);
    expect(totals.find((row) => row.vendor === "Bob")?.amountToPayCents).toBe(900 - 7500);
    const csv = calculatorResultCsv(totals);
    expect(csv.startsWith("vendor,gross")).toBe(true);
    expect(findForbiddenMoneyPhrases(csv)).toEqual([]);
  });
});

describe("email copy", () => {
  it("keeps statement and billing emails on the calculation side of the money", () => {
    const statement = statementReadyEmail({
      to: "alice@example.com",
      shopName: "Harbor & Pine",
      vendorName: "Alice",
      periodYm: "2026-10",
      payoutCents: 6000,
      statementUrl: "https://example.com/portal",
    });
    const failed = paymentFailedEmail({
      to: "owner@example.com",
      shopName: "Harbor & Pine",
      billingUrl: "https://example.com/app/settings",
    });
    expect(findForbiddenMoneyPhrases(statement.text + failed.text)).toEqual([]);
    expect(statement.text).toContain("$60.00");
    expect(failed.text).toContain("3 days");
  });
});

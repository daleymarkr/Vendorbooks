import { describe, expect, it } from "vitest";
import { ingestOrder, mergeLines, recomputeUnlockedSales } from "@/domain/ingest";
import { defaultSettings } from "@/domain/payout";
import { attr, catalog, context, line, vendor } from "./helpers";

const alice = vendor({ id: "alice", displayName: "Alice", commissionBps: 6000 });
const bob = vendor({ id: "bob", displayName: "Bob", commissionBps: 5000 });
const book = catalog({
  vendors: [alice, bob],
  attrs: [
    attr({ catalogObjectId: "VAR_VASE", vendorId: "alice", source: "square_attr" }),
    attr({ catalogObjectId: "VAR_LAMP", vendorId: "bob", source: "square_attr" }),
  ],
});

describe("order ingest", () => {
  it("keeps tax and tips out of example A and still records them", () => {
    const outcome = ingestOrder(
      {
        id: "ORD_A",
        location_id: "LOC1",
        closed_at: "2026-10-15T16:00:00.000Z",
        state: "COMPLETED",
        total_money: { amount: 10800, currency: "USD" },
        line_items: [
          {
            uid: "line-1",
            name: "Milk glass vase",
            quantity: "1",
            catalog_object_id: "VAR_VASE",
            item_type: "ITEM",
            gross_sales_money: { amount: 10000, currency: "USD" },
            total_tax_money: { amount: 800, currency: "USD" },
          },
        ],
      },
      context({
        catalog: book,
        payments: [
          {
            id: "PAY_A",
            order_id: "ORD_A",
            status: "COMPLETED",
            tip_money: { amount: 500, currency: "USD" },
            processing_fee: [{ amount_money: { amount: 290, currency: "USD" } }],
          },
        ],
      }),
    );
    expect(outcome.lines).toHaveLength(1);
    expect(outcome.lines[0]).toMatchObject({
      vendorId: "alice",
      baseCents: 10000,
      vendorEarnCents: 6000,
      taxCents: 800,
      tipCents: 500,
      feeCents: 290,
      feeMode: "shop_absorbs",
      periodYm: "2026-10",
      isOffline: false,
    });
    expect(outcome.unassigned).toHaveLength(0);
  });

  it("reads applied_discounts on each line of an order-level discount", () => {
    const outcome = ingestOrder(
      {
        id: "ORD_B",
        location_id: "LOC1",
        closed_at: "2026-11-02T16:00:00.000Z",
        state: "COMPLETED",
        line_items: [
          {
            uid: "vase",
            name: "Vase",
            quantity: "1",
            catalog_object_id: "VAR_VASE",
            item_type: "ITEM",
            gross_sales_money: { amount: 8000, currency: "USD" },
            applied_discounts: [{ applied_money: { amount: 800, currency: "USD" } }],
            total_discount_money: { amount: 1, currency: "USD" },
          },
          {
            uid: "lamp",
            name: "Lamp",
            quantity: "1",
            catalog_object_id: "VAR_LAMP",
            item_type: "ITEM",
            gross_sales_money: { amount: 2000, currency: "USD" },
            applied_discounts: [{ applied_money: { amount: 200, currency: "USD" } }],
          },
        ],
      },
      context({ catalog: book }),
    );
    const vase = outcome.lines.find((row) => row.squareLineUid === "vase");
    const lamp = outcome.lines.find((row) => row.squareLineUid === "lamp");
    expect(vase).toMatchObject({ vendorId: "alice", baseCents: 7200, vendorEarnCents: 4320, discountCents: 800 });
    expect(lamp).toMatchObject({ vendorId: "bob", baseCents: 1800, vendorEarnCents: 900, discountCents: 200 });
  });

  it("passes fees through in proportion to line bases", () => {
    const outcome = ingestOrder(
      {
        id: "ORD_C",
        closed_at: "2026-11-02T16:00:00.000Z",
        state: "COMPLETED",
        line_items: [
          {
            uid: "big",
            catalog_object_id: "VAR_VASE",
            item_type: "ITEM",
            quantity: "1",
            gross_sales_money: { amount: 7500, currency: "USD" },
          },
          {
            uid: "small",
            catalog_object_id: "VAR_LAMP",
            item_type: "ITEM",
            quantity: "1",
            gross_sales_money: { amount: 2500, currency: "USD" },
          },
        ],
      },
      context({
        catalog: book,
        settings: { ...defaultSettings("s"), feeMode: "pass_through" },
        payments: [
          {
            id: "PAY_C",
            order_id: "ORD_C",
            status: "COMPLETED",
            processing_fee: [{ amount_money: { amount: 400, currency: "USD" } }],
          },
        ],
      }),
    );
    expect(outcome.lines.find((row) => row.squareLineUid === "big")).toMatchObject({ feeCents: 300 });
    expect(outcome.lines.find((row) => row.squareLineUid === "small")).toMatchObject({ feeCents: 100 });
    const big = outcome.lines.find((row) => row.squareLineUid === "big")!;
    expect(big.vendorEarnCents).toBe(Math.round(7500 * 0.6) - 300);
  });

  it("reverses an itemized refund onto the same vendor, including a partial quantity", () => {
    const original = line({
      id: "orig",
      squareOrderId: "ORD_A",
      squareLineUid: "line-1",
      vendorId: "alice",
      quantity: "2",
      grossCents: 10000,
      baseCents: 10000,
      vendorEarnCents: 6000,
      commissionBps: 6000,
      itemName: "Vase",
      statementId: null,
    });
    const outcome = ingestOrder(
      {
        id: "ORD_RET",
        state: "COMPLETED",
        closed_at: "2026-11-04T16:00:00.000Z",
        returns: [
          {
            source_order_id: "ORD_A",
            return_line_items: [{ uid: "ret-1", source_line_item_uid: "line-1", quantity: "1", name: "Vase" }],
          },
        ],
      },
      context({ catalog: book, priorLines: [original] }),
    );
    expect(outcome.lines[0]).toMatchObject({
      lineKind: "refund",
      vendorId: "alice",
      vendorEarnCents: -3000,
      grossCents: -5000,
      periodYm: "2026-11",
    });
  });

  it("queues CUSTOM_AMOUNT sales and amount-only refunds", () => {
    const outcome = ingestOrder(
      {
        id: "ORD_CUSTOM",
        state: "COMPLETED",
        closed_at: "2026-11-03T16:00:00.000Z",
        line_items: [
          {
            uid: "custom",
            name: "Custom amount",
            quantity: "1",
            item_type: "CUSTOM_AMOUNT",
            gross_sales_money: { amount: 2500, currency: "USD" },
          },
        ],
        returns: [
          {
            return_line_items: [
              {
                uid: "cret",
                item_type: "CUSTOM_AMOUNT",
                quantity: "1",
                gross_return_money: { amount: 1500, currency: "USD" },
              },
            ],
          },
        ],
      },
      context({ catalog: book }),
    );
    expect(outcome.unassigned.map((row) => row.reason).sort()).toEqual(["custom_amount", "custom_amount_refund"]);
    expect(outcome.lines.every((row) => row.vendorId == null && row.vendorEarnCents === 0)).toBe(true);
  });

  it("ingests an exchange as a sale line and a return line", () => {
    const original = line({
      id: "orig",
      squareOrderId: "ORD_OLD",
      squareLineUid: "old-line",
      vendorId: "bob",
      grossCents: 2000,
      baseCents: 2000,
      vendorEarnCents: 1000,
      commissionBps: 5000,
      quantity: "1",
    });
    const outcome = ingestOrder(
      {
        id: "ORD_EX",
        state: "COMPLETED",
        closed_at: "2026-11-04T16:00:00.000Z",
        line_items: [
          {
            uid: "new-vase",
            catalog_object_id: "VAR_VASE",
            item_type: "ITEM",
            quantity: "1",
            gross_sales_money: { amount: 4000, currency: "USD" },
          },
        ],
        returns: [
          {
            source_order_id: "ORD_OLD",
            return_line_items: [{ uid: "back", source_line_item_uid: "old-line", quantity: "1" }],
          },
        ],
      },
      context({ catalog: book, priorLines: [original] }),
    );
    expect(outcome.lines.map((row) => row.lineKind).sort()).toEqual(["refund", "sale"]);
    expect(outcome.lines.find((row) => row.lineKind === "sale")?.vendorId).toBe("alice");
    expect(outcome.lines.find((row) => row.lineKind === "refund")?.vendorId).toBe("bob");
  });

  it("posts a refund after an approved statement as a later-period adjustment", () => {
    const original = line({
      id: "orig",
      squareOrderId: "ORD_A",
      squareLineUid: "line-1",
      vendorId: "alice",
      grossCents: 10000,
      baseCents: 10000,
      vendorEarnCents: 6000,
      commissionBps: 6000,
      quantity: "1",
      statementId: "stmt-oct",
      periodYm: "2026-10",
    });
    const outcome = ingestOrder(
      {
        id: "ORD_LATE",
        state: "COMPLETED",
        closed_at: "2026-11-04T16:00:00.000Z",
        returns: [
          {
            source_order_id: "ORD_A",
            return_line_items: [{ uid: "late", source_line_item_uid: "line-1", quantity: "1" }],
          },
        ],
      },
      context({
        catalog: book,
        priorLines: [original],
        statementStatus: { "stmt-oct": "approved" },
        closedPeriods: { alice: ["2026-10"] },
      }),
    );
    expect(outcome.lines[0]).toMatchObject({
      lineKind: "adjustment",
      vendorId: "alice",
      vendorEarnCents: -6000,
      periodYm: "2026-11",
      statementId: null,
    });
  });

  it("bumps the adjustment forward when the refund period is already closed", () => {
    const original = line({
      id: "orig",
      squareOrderId: "ORD_A",
      squareLineUid: "line-1",
      vendorId: "alice",
      grossCents: 10000,
      baseCents: 10000,
      vendorEarnCents: 6000,
      commissionBps: 6000,
      quantity: "1",
      statementId: "stmt-oct",
    });
    const outcome = ingestOrder(
      {
        id: "ORD_LATE",
        state: "COMPLETED",
        closed_at: "2026-11-04T16:00:00.000Z",
        returns: [{ source_order_id: "ORD_A", return_line_items: [{ uid: "late", source_line_item_uid: "line-1", quantity: "1" }] }],
      },
      context({
        catalog: book,
        priorLines: [original],
        statementStatus: { "stmt-oct": "paid" },
        closedPeriods: { alice: ["2026-10", "2026-11"] },
      }),
    );
    expect(outcome.lines[0].periodYm).toBe("2026-12");
  });

  it("flags offline payments and ignores service charges unless included", () => {
    const offline = ingestOrder(
      {
        id: "ORD_OFF",
        state: "COMPLETED",
        closed_at: "2026-11-01T16:00:00.000Z",
        line_items: [
          {
            uid: "x",
            catalog_object_id: "VAR_VASE",
            item_type: "ITEM",
            quantity: "1",
            gross_sales_money: { amount: 1000, currency: "USD" },
          },
        ],
        service_charges: [{ name: "Delivery", total_money: { amount: 500, currency: "USD" } }],
      },
      context({
        catalog: book,
        payments: [{ id: "P", order_id: "ORD_OFF", status: "COMPLETED", is_offline_payment: true }],
      }),
    );
    expect(offline.lines[0].isOffline).toBe(true);
    expect(offline.lines[0].baseCents).toBe(1000);

    const included = ingestOrder(
      {
        id: "ORD_SC",
        state: "COMPLETED",
        closed_at: "2026-11-01T16:00:00.000Z",
        line_items: [
          {
            uid: "x",
            catalog_object_id: "VAR_VASE",
            item_type: "ITEM",
            quantity: "1",
            gross_sales_money: { amount: 1000, currency: "USD" },
          },
        ],
        service_charges: [{ name: "Delivery", total_money: { amount: 500, currency: "USD" } }],
      },
      context({
        catalog: book,
        settings: { ...defaultSettings("s"), serviceChargeMode: "include" },
      }),
    );
    expect(included.lines[0].baseCents).toBe(1500);
  });

  it("does not double lines when the same order is merged twice", () => {
    const first = ingestOrder(
      {
        id: "ORD_A",
        state: "COMPLETED",
        closed_at: "2026-10-15T16:00:00.000Z",
        line_items: [
          {
            uid: "line-1",
            catalog_object_id: "VAR_VASE",
            item_type: "ITEM",
            quantity: "1",
            gross_sales_money: { amount: 10000, currency: "USD" },
          },
        ],
      },
      context({ catalog: book }),
    );
    const second = ingestOrder(
      {
        id: "ORD_A",
        state: "COMPLETED",
        closed_at: "2026-10-15T16:00:00.000Z",
        line_items: [
          {
            uid: "line-1",
            catalog_object_id: "VAR_VASE",
            item_type: "ITEM",
            quantity: "1",
            gross_sales_money: { amount: 10000, currency: "USD" },
          },
        ],
      },
      context({ catalog: book, priorLines: first.lines }),
    );
    const merged = mergeLines(first.lines, second.lines, {});
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(first.lines[0].id);
  });

  it("keeps a recorded earn when fee mode changes, until an open period is repriced", () => {
    const recorded = line({
      id: "sale",
      squareOrderId: "ORD",
      squareLineUid: "line-1",
      vendorId: "alice",
      grossCents: 10000,
      baseCents: 10000,
      feeCents: 320,
      vendorEarnCents: 6000,
      commissionBps: 6000,
      feeMode: "shop_absorbs",
    });
    expect(recorded.vendorEarnCents).toBe(6000);
    const [repriced] = recomputeUnlockedSales([recorded], { ...defaultSettings("s"), feeMode: "pass_through" }, {});
    expect(repriced.vendorEarnCents).toBe(5680);
    const locked = recomputeUnlockedSales([{ ...recorded, statementId: "stmt" }], { ...defaultSettings("s"), feeMode: "pass_through" }, {
      stmt: "approved",
    });
    expect(locked[0].vendorEarnCents).toBe(6000);
  });
});

import { describe, expect, it } from "vitest";
import { toPublicConnection } from "@/domain/square";
import { buildSeedDump } from "@/demo/seed";
import { DEMO } from "@/demo/ids";

describe("demo seed", () => {
  const dump = buildSeedDump();

  it("matches the worked examples for Harbor & Pine", () => {
    const aliceOct = dump.ledger.find((line) => line.squareOrderId === "ORD_OCT_ALICE");
    expect(aliceOct).toMatchObject({ vendorId: DEMO.alice, baseCents: 10000, vendorEarnCents: 6000, tipCents: 500 });
    const bobOct = dump.statements.find((statement) => statement.id === DEMO.bobOct);
    expect(bobOct).toMatchObject({ salesEarnCents: 4000, boothRentCents: 7500, payoutCents: -3500, status: "approved" });
    const split = dump.ledger.filter((line) => line.squareOrderId === "ORD_NOV_SPLIT");
    expect(split.find((line) => line.vendorId === DEMO.alice)?.vendorEarnCents).toBe(4320);
    expect(split.find((line) => line.vendorId === DEMO.bob)?.vendorEarnCents).toBe(900);
    const refund = dump.ledger.find((line) => line.squareOrderId === "ORD_NOV_REFUND");
    expect(refund).toMatchObject({ lineKind: "adjustment", vendorEarnCents: -6000, periodYm: "2026-11" });
    expect(dump.unassigned.filter((row) => row.status === "open")).toHaveLength(1);
    expect(dump.ledger.find((line) => line.squareOrderId === "ORD_NOV_QUILT")?.vendorId).toBe(DEMO.carol);
  });

  it("does not expose token ciphertext on the public connection", () => {
    const pub = toPublicConnection(dump.connections[0]);
    expect(JSON.stringify(pub)).not.toContain("demo:");
    expect(JSON.stringify(pub)).not.toContain("cipher");
    expect(pub).toMatchObject({ connected: true, merchantId: "ML8HARBORPINE", sandbox: true });
  });
});
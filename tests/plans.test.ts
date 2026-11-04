import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PlanError, assertCanAddLocation, assertCanCreateVendor, assertCanRunClose, resolveAccess } from "@/domain/plans";
import { canReadSquareConnection, visibleLedger, visibleStatements, visibleVendors } from "@/domain/visibility";
import { MemoryStore } from "@/server/store/memory";
import type { Membership, Statement, Vendor } from "@/domain/types";
import { line, vendor } from "./helpers";

const freeShop = {
  plan: "free" as const,
  trialEndsAt: null,
  stripeStatus: null,
  billingGraceUntil: null,
};

describe("plan limits", () => {
  it("blocks the 6th active vendor on Free and frees the slot when one is archived", async () => {
    const store = new MemoryStore();
    const shop = await store.createShop({ userId: "owner", name: "Free Shop", timezone: "America/New_York", statementDay: 1 });
    for (let i = 0; i < 5; i++) {
      await store.createVendor({
        shopId: shop.id,
        displayName: `Vendor ${i}`,
        email: null,
        phone: null,
        commissionBps: 5000,
        boothRentCents: 0,
        payoutMethod: null,
        payoutDetails: null,
        payoutDay: null,
      });
    }
    await expect(
      store.createVendor({
        shopId: shop.id,
        displayName: "Sixth",
        email: null,
        phone: null,
        commissionBps: 5000,
        boothRentCents: 0,
        payoutMethod: null,
        payoutDetails: null,
        payoutDay: null,
      }),
    ).rejects.toBeInstanceOf(PlanError);
    const [first] = await store.listVendors(shop.id);
    await store.updateVendor(first.id, { archivedAt: "2026-11-04T00:00:00.000Z" });
    const sixth = await store.createVendor({
      shopId: shop.id,
      displayName: "Sixth",
      email: null,
      phone: null,
      commissionBps: 5000,
      boothRentCents: 0,
      payoutMethod: null,
      payoutDetails: null,
      payoutDay: null,
    });
    expect(sixth.displayName).toBe("Sixth");
  });

  it("allows a Shop trial, then falls back to Free and blocks close when over the cap", () => {
    const now = new Date("2026-11-04T00:00:00.000Z");
    const trialing = resolveAccess(
      { plan: "shop", trialEndsAt: "2026-11-18T00:00:00.000Z", stripeStatus: "trialing", billingGraceUntil: null },
      now,
    );
    expect(trialing.vendorCap).toBe(50);
    expect(trialing.readOnly).toBe(false);

    const expired = resolveAccess(
      { plan: "shop", trialEndsAt: "2026-10-01T00:00:00.000Z", stripeStatus: null, billingGraceUntil: null },
      now,
    );
    expect(expired.plan).toBe("free");
    expect(() => assertCanRunClose(expired, 8)).toThrow(PlanError);

    const grace = resolveAccess(
      { plan: "mall", trialEndsAt: null, stripeStatus: "past_due", billingGraceUntil: "2026-11-06T00:00:00.000Z" },
      now,
    );
    expect(grace.readOnly).toBe(false);
    const locked = resolveAccess(
      { plan: "mall", trialEndsAt: null, stripeStatus: "past_due", billingGraceUntil: "2026-11-01T00:00:00.000Z" },
      now,
    );
    expect(locked.readOnly).toBe(true);
    expect(() => assertCanCreateVendor(locked, 0)).toThrow(/read-only/);
  });

  it("limits Free to one active location and leaves Mall uncapped", () => {
    const free = resolveAccess(freeShop, new Date());
    expect(() => assertCanAddLocation(free, 1)).toThrow(/one location/);
    const mall = resolveAccess({ plan: "mall", trialEndsAt: null, stripeStatus: "active", billingGraceUntil: null }, new Date());
    expect(mall.vendorCap).toBeNull();
    expect(() => assertCanCreateVendor(mall, 80)).not.toThrow();
  });
});

describe("visibility", () => {
  const alice = vendor({ id: "alice", displayName: "Alice", commissionBps: 6000 });
  const bob = vendor({ id: "bob", displayName: "Bob", commissionBps: 5000 });
  const vendors: Vendor[] = [alice, bob];
  const membership: Membership = {
    shopId: alice.shopId,
    userId: "owner",
    role: "owner",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const draft: Statement = {
    id: "draft",
    shopId: alice.shopId,
    vendorId: "alice",
    periodYm: "2026-11",
    status: "draft",
    openingBalanceCents: 0,
    salesEarnCents: 100,
    refundsCents: 0,
    adjustmentsCents: 0,
    boothRentCents: 0,
    payoutCents: 100,
    squareSalesTotalCents: null,
    reconcileDeltaCents: null,
    pdfPath: null,
    csvPath: null,
    approvedAt: null,
    paidAt: null,
    paidMethod: null,
    paidReference: null,
    writtenOffAt: null,
  };
  const paid: Statement = { ...draft, id: "paid", vendorId: "bob", status: "paid" };

  it("hides other vendors and draft statements from a portal user", () => {
    const scope = { userId: "alice-user", isPlatformAdmin: false, memberships: [], vendorId: "alice" };
    expect(visibleVendors(vendors, scope).map((row) => row.id)).toEqual(["alice"]);
    expect(visibleLedger([
      line({ id: "1", squareOrderId: "o", squareLineUid: "a", vendorId: "alice" }),
      line({ id: "2", squareOrderId: "o", squareLineUid: "b", vendorId: "bob" }),
    ], scope).map((row) => row.vendorId)).toEqual(["alice"]);
    expect(visibleStatements([draft, paid], scope).map((row) => row.id)).toEqual([]);
    expect(visibleStatements([{ ...draft, status: "approved" }, paid], scope).map((row) => row.id)).toEqual(["draft"]);
  });

  it("lets a shop member read the shop and never lets a user session read token rows", () => {
    const owner = { userId: "owner", isPlatformAdmin: false, memberships: [membership], vendorId: null };
    expect(visibleVendors(vendors, owner)).toHaveLength(2);
    expect(visibleStatements([draft], owner)).toHaveLength(1);
    expect(canReadSquareConnection(owner)).toBe(false);
    expect(canReadSquareConnection({ ...owner, isPlatformAdmin: true })).toBe(false);
    expect(canReadSquareConnection({ ...owner, serviceRole: true })).toBe(true);
  });
});

describe("security migration", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261104000000_init.sql", import.meta.url), "utf8");

  it("keeps Square tokens and webhook events off authenticated roles", () => {
    expect(sql).toContain("access_token_cipher");
    expect(sql).toContain("refresh_token_cipher");
    expect(sql).toMatch(/alter table public\.square_connections enable row level security/i);
    expect(sql).toMatch(/alter table public\.square_connections force row level security/i);
    expect(sql).toMatch(/revoke all on public\.square_connections from public, anon, authenticated/i);
    expect(sql).toMatch(/alter table public\.webhook_events enable row level security/i);
    expect(sql).toMatch(/alter table public\.webhook_events force row level security/i);
    expect(sql).toMatch(/revoke all on public\.webhook_events from public, anon, authenticated/i);

    const policies = [...sql.matchAll(/create policy\s+(\w+)\s+on\s+public\.(\w+)/gi)];
    const tables = policies.map((match) => match[2]);
    expect(tables).not.toContain("square_connections");
    expect(tables).not.toContain("webhook_events");
  });

  it("compiles vendor portal policies and enforces plan caps in the database", () => {
    expect(sql).toContain("vendors_portal_select");
    expect(sql).toContain("ledger_portal_select");
    expect(sql).toContain("statements_portal_select");
    expect(sql).toMatch(/status in \('approved', 'paid'\)/);
    expect(sql).toContain("vendor_id_for_user");
    expect(sql).toContain("is_shop_member");
    expect(sql).toContain("enforce_vendor_cap");
    expect(sql).toContain("enforce_location_cap");
    expect(sql).toContain("enforce_statement_write");
    expect(sql).toContain("create_shop");
    expect(sql).toContain("protect_billing_columns");
    expect(sql).toMatch(/OAuth only/);
    expect(sql.toLowerCase()).not.toContain("square password");
  });
});

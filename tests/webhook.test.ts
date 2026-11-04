import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { decryptSecret, encryptSecret, squareSignature, timingSafeEqualString, verifySquareSignature } from "@/domain/webhook";
import { handleSquareWebhook, type SquareGateway } from "@/server/square/process-webhook";
import { MemoryStore } from "@/server/store/memory";
import { planOrderSearches, isAttributeLimitError } from "@/domain/square";
import { tokenNeedsRefresh, tokenRefreshIsStale } from "@/domain/tokens";
import type { SquareOrder, SquarePayment } from "@/domain/types";
import { attr, vendor } from "./helpers";

const URL = "https://vendorbooks.example/api/square/webhook";
const KEY = "sandbox-signature-key";

class FakeSquare implements SquareGateway {
  orders = new Map<string, SquareOrder>();
  payments = new Map<string, SquarePayment>();
  orderReads = 0;

  async retrieveOrder(orderId: string): Promise<SquareOrder | null> {
    this.orderReads += 1;
    return this.orders.get(orderId) ?? null;
  }

  async retrievePayment(paymentId: string): Promise<SquarePayment | null> {
    return this.payments.get(paymentId) ?? null;
  }

  async retrieveRefund(): Promise<null> {
    return null;
  }
}

async function signed(body: unknown): Promise<Request> {
  const raw = JSON.stringify(body);
  const signature = await squareSignature(KEY, URL, raw);
  return new Request(URL, {
    method: "POST",
    headers: { "x-square-hmacsha256-signature": signature, "content-type": "application/json" },
    body: raw,
  });
}

describe("Square webhook signatures", () => {
  it("accepts a valid HMAC and rejects tampering with a constant-time compare", async () => {
    const raw = JSON.stringify({ event_id: "evt_1", type: "order.created" });
    const good = await squareSignature(KEY, URL, raw);
    expect(await verifySquareSignature(raw, good, URL, KEY)).toBe(true);
    expect(await verifySquareSignature(`${raw} `, good, URL, KEY)).toBe(false);
    expect(await verifySquareSignature(raw, good.slice(0, -1) + (good.endsWith("A") ? "B" : "A"), URL, KEY)).toBe(false);
    expect(await verifySquareSignature(raw, "", URL, KEY)).toBe(false);
    expect(await verifySquareSignature(raw, good, "https://other.example/hook", KEY)).toBe(false);
    expect(timingSafeEqualString("abc", "abc")).toBe(true);
    expect(timingSafeEqualString("abc", "abd")).toBe(false);
    expect(timingSafeEqualString("abc", "abcd")).toBe(false);
  });

  it("round-trips token encryption", async () => {
    const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    const cipher = await encryptSecret("sq0at-sandbox-token", key);
    expect(cipher.startsWith("v1.")).toBe(true);
    expect(cipher).not.toContain("sq0at-sandbox-token");
    expect(await decryptSecret(cipher, key)).toBe("sq0at-sandbox-token");
  });
});

describe("webhook ingestion", () => {
  it("ingests a retrieved order once when Square retries the same event id", async () => {
    const store = new MemoryStore();
    const shop = await store.createShop({ userId: "user-1", name: "Harbor", timezone: "America/New_York", statementDay: 1 });
    await store.upsertUser({
      id: "user-1",
      email: "marina@harborpine.demo",
      fullName: "Marina",
      isPlatformAdmin: false,
      createdAt: store.now().toISOString(),
    });
    await store.createVendor({
      ...vendor({ id: "alice", displayName: "Alice", commissionBps: 6000 }),
      shopId: shop.id,
    });
    await store.upsertCatalogAttr({ ...attr({ catalogObjectId: "VAR_VASE", vendorId: "alice", source: "square_attr" }), shopId: shop.id });
    await store.upsertConnection({
      shopId: shop.id,
      merchantId: "MERCHANT",
      accessTokenCipher: "cipher-access",
      refreshTokenCipher: "cipher-refresh",
      tokenExpiresAt: "2026-12-01T00:00:00.000Z",
      scopes: ["ORDERS_READ"],
      lastRefreshedAt: store.now().toISOString(),
      revokedAt: null,
      sandbox: true,
      createdAt: store.now().toISOString(),
    });
    const square = new FakeSquare();
    square.orders.set("ORDER_1", {
      id: "ORDER_1",
      location_id: "LOC",
      state: "COMPLETED",
      closed_at: "2026-11-02T16:00:00.000Z",
      total_money: { amount: 10800, currency: "USD" },
      line_items: [
        {
          uid: "line-1",
          name: "Vase",
          quantity: "1",
          item_type: "ITEM",
          catalog_object_id: "VAR_VASE",
          gross_sales_money: { amount: 10000, currency: "USD" },
          total_tax_money: { amount: 800, currency: "USD" },
        },
      ],
      tenders: [{ payment_id: "PAY_1" }],
    });
    square.payments.set("PAY_1", {
      id: "PAY_1",
      order_id: "ORDER_1",
      status: "COMPLETED",
      tip_money: { amount: 500, currency: "USD" },
      processing_fee: [{ amount_money: { amount: 320, currency: "USD" } }],
      is_offline_payment: false,
    });

    const event = {
      merchant_id: "MERCHANT",
      type: "order.created",
      event_id: "evt_order_1",
      data: { object: { order_created: { order_id: "ORDER_1" } } },
    };
    const deps = {
      store,
      gatewayForMerchant: async () => square,
      signatureKey: KEY,
      notificationUrl: URL,
    };
    const first = await handleSquareWebhook(await signed(event), deps);
    expect(first.status).toBe(200);
    const lines = await store.listLedger(shop.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].vendorEarnCents).toBe(6000);
    expect(lines[0].tipCents).toBe(500);

    const second = await handleSquareWebhook(await signed(event), deps);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
    expect(await store.listLedger(shop.id)).toHaveLength(1);
    expect(square.orderReads).toBe(1);
  });

  it("rejects a bad signature before writing a ledger row", async () => {
    const store = new MemoryStore();
    const response = await handleSquareWebhook(
      new Request(URL, {
        method: "POST",
        headers: { "x-square-hmacsha256-signature": "nope" },
        body: JSON.stringify({ event_id: "evt", type: "order.created", merchant_id: "M" }),
      }),
      { store, gatewayForMerchant: async () => null, signatureKey: KEY, notificationUrl: URL },
    );
    expect(response.status).toBe(401);
    expect(store.dump().ledger).toHaveLength(0);
    expect(store.dump().webhooks).toHaveLength(0);
  });

  it("deletes Square seller data when authorization is revoked and keeps the shop's vendors", async () => {
    const store = new MemoryStore();
    const shop = await store.createShop({ userId: "user-1", name: "Harbor", timezone: "America/New_York", statementDay: 1 });
    await store.upsertConnection({
      shopId: shop.id,
      merchantId: "MERCHANT",
      accessTokenCipher: "secret-access",
      refreshTokenCipher: "secret-refresh",
      tokenExpiresAt: "2026-12-01T00:00:00.000Z",
      scopes: [],
      lastRefreshedAt: null,
      revokedAt: null,
      sandbox: true,
      createdAt: store.now().toISOString(),
    });
    await store.createVendor({ ...vendor({ id: "alice", displayName: "Alice", commissionBps: 6000 }), shopId: shop.id });
    await store.upsertCatalogAttr({ ...attr({ catalogObjectId: "VAR", vendorId: "alice", source: "square_attr" }), shopId: shop.id });
    await store.upsertLedgerLines([
      {
        id: crypto.randomUUID(),
        shopId: shop.id,
        locationId: null,
        vendorId: "alice",
        squareOrderId: "O",
        squareLineUid: "L",
        squarePaymentId: null,
        catalogObjectId: "VAR",
        catalogVersion: null,
        lineKind: "sale",
        soldAt: "2026-11-01T00:00:00.000Z",
        periodYm: "2026-11",
        quantity: "1",
        grossCents: 100,
        discountCents: 0,
        taxCents: 0,
        tipCents: 0,
        feeCents: 0,
        serviceChargeCents: 0,
        baseCents: 100,
        vendorEarnCents: 60,
        commissionBps: 6000,
        feeMode: "shop_absorbs",
        attributionSource: "square_attr",
        isOffline: false,
        statementId: null,
        sourceOrderId: null,
        sourceLineUid: null,
        itemName: "Vase",
        currency: "USD",
        rawHash: "abc",
        createdAt: store.now().toISOString(),
      },
    ]);
    const event = { merchant_id: "MERCHANT", type: "oauth.authorization.revoked", event_id: "evt_revoke", data: { object: {} } };
    const response = await handleSquareWebhook(await signed(event), {
      store,
      gatewayForMerchant: async () => null,
      signatureKey: KEY,
      notificationUrl: URL,
    });
    expect(response.status).toBe(200);
    expect(await store.getConnection(shop.id)).toBeNull();
    expect(await store.listCatalogAttrs(shop.id)).toHaveLength(0);
    expect(await store.listLedger(shop.id)).toHaveLength(0);
    expect(await store.listVendors(shop.id)).toHaveLength(1);
    expect(store.dump().connections.some((row) => JSON.stringify(row).includes("secret-access"))).toBe(false);
  });
});

describe("Square request planning", () => {
  it("chunks location ids by 10 for SearchOrders", () => {
    const ids = Array.from({ length: 25 }, (_, index) => `L${index}`);
    const calls = planOrderSearches(ids);
    expect(calls.map((call) => call.locationIds.length)).toEqual([10, 10, 5]);
    expect(calls.every((call) => call.limit === 1000)).toBe(true);
  });

  it("recognizes a full custom-attribute slot", () => {
    expect(isAttributeLimitError(400, "MAXIMUM number of custom attribute definitions reached")).toBe(true);
    expect(isAttributeLimitError(200, "ok")).toBe(false);
  });

  it("refreshes tokens at 7 days and alerts after 8", () => {
    const created = "2026-10-01T00:00:00.000Z";
    const connection = {
      tokenExpiresAt: "2026-12-15T00:00:00.000Z",
      lastRefreshedAt: "2026-10-20T00:00:00.000Z",
      createdAt: created,
    };
    expect(tokenNeedsRefresh(connection, new Date("2026-10-27T00:00:00.000Z"))).toBe(true);
    expect(tokenNeedsRefresh({ ...connection, lastRefreshedAt: "2026-10-26T00:00:00.000Z" }, new Date("2026-10-27T00:00:00.000Z"))).toBe(false);
    expect(tokenNeedsRefresh({ ...connection, lastRefreshedAt: "2026-10-26T00:00:00.000Z", tokenExpiresAt: "2026-11-01T00:00:00.000Z" }, new Date("2026-10-27T00:00:00.000Z"))).toBe(true);
    expect(tokenRefreshIsStale({ lastRefreshedAt: "2026-10-01T00:00:00.000Z", createdAt: created }, new Date("2026-10-10T00:00:00.000Z"))).toBe(true);
  });
});

describe("Stripe signatures", () => {
  it("accepts Stripe's signed payload and rejects a different secret", () => {
    const stripe = new Stripe("sk_test_vendorbooks");
    const payload = JSON.stringify({
      id: "evt_test",
      object: "event",
      type: "checkout.session.completed",
      data: { object: {} },
    });
    const secret = "whsec_" + Buffer.from("vendorbooks-test-secret").toString("base64");
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const event = stripe.webhooks.constructEvent(payload, header, secret);
    expect(event.id).toBe("evt_test");
    expect(() => stripe.webhooks.constructEvent(payload, header, secret + "nope")).toThrow();
  });
});

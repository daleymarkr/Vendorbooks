import "server-only";

import Stripe from "stripe";
import { parseAttributionCsv } from "@/domain/csv";
import { appUrl } from "@/domain/env";
import { paymentFailedEmail, portalInviteEmail, statementReadyEmail, tokenStaleEmail, trialEndingEmail } from "@/domain/emails";
import { allocateLine, recomputeUnlockedSales } from "@/domain/ingest";
import { addMonthsYm, periodYm } from "@/domain/money";
import { isOverVendorCap, resolveAccess } from "@/domain/plans";
import { batchUpsertVendorAttributes, buildAuthorizeUrl, isAttributeLimitError, isDemoCipher, vendorAttributeDefinitionBody } from "@/domain/square";
import { buildPeriodStatements, closeBlockers, reconcileOrders, statementDocument, statementToCsv, yearEndCsv, yearEndTotals } from "@/domain/statements";
import { SQUARE_SCOPES, type CatalogItem, type PayoutSettings, type Shop, type StatementStatus } from "@/domain/types";
import { tokenNeedsRefresh, tokenRefreshIsStale } from "@/domain/tokens";
import { encryptSecret, decryptSecret, readOAuthState, signOAuthState } from "@/domain/webhook";
import { deliverEmail } from "@/server/mail";
import { renderStatementPdf } from "@/server/pdf";
import { exchangeSquareCode, HttpSquare, refreshSquareToken, revokeSquareToken, squareAppCredentials, squareForShop, SquareError } from "@/server/square/client";
import { ingestIntoStore } from "@/server/square/process-webhook";
import type { AppStore } from "@/server/store";

function tokenKey(): string {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (key) return key;
  if (process.env.NODE_ENV === "production") throw new Error("TOKEN_ENCRYPTION_KEY is required in production.");
  return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
}

export async function beginSquareConnect(input: { shopId: string; userId: string }): Promise<string> {
  const creds = squareAppCredentials();
  if (!creds.applicationId || !creds.applicationSecret || !creds.redirectUrl) {
    throw new Error("Add the Square application id, secret, and redirect URL before connecting.");
  }
  const state = await signOAuthState(
    { shopId: input.shopId, userId: input.userId, nonce: crypto.randomUUID(), exp: Date.now() + 15 * 60 * 1000, env: creds.env },
    tokenKey(),
  );
  return buildAuthorizeUrl({ env: creds.env, applicationId: creds.applicationId, redirectUrl: creds.redirectUrl, state });
}

export async function finishSquareConnect(input: { code: string; state: string }): Promise<string> {
  const state = await readOAuthState(input.state, tokenKey());
  const tokens = await exchangeSquareCode(input.code);
  const store = await (await import("@/server/store")).getStore();
  const existing = await store.getConnection(state.shopId);
  await store.upsertConnection({
    shopId: state.shopId,
    merchantId: tokens.merchantId,
    accessTokenCipher: await encryptSecret(tokens.accessToken, tokenKey()),
    refreshTokenCipher: await encryptSecret(tokens.refreshToken, tokenKey()),
    tokenExpiresAt: tokens.expiresAt,
    scopes: [...SQUARE_SCOPES],
    lastRefreshedAt: new Date().toISOString(),
    revokedAt: null,
    sandbox: state.env === "sandbox",
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  });
  const api = new HttpSquare(tokens.accessToken, state.env);
  const shop = await store.getShop(state.shopId);
  const listed = await api.listLocations();
  const access = resolveAccess(shop!, new Date());
  let activeCount = 0;
  await store.saveLocations(
    state.shopId,
    listed.map((location) => {
      let active = location.status !== "INACTIVE";
      if (active && access.locationCap != null && activeCount >= access.locationCap) active = false;
      if (active) activeCount += 1;
      return { id: crypto.randomUUID(), shopId: state.shopId, squareLocationId: location.id, name: location.name, active };
    }),
  );
  await store.audit({ actorUserId: state.userId, action: "square.connected", meta: { shopId: state.shopId, merchantId: tokens.merchantId } });
  return state.shopId;
}

export async function disconnectSquare(store: AppStore, shopId: string, actorId: string): Promise<void> {
  const connection = await store.getConnection(shopId);
  if (connection && !isDemoCipher(connection.accessTokenCipher)) {
    try {
      const token = await decryptSecret(connection.accessTokenCipher, tokenKey());
      await revokeSquareToken(token);
    } catch {
      // Local deletion still proceeds. Square may already have revoked the grant.
    }
  }
  if (connection) await store.deleteSellerSquareData(connection.merchantId);
  await store.audit({ actorUserId: actorId, action: "square.disconnected", meta: { shopId } });
}

export async function backfillShop(store: AppStore, shopId: string, actorId: string | null): Promise<{ orders: number; note?: string }> {
  const api = await squareForShop(store, shopId);
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  if (!api) {
    await store.addBackfillRun({
      id,
      shopId,
      status: "completed",
      ordersSeen: 0,
      linesUpserted: 0,
      error: null,
      startedAt,
      finishedAt: startedAt,
    });
    return { orders: 0, note: "Demo ledger is already loaded. Connect Square to import a seller's orders." };
  }
  await store.addBackfillRun({ id, shopId, status: "running", ordersSeen: 0, linesUpserted: 0, error: null, startedAt, finishedAt: null });
  try {
    const locationIds = (await store.listLocations(shopId)).filter((location) => location.active).map((location) => location.squareLocationId);
    const orders = await api.searchAllOrders(locationIds);
    let lines = 0;
    for (const order of orders) {
      const payments = [];
      for (const tender of order.tenders ?? []) {
        if (!tender.payment_id) continue;
        const payment = await api.retrievePayment(tender.payment_id);
        if (payment) payments.push(payment);
      }
      const result = await ingestIntoStore(store, shopId, order, payments);
      lines += result.lineCount;
    }
    await store.updateBackfillRun(id, { status: "completed", ordersSeen: orders.length, linesUpserted: lines, finishedAt: new Date().toISOString() });
    await store.audit({ actorUserId: actorId, action: "square.backfill", meta: { shopId, orders: orders.length, lines } });
    return { orders: orders.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backfill failed";
    await store.updateBackfillRun(id, { status: "error", error: message, finishedAt: new Date().toISOString() });
    throw error;
  }
}

export async function reconcileShop(store: AppStore, shopId: string): Promise<{ mismatchCount: number }> {
  const end = new Date();
  const start = new Date(end.getTime() - 2 * 24 * 60 * 60 * 1000);
  const ledger = await store.listLedger(shopId, { from: start.toISOString(), to: end.toISOString() });
  const api = await squareForShop(store, shopId);
  let squareOrders: { id: string; totalCents: number; currency?: string }[] = [];
  if (api) {
    const locationIds = (await store.listLocations(shopId)).filter((location) => location.active).map((location) => location.squareLocationId);
    const orders = await api.searchAllOrders(locationIds, start.toISOString(), end.toISOString());
    squareOrders = orders.map((order) => ({ id: order.id, totalCents: order.total_money?.amount ?? 0, currency: order.total_money?.currency }));
  } else {
    squareOrders = [...new Set(ledger.filter((line) => line.lineKind === "sale").map((line) => line.squareOrderId))].map((id) => ({
      id,
      totalCents: ledger.filter((line) => line.squareOrderId === id && line.lineKind === "sale").reduce((sum, line) => sum + line.grossCents - line.discountCents + line.taxCents, 0),
    }));
  }
  const report = reconcileOrders({ squareOrders, ledgerLines: ledger });
  await store.addReconcileRun({
    id: crypto.randomUUID(),
    shopId,
    ranAt: end.toISOString(),
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    squareOrderCount: report.squareOrderCount,
    ledgerLineCount: ledger.length,
    mismatchCount: report.mismatchCount,
    notes: { missingInLedger: report.missingInLedger, missingInSquare: report.missingInSquare, deltaCents: report.deltaCents },
  });
  return { mismatchCount: report.mismatchCount };
}

export async function refreshDueTokens(store: AppStore): Promise<void> {
  const now = new Date();
  for (const connection of await store.listConnections()) {
    if (isDemoCipher(connection.accessTokenCipher) || !tokenNeedsRefresh(connection, now)) continue;
    try {
      const refreshToken = await decryptSecret(connection.refreshTokenCipher, tokenKey());
      const next = await refreshSquareToken(refreshToken);
      await store.upsertConnection({
        ...connection,
        accessTokenCipher: await encryptSecret(next.accessToken, tokenKey()),
        refreshTokenCipher: await encryptSecret(next.refreshToken, tokenKey()),
        tokenExpiresAt: next.expiresAt,
        lastRefreshedAt: now.toISOString(),
      });
    } catch (error) {
      if (!tokenRefreshIsStale(connection, now)) continue;
      const shop = await store.getShop(connection.shopId);
      const owner = (await store.listMembers(connection.shopId)).find((member) => member.role === "owner");
      const user = owner ? await store.getUser(owner.userId) : null;
      if (user?.email && shop) await deliverEmail(store, shop.id, tokenStaleEmail({ to: user.email, shopName: shop.name }));
      await store.audit({ actorUserId: null, action: "square.token.stale", meta: { shopId: connection.shopId, error: error instanceof Error ? error.message : "refresh failed" } });
    }
  }
}

export async function closeShopPeriod(store: AppStore, shopId: string, periodYmValue: string, actorId: string | null, fromCron = false): Promise<{ skipped: boolean; blockers: string[]; count: number }> {
  const shop = await store.getShop(shopId);
  if (!shop) throw new Error("Shop not found");
  const vendors = await store.listVendors(shopId);
  const access = resolveAccess(shop, new Date());
  const open = await store.listUnassigned(shopId, "open");
  const blockers = closeBlockers({ openUnassigned: open.length, readOnly: access.readOnly, overCap: isOverVendorCap(access, vendors.length) });
  if (access.readOnly || isOverVendorCap(access, vendors.length)) {
    if (fromCron) {
      await store.audit({ actorUserId: actorId, action: "close.skipped", meta: { shopId, periodYm: periodYmValue, blockers } });
      return { skipped: true, blockers, count: 0 };
    }
  }
  if (blockers.length) {
    if (fromCron) {
      await store.audit({ actorUserId: actorId, action: "close.skipped", meta: { shopId, periodYm: periodYmValue, blockers } });
      return { skipped: true, blockers, count: 0 };
    }
    throw new Error(blockers.join(" "));
  }
  const [lines, statements, settings] = await Promise.all([
    store.listLedger(shopId, { periodYm: periodYmValue }),
    store.listStatements(shopId),
    store.getSettings(shopId),
  ]);
  const built = buildPeriodStatements({
    periodYm: periodYmValue,
    vendors,
    lines,
    priorStatements: statements,
    deductRent: settings.boothRentMode === "deduct",
    negativeBalanceMode: settings.negativeBalanceMode,
  });
  const delta = await shopReconcileDelta(store, shop, periodYmValue, lines);
  let count = 0;
  for (const row of built) {
    const existing = statements.find((statement) => statement.vendorId === row.vendorId && statement.periodYm === periodYmValue);
    if (existing && (existing.status === "approved" || existing.status === "paid")) continue;
    const saved = await store.upsertStatement({
      id: existing?.id ?? crypto.randomUUID(),
      shopId,
      vendorId: row.vendorId,
      periodYm: periodYmValue,
      status: "pending_review",
      openingBalanceCents: row.math.openingBalanceCents,
      salesEarnCents: row.math.salesEarnCents,
      refundsCents: row.math.refundsCents,
      adjustmentsCents: row.math.adjustmentsCents,
      boothRentCents: row.math.boothRentCents,
      payoutCents: row.math.payoutCents,
      squareSalesTotalCents: delta.square,
      reconcileDeltaCents: delta.delta,
      pdfPath: existing?.pdfPath ?? null,
      csvPath: existing?.csvPath ?? null,
      approvedAt: null,
      paidAt: null,
      paidMethod: null,
      paidReference: null,
      writtenOffAt: null,
    });
    const attached = lines.filter((line) => row.lineIds.includes(line.id)).map((line) => ({ ...line, statementId: saved.id }));
    if (attached.length) await store.upsertLedgerLines(attached);
    count += 1;
  }
  await store.audit({ actorUserId: actorId, action: "close.generated", meta: { shopId, periodYm: periodYmValue, count } });
  return { skipped: false, blockers: [], count };
}

async function shopReconcileDelta(store: AppStore, shop: Shop, periodYmValue: string, lines: Awaited<ReturnType<AppStore["listLedger"]>>): Promise<{ square: number | null; delta: number | null }> {
  const api = await squareForShop(store, shop.id);
  if (!api) return { square: null, delta: null };
  const [year, month] = periodYmValue.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const end = new Date(Date.UTC(year, month, 1)).toISOString();
  try {
    const locationIds = (await store.listLocations(shop.id)).filter((location) => location.active).map((location) => location.squareLocationId);
    const orders = await api.searchAllOrders(locationIds, start, end);
    const report = reconcileOrders({
      squareOrders: orders.map((order) => ({ id: order.id, totalCents: order.total_money?.amount ?? 0, currency: order.total_money?.currency })),
      ledgerLines: lines,
    });
    return { square: report.squareSalesTotalCents, delta: report.deltaCents };
  } catch {
    return { square: null, delta: null };
  }
}

export async function approveStatement(store: AppStore, statementId: string, actorId: string): Promise<void> {
  const statement = await store.getStatement(statementId);
  if (!statement) throw new Error("Statement not found");
  const open = await store.listUnassigned(statement.shopId, "open");
  if (open.length) throw new Error(closeBlockers({ openUnassigned: open.length, readOnly: false, overCap: false })[0]);
  if (statement.status === "paid") return;
  await store.updateStatement(statementId, { status: "approved", approvedAt: new Date().toISOString() });
  const [vendor, shop] = await Promise.all([store.getVendor(statement.vendorId), store.getShop(statement.shopId)]);
  if (vendor?.email && shop) {
    await deliverEmail(
      store,
      shop.id,
      statementReadyEmail({
        to: vendor.email,
        shopName: shop.name,
        vendorName: vendor.displayName,
        periodYm: statement.periodYm,
        payoutCents: statement.payoutCents,
        statementUrl: `${appUrl()}/portal/statements`,
      }),
    );
  }
  await store.audit({ actorUserId: actorId, action: "statement.approved", meta: { statementId } });
}

export async function markStatementPaid(store: AppStore, statementId: string, actorId: string, method: string, reference: string): Promise<void> {
  const statement = await store.getStatement(statementId);
  if (!statement) throw new Error("Statement not found");
  if (statement.status !== "approved" && statement.status !== "paid") {
    throw new Error("Approve the statement before recording that the shop paid the vendor.");
  }
  await store.updateStatement(statementId, {
    status: "paid",
    paidAt: new Date().toISOString(),
    paidMethod: method,
    paidReference: reference,
  });
  await store.audit({ actorUserId: actorId, action: "statement.marked_paid", meta: { statementId, method, reference } });
}

export async function forgiveStatement(store: AppStore, statementId: string, actorId: string): Promise<void> {
  const statement = await store.getStatement(statementId);
  if (!statement) throw new Error("Statement not found");
  if (statement.payoutCents >= 0) throw new Error("Only a negative balance can be written off.");
  await store.updateStatement(statementId, { writtenOffAt: new Date().toISOString() });
  await store.audit({ actorUserId: actorId, action: "statement.written_off", meta: { statementId } });
}

export async function allocateUnassigned(store: AppStore, shopId: string, queueId: string, vendorId: string | null, actorId: string): Promise<void> {
  const rows = await store.listUnassigned(shopId);
  const queues = rows.find((row) => row.id === queueId);
  if (!queues) throw new Error("Queue item not found");
  const line = await lineById(store, shopId, queues.ledgerLineId);
  const vendor = vendorId ? await store.getVendor(vendorId) : null;
  const next = allocateLine(line, vendor);
  await store.updateLedgerLine(line.id, next);
  await store.resolveUnassigned(queueId, {
    status: vendor ? "allocated" : "ignored",
    vendorId: vendor?.id ?? null,
    resolvedAt: new Date().toISOString(),
  });
  await store.audit({ actorUserId: actorId, action: vendor ? "unassigned.allocated" : "unassigned.shop_kept", meta: { queueId, vendorId } });
}

async function lineById(store: AppStore, shopId: string, lineId: string) {
  const lines = await store.listLedger(shopId);
  const line = lines.find((row) => row.id === lineId);
  if (!line) throw new Error("Ledger line not found");
  return line;
}

export async function repriceOpenLines(store: AppStore, shopId: string, settings: PayoutSettings): Promise<void> {
  const [lines, statements] = await Promise.all([store.listLedger(shopId), store.listStatements(shopId)]);
  const status: Record<string, StatementStatus | undefined> = {};
  for (const statement of statements) status[statement.id] = statement.status;
  const next = recomputeUnlockedSales(lines, settings, status);
  const changed = next.filter((line, index) => line.rawHash !== lines[index]?.rawHash);
  if (changed.length) await store.upsertLedgerLines(changed);
}

export async function inviteVendor(store: AppStore, vendorId: string, actorId: string): Promise<string> {
  const vendor = await store.getVendor(vendorId);
  if (!vendor?.email) throw new Error("Add an email before inviting this vendor.");
  const shop = await store.getShop(vendor.shopId);
  let authUserId: string | null = null;
  let link = `${appUrl()}/login`;
  if (process.env.DEMO_MODE === "true" || (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NODE_ENV !== "production")) {
    const { isDemoMode } = await import("@/domain/env");
    if (isDemoMode()) {
      const { setDemoPassword } = await import("@/server/store/demo");
      const { signDemoToken } = await import("@/server/session");
      const existing = await store.getUserByEmail(vendor.email);
      authUserId = existing?.id ?? crypto.randomUUID();
      if (!existing) {
        await store.upsertUser({
          id: authUserId,
          email: vendor.email,
          fullName: vendor.displayName,
          isPlatformAdmin: false,
          createdAt: new Date().toISOString(),
        });
        await setDemoPassword(authUserId, crypto.randomUUID());
      }
      link = `${appUrl()}/api/demo/magic?token=${await signDemoToken(authUserId)}`;
    }
  } else {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const generated = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: vendor.email,
      options: { redirectTo: `${appUrl()}/auth/callback?next=/portal` },
    });
    if (generated.error) throw new Error(generated.error.message);
    authUserId = generated.data.user?.id ?? null;
    link = generated.data.properties?.action_link || link;
    if (authUserId) {
      await store.upsertUser({
        id: authUserId,
        email: vendor.email,
        fullName: vendor.displayName,
        isPlatformAdmin: false,
        createdAt: new Date().toISOString(),
      });
    }
  }
  await store.upsertPortal({
    vendorId,
    authUserId,
    invitedEmail: vendor.email,
    invitedAt: new Date().toISOString(),
    lastLoginAt: null,
  });
  if (shop) {
    await deliverEmail(store, shop.id, portalInviteEmail({ to: vendor.email, shopName: shop.name, vendorName: vendor.displayName, link }));
  }
  await store.audit({ actorUserId: actorId, action: "vendor.invited", meta: { vendorId } });
  return link;
}

export async function setupCatalogAttribute(store: AppStore, shopId: string): Promise<{ ok: boolean; message: string }> {
  const api = await squareForShop(store, shopId);
  if (!api) return { ok: false, message: "Connect Square before creating the vendor attribute. Rules and CSV import work without it." };
  const result = await api.createVendorAttribute(crypto.randomUUID(), vendorAttributeDefinitionBody(crypto.randomUUID()));
  if (result.status >= 200 && result.status < 300) return { ok: true, message: "Vendor attribute is ready. It is hidden on the Square POS." };
  if (isAttributeLimitError(result.status, result.body)) {
    return { ok: false, message: "This Square account has no free custom attribute slot (sellers share 10 hidden and 10 visible slots across apps). Use SKU, category, or CSV rules instead." };
  }
  const errors = result.json.errors as { detail?: string }[] | undefined;
  return { ok: false, message: errors?.[0]?.detail || "Square did not create the attribute." };
}

export async function syncCatalog(store: AppStore, shopId: string): Promise<number> {
  const api = await squareForShop(store, shopId);
  if (!api) return 0;
  const vendors = await store.listVendors(shopId, true);
  const items: CatalogItem[] = [];
  const attrs: { catalogObjectId: string; vendorId: string | null; value: string | null; version: number | null }[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.searchCatalog(cursor);
    const names = new Map<string, string>();
    for (const object of [...page.related, ...page.objects]) {
      if (object.type === "CATEGORY") {
        const data = object.category_data as { name?: string } | undefined;
        names.set(String(object.id), data?.name || "");
      }
    }
    for (const object of page.objects) {
      if (object.type !== "ITEM" && object.type !== "ITEM_VARIATION") continue;
      const itemData = object.item_data as { name?: string; category_id?: string } | undefined;
      const variation = object.item_variation_data as { item_id?: string; name?: string; sku?: string } | undefined;
      const categoryId = itemData?.category_id;
      items.push({
        shopId,
        catalogObjectId: String(object.id),
        parentObjectId: variation?.item_id ?? null,
        objectType: object.type,
        name: itemData?.name || variation?.name || null,
        sku: variation?.sku ?? null,
        categoryName: categoryId ? names.get(categoryId) ?? null : null,
        catalogVersion: object.version == null ? null : Number(object.version),
        updatedAt: new Date().toISOString(),
      });
      const values = object.custom_attribute_values as Record<string, { string_value?: string }> | undefined;
      const raw = values?.vendorbooks_vendor?.string_value ?? null;
      if (raw) {
        const match = vendors.find((vendor) => vendor.id === raw || vendor.displayName.toLowerCase() === raw.toLowerCase());
        attrs.push({ catalogObjectId: String(object.id), vendorId: match?.id ?? null, value: raw, version: object.version == null ? null : Number(object.version) });
      }
    }
    cursor = page.cursor;
  } while (cursor);
  await store.upsertCatalogItems(items);
  for (const attr of attrs) {
    await store.upsertCatalogAttr({
      shopId,
      catalogObjectId: attr.catalogObjectId,
      catalogVersion: attr.version,
      vendorId: attr.vendorId,
      vendorAttrValue: attr.value,
      source: "square_attr",
      updatedAt: new Date().toISOString(),
    });
  }
  return items.length;
}

export async function pushTags(store: AppStore, shopId: string, pairs: { catalogObjectId: string; vendorId: string }[]): Promise<string> {
  const vendors = await store.listVendors(shopId, true);
  const items = await store.listCatalogItems(shopId);
  for (const pair of pairs) {
    if (!vendors.some((vendor) => vendor.id === pair.vendorId)) continue;
    const item = items.find((row) => row.catalogObjectId === pair.catalogObjectId);
    await store.upsertCatalogAttr({
      shopId,
      catalogObjectId: pair.catalogObjectId,
      catalogVersion: item?.catalogVersion ?? null,
      vendorId: pair.vendorId,
      vendorAttrValue: pair.vendorId,
      source: "manual",
      updatedAt: new Date().toISOString(),
    });
  }
  const api = await squareForShop(store, shopId);
  if (!api) return "Tags saved in VendorBooks. Connect Square to write them onto the catalog.";
  try {
    await api.batchUpsert(
      batchUpsertVendorAttributes(
        pairs.map((pair) => {
          const item = items.find((row) => row.catalogObjectId === pair.catalogObjectId);
          return { type: item?.objectType ?? "ITEM_VARIATION", id: pair.catalogObjectId, version: item?.catalogVersion, vendorId: pair.vendorId };
        }),
        crypto.randomUUID(),
      ),
    );
    return "Tags saved and sent to Square.";
  } catch (error) {
    if (error instanceof SquareError && isAttributeLimitError(error.status, error.body)) {
      return "Tags are saved in VendorBooks. Square has no free attribute slot, so the catalog was not updated.";
    }
    return error instanceof Error ? `Tags are saved in VendorBooks. Square said: ${error.message}` : "Tags saved locally.";
  }
}

export async function importAttributionCsv(store: AppStore, shopId: string, csv: string): Promise<number> {
  const rows = parseAttributionCsv(csv);
  const [vendors, items] = await Promise.all([store.listVendors(shopId, true), store.listCatalogItems(shopId)]);
  let count = 0;
  for (const row of rows) {
    const vendor = vendors.find((item) => item.displayName.toLowerCase() === row.vendorName.toLowerCase());
    if (!vendor) continue;
    const catalogObjectId =
      row.keyType === "catalog_object_id"
        ? row.key
        : items.find((item) => item.sku?.toLowerCase() === row.key.toLowerCase())?.catalogObjectId;
    if (!catalogObjectId) continue;
    await store.upsertCatalogAttr({
      shopId,
      catalogObjectId,
      catalogVersion: null,
      vendorId: vendor.id,
      vendorAttrValue: vendor.id,
      source: "csv",
      updatedAt: new Date().toISOString(),
    });
    count += 1;
  }
  return count;
}

export async function statementFiles(store: AppStore, statementId: string): Promise<{ pdf: Uint8Array; csv: string; shopId: string }> {
  const statement = await store.getStatement(statementId);
  if (!statement) throw new Error("Statement not found");
  const [shop, vendor, lines, settings] = await Promise.all([
    store.getShop(statement.shopId),
    store.getVendor(statement.vendorId),
    store.listLedger(statement.shopId, { vendorId: statement.vendorId, periodYm: statement.periodYm }),
    store.getSettings(statement.shopId),
  ]);
  if (!shop || !vendor) throw new Error("Statement is missing its shop or vendor.");
  const doc = statementDocument({
    shopName: shop.name,
    vendorName: vendor.displayName,
    periodYm: statement.periodYm,
    math: statement,
    payoutMethod: vendor.payoutMethod,
    status: statement.status,
    watermark: resolveAccess(shop, new Date()).plan === "free",
    detail: lines.map((line) => ({
      soldAt: line.soldAt,
      orderId: line.squareOrderId,
      item: line.itemName || "Item",
      kind: line.lineKind,
      grossCents: line.grossCents,
      discountCents: line.discountCents,
      baseCents: line.baseCents,
      earnCents: line.vendorEarnCents,
    })),
  });
  const pdf = await renderStatementPdf(doc);
  const csv = statementToCsv(doc, statement);
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      const path = `${shop.id}/${statement.id}.pdf`;
      await client.storage.from("statements").upload(path, pdf, { upsert: true, contentType: "application/pdf" });
      await store.updateStatement(statement.id, { pdfPath: path, csvPath: `${shop.id}/${statement.id}.csv` });
    } catch {
      // Download still works when storage is not provisioned yet.
    }
  }
  void settings;
  return { pdf, csv, shopId: shop.id };
}

export function buildYearEndCsv(input: { year: string; vendors: Parameters<typeof yearEndTotals>[0]["vendors"]; lines: Parameters<typeof yearEndTotals>[0]["lines"]; statements: Parameters<typeof yearEndTotals>[0]["statements"] }): string {
  return yearEndCsv(yearEndTotals(input));
}

export async function runScheduledClose(store: AppStore): Promise<void> {
  const now = new Date();
  for (const shop of await store.listAllShops()) {
    const day = Number(new Intl.DateTimeFormat("en-US", { timeZone: shop.timezone, day: "numeric" }).format(now));
    if (day !== shop.statementDay) continue;
    const current = periodYm(now.toISOString(), shop.timezone);
    await closeShopPeriod(store, shop.id, addMonthsYm(current, -1), null, true);
  }
}

export async function sendTrialEmails(store: AppStore): Promise<void> {
  const now = Date.now();
  for (const shop of await store.listAllShops()) {
    if (!shop.trialEndsAt || shop.trialEndingEmailSentAt) continue;
    const ends = new Date(shop.trialEndsAt).getTime();
    const days = (ends - now) / 86400000;
    if (days > 3 || days < 0) continue;
    const owner = (await store.listMembers(shop.id)).find((member) => member.role === "owner");
    const user = owner ? await store.getUser(owner.userId) : null;
    if (!user?.email) continue;
    await deliverEmail(store, shop.id, trialEndingEmail({ to: user.email, shopName: shop.name, trialEndsAt: shop.trialEndsAt, billingUrl: `${appUrl()}/app/settings` }));
    await store.updateShop(shop.id, { trialEndingEmailSentAt: new Date().toISOString() });
  }
}

export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Add STRIPE_SECRET_KEY before starting checkout.");
  return new Stripe(key);
}

export function priceIdFor(plan: "shop" | "mall", interval: "monthly" | "annual"): string {
  const name = `STRIPE_PRICE_${plan.toUpperCase()}_${interval === "monthly" ? "MONTHLY" : "ANNUAL"}`;
  const value = process.env[name];
  if (!value) throw new Error(`Add ${name} to the environment. See the README for the Stripe price amounts.`);
  return value;
}

const EXPECTED_CENTS = { shop: { monthly: 4900, annual: 49000 }, mall: { monthly: 12900, annual: 129000 } } as const;

export async function createCheckout(shop: Shop, plan: "shop" | "mall", interval: "monthly" | "annual"): Promise<string> {
  const stripe = stripeClient();
  const price = priceIdFor(plan, interval);
  const retrieved = await stripe.prices.retrieve(price);
  const expected = EXPECTED_CENTS[plan][interval];
  if (retrieved.unit_amount !== expected) {
    throw new Error(`Stripe price ${price} is ${retrieved.unit_amount} cents. VendorBooks expects ${expected} cents (${interval === "annual" ? "10× monthly" : "monthly"}).`);
  }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: shop.stripeCustomerId ?? undefined,
    line_items: [{ price, quantity: 1 }],
    success_url: `${appUrl()}/trial/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl()}/app/settings`,
    client_reference_id: shop.id,
    metadata: { shopId: shop.id, plan },
    subscription_data: {
      metadata: { shopId: shop.id, plan },
      trial_period_days: shop.stripeSubscriptionId ? undefined : 14,
    },
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}

export async function createPortal(shop: Shop): Promise<string> {
  if (!shop.stripeCustomerId) throw new Error("Choose a plan before opening the billing portal.");
  const stripe = stripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: shop.stripeCustomerId,
    return_url: `${appUrl()}/app/settings`,
  });
  return session.url;
}

export async function applyStripeEvent(store: AppStore, event: Stripe.Event): Promise<void> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const shopId = session.metadata?.shopId || session.client_reference_id;
    const plan = session.metadata?.plan;
    if (!shopId || (plan !== "shop" && plan !== "mall")) return;
    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    await store.updateShop(shopId, {
      plan,
      stripeCustomerId: customerId ?? null,
      stripeSubscriptionId: subscriptionId ?? null,
      stripeStatus: "trialing",
      trialEndsAt: new Date(Date.now() + 14 * 86400000).toISOString(),
    });
    return;
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const shop = await shopForStripe(store, subscription);
    if (!shop) return;
    const priceId = subscription.items.data[0]?.price?.id;
    const mapped = mapPrice(priceId);
    const status = event.type === "customer.subscription.deleted" ? "canceled" : subscription.status;
    await store.updateShop(shop.id, {
      plan: status === "canceled" ? "free" : mapped?.plan ?? shop.plan,
      stripeStatus: status,
      stripeSubscriptionId: status === "canceled" ? null : subscription.id,
      billingGraceUntil: status === "past_due" || status === "unpaid" ? shop.billingGraceUntil ?? new Date(Date.now() + 3 * 86400000).toISOString() : null,
      trialEndsAt: status === "active" ? null : shop.trialEndsAt,
    });
    return;
  }
  if (event.type === "invoice.payment_failed" || event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    const shop = (await store.listAllShops()).find((row) => row.stripeCustomerId === customerId);
    if (!shop) return;
    if (event.type === "invoice.payment_succeeded") {
      await store.updateShop(shop.id, { stripeStatus: "active", billingGraceUntil: null });
      return;
    }
    await store.updateShop(shop.id, {
      stripeStatus: "past_due",
      billingGraceUntil: new Date(Date.now() + 3 * 86400000).toISOString(),
    });
    const owner = (await store.listMembers(shop.id)).find((member) => member.role === "owner");
    const user = owner ? await store.getUser(owner.userId) : null;
    if (user?.email) await deliverEmail(store, shop.id, paymentFailedEmail({ to: user.email, shopName: shop.name, billingUrl: `${appUrl()}/app/settings` }));
  }
}

async function shopForStripe(store: AppStore, subscription: Stripe.Subscription): Promise<Shop | null> {
  const shops = await store.listAllShops();
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  return shops.find((shop) => shop.stripeSubscriptionId === subscription.id || shop.stripeCustomerId === customerId) ?? null;
}

function mapPrice(priceId: string | undefined): { plan: "shop" | "mall" } | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_SHOP_MONTHLY || priceId === process.env.STRIPE_PRICE_SHOP_ANNUAL) return { plan: "shop" };
  if (priceId === process.env.STRIPE_PRICE_MALL_MONTHLY || priceId === process.env.STRIPE_PRICE_MALL_ANNUAL) return { plan: "mall" };
  return null;
}


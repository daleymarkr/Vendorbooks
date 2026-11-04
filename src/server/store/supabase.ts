import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertCanAddLocation, assertCanCreateVendor, resolveAccess } from "@/domain/plans";
import { defaultSettings } from "@/domain/payout";
import type {
  AttributionRule,
  AuditEntry,
  BackfillRun,
  CatalogAttr,
  CatalogItem,
  EmailLog,
  LedgerLine,
  Membership,
  PayoutSettings,
  PortalAccount,
  Profile,
  ReconcileRun,
  Shop,
  ShopLocation,
  SquareConnection,
  Statement,
  UnassignedItem,
  Vendor,
  WebhookEvent,
} from "@/domain/types";
import type { AppStore, LedgerFilter } from "./types";

type Row = Record<string, unknown>;

export class SupabaseStore implements AppStore {
  constructor(
    private readonly url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    private readonly serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  ) {}

  now(): Date {
    return new Date();
  }

  private db(): SupabaseClient {
    if (!this.url || !this.serviceKey) {
      throw new Error("Supabase is not configured. Add the project URL and service role key.");
    }
    return createClient(this.url, this.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async getUser(id: string): Promise<Profile | null> {
    const { data, error } = await this.db().from("profiles").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? profile(data) : null;
  }

  async getUserByEmail(email: string): Promise<Profile | null> {
    const { data, error } = await this.db().from("profiles").select("*").ilike("email", email).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? profile(data) : null;
  }

  async upsertUser(user: Profile): Promise<void> {
    const { error } = await this.db().from("profiles").upsert({
      id: user.id,
      email: user.email,
      full_name: user.fullName,
      is_platform_admin: user.isPlatformAdmin,
      created_at: user.createdAt,
    });
    if (error) throw new Error(error.message);
  }

  async listShopsForUser(userId: string): Promise<Shop[]> {
    const memberships = await this.listMembershipsForUser(userId);
    if (memberships.length === 0) return [];
    const { data, error } = await this.db().from("shops").select("*").in("id", memberships.map((member) => member.shopId));
    if (error) throw new Error(error.message);
    return (data ?? []).map(shop);
  }

  async listAllShops(): Promise<Shop[]> {
    const { data, error } = await this.db().from("shops").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(shop);
  }

  async getShop(id: string): Promise<Shop | null> {
    const { data, error } = await this.db().from("shops").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? shop(data) : null;
  }

  async createShop(input: { userId: string; name: string; timezone: string; statementDay: number }): Promise<Shop> {
    const now = this.now().toISOString();
    const created = shopRow({
      id: crypto.randomUUID(),
      name: input.name.trim(),
      slug: `${slug(input.name)}-${crypto.randomUUID().slice(0, 8)}`,
      plan: "free",
      trialEndsAt: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeStatus: null,
      billingGraceUntil: null,
      trialEndingEmailSentAt: null,
      timezone: input.timezone || "America/New_York",
      statementDay: input.statementDay,
      createdAt: now,
    });
    const { error } = await this.db().from("shops").insert(created);
    if (error) throw new Error(error.message);
    const { error: memberError } = await this.db().from("shop_members").insert({
      shop_id: created.id,
      user_id: input.userId,
      role: "owner",
      created_at: now,
    });
    if (memberError) throw new Error(memberError.message);
    const { error: settingsError } = await this.db().from("shop_payout_settings").insert({ shop_id: created.id });
    if (settingsError) throw new Error(settingsError.message);
    return shop(created);
  }

  async updateShop(id: string, patch: Partial<Shop>): Promise<Shop> {
    const { data, error } = await this.db().from("shops").update(defined(shopRow({ ...patch, id }))).eq("id", id).select("*").single();
    if (error) throw new Error(error.message);
    return shop(data);
  }

  async getMembership(shopId: string, userId: string): Promise<Membership | null> {
    const { data, error } = await this.db().from("shop_members").select("*").eq("shop_id", shopId).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? member(data) : null;
  }

  async listMembers(shopId: string): Promise<Membership[]> {
    const { data, error } = await this.db().from("shop_members").select("*").eq("shop_id", shopId);
    if (error) throw new Error(error.message);
    return (data ?? []).map(member);
  }

  async listMembershipsForUser(userId: string): Promise<Membership[]> {
    const { data, error } = await this.db().from("shop_members").select("*").eq("user_id", userId);
    if (error) throw new Error(error.message);
    return (data ?? []).map(member);
  }

  async getSettings(shopId: string): Promise<PayoutSettings> {
    const { data, error } = await this.db().from("shop_payout_settings").select("*").eq("shop_id", shopId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? settings(data) : defaultSettings(shopId, this.now().toISOString());
  }

  async updateSettings(shopId: string, patch: Partial<PayoutSettings>): Promise<PayoutSettings> {
    const current = await this.getSettings(shopId);
    const next = { ...current, ...patch, shopId, updatedAt: this.now().toISOString() };
    const { error } = await this.db().from("shop_payout_settings").upsert(settingsRow(next));
    if (error) throw new Error(error.message);
    return next;
  }

  async getConnection(shopId: string): Promise<SquareConnection | null> {
    const { data, error } = await this.db().from("square_connections").select("*").eq("shop_id", shopId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || data.revoked_at) return null;
    return connection(data);
  }

  async upsertConnection(value: SquareConnection): Promise<void> {
    const { error } = await this.db().from("square_connections").upsert(connectionRow(value));
    if (error) throw new Error(error.message);
  }

  async listConnections(): Promise<SquareConnection[]> {
    const { data, error } = await this.db().from("square_connections").select("*").is("revoked_at", null);
    if (error) throw new Error(error.message);
    return (data ?? []).map(connection);
  }

  async findShopIdByMerchant(merchantId: string): Promise<string | null> {
    const { data, error } = await this.db().from("square_connections").select("shop_id, revoked_at").eq("merchant_id", merchantId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || data.revoked_at) return null;
    return data.shop_id as string;
  }

  async listLocations(shopId: string): Promise<ShopLocation[]> {
    const { data, error } = await this.db().from("shop_locations").select("*").eq("shop_id", shopId);
    if (error) throw new Error(error.message);
    return (data ?? []).map(location);
  }

  async addLocation(value: ShopLocation): Promise<ShopLocation> {
    const current = await this.mustShop(value.shopId);
    if (value.active) {
      const active = (await this.listLocations(value.shopId)).filter((row) => row.active).length;
      assertCanAddLocation(resolveAccess(current, this.now()), active);
    }
    const { error } = await this.db().from("shop_locations").insert(locationRow(value));
    if (error) throw new Error(error.message);
    return value;
  }

  async saveLocations(shopId: string, locations: ShopLocation[]): Promise<void> {
    const { error: deleteError } = await this.db().from("shop_locations").delete().eq("shop_id", shopId);
    if (deleteError) throw new Error(deleteError.message);
    if (locations.length === 0) return;
    const { error } = await this.db().from("shop_locations").insert(locations.map(locationRow));
    if (error) throw new Error(error.message);
  }

  async listVendors(shopId: string, includeArchived = false): Promise<Vendor[]> {
    let query = this.db().from("vendors").select("*").eq("shop_id", shopId).order("display_name");
    if (!includeArchived) query = query.is("archived_at", null);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(vendor);
  }

  async getVendor(id: string): Promise<Vendor | null> {
    const { data, error } = await this.db().from("vendors").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? vendor(data) : null;
  }

  async createVendor(input: Omit<Vendor, "id" | "createdAt" | "archivedAt"> & { id?: string }): Promise<Vendor> {
    const current = await this.mustShop(input.shopId);
    const active = (await this.listVendors(input.shopId)).length;
    assertCanCreateVendor(resolveAccess(current, this.now()), active);
    const value: Vendor = { ...input, id: input.id ?? crypto.randomUUID(), archivedAt: null, createdAt: this.now().toISOString() };
    const { error } = await this.db().from("vendors").insert(vendorRow(value));
    if (error) throw new Error(error.message);
    return value;
  }

  async updateVendor(id: string, patch: Partial<Vendor>): Promise<Vendor> {
    const existing = await this.getVendor(id);
    if (!existing) throw new Error("Vendor not found");
    if (existing.archivedAt && patch.archivedAt === null) {
      const current = await this.mustShop(existing.shopId);
      const active = (await this.listVendors(existing.shopId)).length;
      assertCanCreateVendor(resolveAccess(current, this.now()), active);
    }
    const next = { ...existing, ...patch, id };
    const { error } = await this.db().from("vendors").update(vendorRow(next)).eq("id", id);
    if (error) throw new Error(error.message);
    return next;
  }

  async getPortalByUser(userId: string): Promise<PortalAccount | null> {
    const { data, error } = await this.db().from("vendor_portal_accounts").select("*").eq("auth_user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? portal(data) : null;
  }

  async getPortalByVendor(vendorId: string): Promise<PortalAccount | null> {
    const { data, error } = await this.db().from("vendor_portal_accounts").select("*").eq("vendor_id", vendorId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? portal(data) : null;
  }

  async upsertPortal(account: PortalAccount): Promise<void> {
    const { error } = await this.db().from("vendor_portal_accounts").upsert({
      vendor_id: account.vendorId,
      auth_user_id: account.authUserId,
      invited_email: account.invitedEmail,
      invited_at: account.invitedAt,
      last_login_at: account.lastLoginAt,
    });
    if (error) throw new Error(error.message);
  }

  async listCatalogItems(shopId: string): Promise<CatalogItem[]> {
    const { data, error } = await this.db().from("catalog_items").select("*").eq("shop_id", shopId);
    if (error) throw new Error(error.message);
    return (data ?? []).map(catalogItem);
  }

  async upsertCatalogItems(items: CatalogItem[]): Promise<void> {
    if (items.length === 0) return;
    const { error } = await this.db().from("catalog_items").upsert(items.map(catalogItemRow), { onConflict: "shop_id,catalog_object_id" });
    if (error) throw new Error(error.message);
  }

  async listCatalogAttrs(shopId: string): Promise<CatalogAttr[]> {
    const { data, error } = await this.db().from("catalog_vendor_attrs").select("*").eq("shop_id", shopId);
    if (error) throw new Error(error.message);
    return (data ?? []).map(catalogAttr);
  }

  async upsertCatalogAttr(attr: CatalogAttr): Promise<void> {
    const { error } = await this.db().from("catalog_vendor_attrs").upsert(catalogAttrRow(attr), { onConflict: "shop_id,catalog_object_id" });
    if (error) throw new Error(error.message);
  }

  async listRules(shopId: string): Promise<AttributionRule[]> {
    const { data, error } = await this.db().from("attribution_rules").select("*").eq("shop_id", shopId).order("priority");
    if (error) throw new Error(error.message);
    return (data ?? []).map(rule);
  }

  async createRule(value: Omit<AttributionRule, "id"> & { id?: string }): Promise<AttributionRule> {
    const saved: AttributionRule = { ...value, id: value.id ?? crypto.randomUUID() };
    const { error } = await this.db().from("attribution_rules").insert({
      id: saved.id,
      shop_id: saved.shopId,
      priority: saved.priority,
      rule_type: saved.ruleType,
      pattern: saved.pattern,
      vendor_id: saved.vendorId,
      active: saved.active,
    });
    if (error) throw new Error(error.message);
    return saved;
  }

  async deleteRule(id: string): Promise<void> {
    const { error } = await this.db().from("attribution_rules").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async listLedger(shopId: string, filter: LedgerFilter = {}): Promise<LedgerLine[]> {
    let query = this.db().from("ledger_lines").select("*").eq("shop_id", shopId).order("sold_at", { ascending: false });
    if (filter.vendorId) query = query.eq("vendor_id", filter.vendorId);
    if (filter.locationId) query = query.eq("location_id", filter.locationId);
    if (filter.periodYm) query = query.eq("period_ym", filter.periodYm);
    if (filter.from) query = query.gte("sold_at", filter.from);
    if (filter.to) query = query.lte("sold_at", filter.to);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(ledger);
  }

  async upsertLedgerLines(lines: LedgerLine[]): Promise<void> {
    if (lines.length === 0) return;
    const shopIds = [...new Set(lines.map((line) => line.shopId))];
    const orderIds = [...new Set(lines.map((line) => line.squareOrderId))];
    const { data: existing, error: readError } = await this.db()
      .from("ledger_lines")
      .select("id, shop_id, square_order_id, square_line_uid, line_kind, created_at")
      .in("shop_id", shopIds)
      .in("square_order_id", orderIds);
    if (readError) throw new Error(readError.message);
    const byKey = new Map((existing ?? []).map((row) => [`${row.shop_id}|${row.square_order_id}|${row.square_line_uid}|${row.line_kind}`, row]));
    const payload = lines.map((line) => {
      const prev = byKey.get(`${line.shopId}|${line.squareOrderId}|${line.squareLineUid}|${line.lineKind}`);
      return ledgerRow({ ...line, id: (prev?.id as string) ?? line.id, createdAt: (prev?.created_at as string) ?? line.createdAt });
    });
    const { error } = await this.db().from("ledger_lines").upsert(payload, { onConflict: "shop_id,square_order_id,square_line_uid,line_kind" });
    if (error) throw new Error(error.message);
  }

  async updateLedgerLine(id: string, patch: Partial<LedgerLine>): Promise<LedgerLine> {
    const { data: existing, error: readError } = await this.db().from("ledger_lines").select("*").eq("id", id).single();
    if (readError) throw new Error(readError.message);
    const next = { ...ledger(existing), ...patch, id };
    const { error } = await this.db().from("ledger_lines").update(ledgerRow(next)).eq("id", id);
    if (error) throw new Error(error.message);
    return next;
  }

  async listUnassigned(shopId: string, status?: UnassignedItem["status"]): Promise<UnassignedItem[]> {
    let query = this.db().from("unassigned_queue").select("*").eq("shop_id", shopId).order("created_at");
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(unassigned);
  }

  async ensureUnassigned(item: { shopId: string; ledgerLineId: string; reason: string }): Promise<void> {
    const { data, error } = await this.db().from("unassigned_queue").select("id, status").eq("ledger_line_id", item.ledgerLineId).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) {
      if (data.status === "open") {
        const { error: updateError } = await this.db().from("unassigned_queue").update({ reason: item.reason }).eq("id", data.id);
        if (updateError) throw new Error(updateError.message);
      }
      return;
    }
    const { error: insertError } = await this.db().from("unassigned_queue").insert({
      id: crypto.randomUUID(),
      shop_id: item.shopId,
      ledger_line_id: item.ledgerLineId,
      reason: item.reason,
      status: "open",
    });
    if (insertError) throw new Error(insertError.message);
  }

  async resolveUnassigned(id: string, resolution: { status: "allocated" | "ignored"; vendorId: string | null; resolvedAt: string }): Promise<UnassignedItem> {
    const { data, error } = await this.db()
      .from("unassigned_queue")
      .update({ status: resolution.status, allocated_vendor_id: resolution.vendorId, resolved_at: resolution.resolvedAt })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return unassigned(data);
  }

  async listStatements(shopId: string): Promise<Statement[]> {
    const { data, error } = await this.db().from("statements").select("*").eq("shop_id", shopId).order("period_ym", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(statement);
  }

  async getStatement(id: string): Promise<Statement | null> {
    const { data, error } = await this.db().from("statements").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? statement(data) : null;
  }

  async upsertStatement(value: Statement): Promise<Statement> {
    const { data: existing, error: readError } = await this.db()
      .from("statements")
      .select("*")
      .eq("shop_id", value.shopId)
      .eq("vendor_id", value.vendorId)
      .eq("period_ym", value.periodYm)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (existing && ["approved", "paid"].includes(existing.status) && ["draft", "pending_review"].includes(value.status)) {
      return statement(existing);
    }
    const payload = statementRow({ ...value, id: (existing?.id as string) ?? value.id });
    const { data, error } = await this.db().from("statements").upsert(payload, { onConflict: "shop_id,vendor_id,period_ym" }).select("*").single();
    if (error) throw new Error(error.message);
    return statement(data);
  }

  async updateStatement(id: string, patch: Partial<Statement>): Promise<Statement> {
    const current = await this.getStatement(id);
    if (!current) throw new Error("Statement not found");
    const next = { ...current, ...patch, id };
    const { error } = await this.db().from("statements").update(statementRow(next)).eq("id", id);
    if (error) throw new Error(error.message);
    return next;
  }

  async getWebhookEvent(eventId: string): Promise<WebhookEvent | null> {
    const { data, error } = await this.db().from("webhook_events").select("*").eq("event_id", eventId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? webhook(data) : null;
  }

  async insertWebhookEvent(event: WebhookEvent): Promise<void> {
    const { error } = await this.db().from("webhook_events").insert({
      event_id: event.eventId,
      merchant_id: event.merchantId,
      event_type: event.eventType,
      received_at: event.receivedAt,
      processed_at: event.processedAt,
      status: event.status,
      error: event.error,
    });
    if (error) {
      if (error.code === "23505" || /duplicate/i.test(error.message)) throw new Error("duplicate webhook");
      throw new Error(error.message);
    }
  }

  async markWebhook(eventId: string, patch: Partial<WebhookEvent>): Promise<void> {
    const { error } = await this.db()
      .from("webhook_events")
      .update({
        processed_at: patch.processedAt,
        status: patch.status,
        error: patch.error,
      })
      .eq("event_id", eventId);
    if (error) throw new Error(error.message);
  }

  async listWebhookEvents(): Promise<WebhookEvent[]> {
    const { data, error } = await this.db().from("webhook_events").select("*").order("received_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []).map(webhook);
  }

  async addReconcileRun(run: ReconcileRun): Promise<void> {
    const { error } = await this.db().from("reconcile_runs").insert({
      id: run.id,
      shop_id: run.shopId,
      ran_at: run.ranAt,
      window_start: run.windowStart,
      window_end: run.windowEnd,
      square_order_count: run.squareOrderCount,
      ledger_line_count: run.ledgerLineCount,
      mismatch_count: run.mismatchCount,
      notes: run.notes,
    });
    if (error) throw new Error(error.message);
  }

  async latestReconcile(shopId: string): Promise<ReconcileRun | null> {
    const { data, error } = await this.db().from("reconcile_runs").select("*").eq("shop_id", shopId).order("ran_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? reconcile(data) : null;
  }

  async addBackfillRun(run: BackfillRun): Promise<void> {
    const { error } = await this.db().from("backfill_runs").insert({
      id: run.id,
      shop_id: run.shopId,
      status: run.status,
      orders_seen: run.ordersSeen,
      lines_upserted: run.linesUpserted,
      error: run.error,
      started_at: run.startedAt,
      finished_at: run.finishedAt,
    });
    if (error) throw new Error(error.message);
  }

  async updateBackfillRun(id: string, patch: Partial<BackfillRun>): Promise<void> {
    const { error } = await this.db()
      .from("backfill_runs")
      .update({
        status: patch.status,
        orders_seen: patch.ordersSeen,
        lines_upserted: patch.linesUpserted,
        error: patch.error,
        finished_at: patch.finishedAt,
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }

  async latestBackfill(shopId: string): Promise<BackfillRun | null> {
    const { data, error } = await this.db().from("backfill_runs").select("*").eq("shop_id", shopId).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? backfill(data) : null;
  }

  async listAudit(): Promise<AuditEntry[]> {
    const { data, error } = await this.db().from("admin_audit_log").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      id: str(row.id),
      actorUserId: opt(row.actor_user_id),
      action: str(row.action),
      meta: (row.meta as Record<string, unknown>) ?? null,
      createdAt: str(row.created_at),
    }));
  }

  async audit(entry: Omit<AuditEntry, "id" | "createdAt">): Promise<void> {
    const { error } = await this.db().from("admin_audit_log").insert({
      actor_user_id: entry.actorUserId,
      action: entry.action,
      meta: entry.meta,
    });
    if (error) throw new Error(error.message);
  }

  async logEmail(entry: Omit<EmailLog, "id" | "createdAt">): Promise<EmailLog> {
    const id = crypto.randomUUID();
    const createdAt = this.now().toISOString();
    const { error } = await this.db().from("email_log").insert({
      id,
      shop_id: entry.shopId,
      to_email: entry.toEmail,
      template: entry.template,
      subject: entry.subject,
      body_preview: entry.bodyPreview,
      status: entry.status,
      error: entry.error,
      created_at: createdAt,
    });
    if (error) throw new Error(error.message);
    return { ...entry, id, createdAt };
  }

  async listEmails(shopId?: string): Promise<EmailLog[]> {
    let query = this.db().from("email_log").select("*").order("created_at", { ascending: false }).limit(100);
    if (shopId) query = query.eq("shop_id", shopId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(email);
  }

  async deleteSellerSquareData(merchantId: string): Promise<{ shopId: string | null }> {
    const shopId = await this.findShopIdByMerchant(merchantId);
    if (!shopId) return { shopId: null };
    const client = this.db();
    for (const table of ["unassigned_queue", "ledger_lines", "catalog_vendor_attrs", "catalog_items", "shop_locations", "reconcile_runs", "backfill_runs", "square_connections"]) {
      const { error } = await client.from(table).delete().eq(table === "square_connections" ? "shop_id" : "shop_id", shopId);
      if (error) throw new Error(error.message);
    }
    await this.audit({ actorUserId: null, action: "square.authorization.revoked", meta: { shopId, merchantId } });
    return { shopId };
  }

  private async mustShop(id: string): Promise<Shop> {
    const found = await this.getShop(id);
    if (!found) throw new Error("Shop not found");
    return found;
  }
}

function defined<T extends Record<string, unknown>>(row: T): Partial<T> {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "shop";
}

function profile(row: Row): Profile {
  return { id: str(row.id), email: str(row.email), fullName: row.full_name ? str(row.full_name) : null, isPlatformAdmin: Boolean(row.is_platform_admin), createdAt: str(row.created_at) };
}
function shop(row: Row): Shop {
  return {
    id: str(row.id),
    name: str(row.name),
    slug: str(row.slug),
    plan: row.plan as Shop["plan"],
    trialEndsAt: opt(row.trial_ends_at),
    stripeCustomerId: opt(row.stripe_customer_id),
    stripeSubscriptionId: opt(row.stripe_subscription_id),
    stripeStatus: opt(row.stripe_status),
    billingGraceUntil: opt(row.billing_grace_until),
    trialEndingEmailSentAt: opt(row.trial_ending_email_sent_at),
    timezone: str(row.timezone),
    statementDay: Number(row.statement_day),
    createdAt: str(row.created_at),
  };
}
function shopRow(value: Partial<Shop>): Row {
  return defined({
    id: value.id,
    name: value.name,
    slug: value.slug,
    plan: value.plan,
    trial_ends_at: value.trialEndsAt,
    stripe_customer_id: value.stripeCustomerId,
    stripe_subscription_id: value.stripeSubscriptionId,
    stripe_status: value.stripeStatus,
    billing_grace_until: value.billingGraceUntil,
    trial_ending_email_sent_at: value.trialEndingEmailSentAt,
    timezone: value.timezone,
    statement_day: value.statementDay,
    created_at: value.createdAt,
  });
}
function member(row: Row): Membership {
  return { shopId: str(row.shop_id), userId: str(row.user_id), role: row.role as Membership["role"], createdAt: str(row.created_at) };
}
function settings(row: Row): PayoutSettings {
  return {
    shopId: str(row.shop_id),
    excludeSalesTax: Boolean(row.exclude_sales_tax),
    excludeTips: Boolean(row.exclude_tips),
    feeMode: row.fee_mode as PayoutSettings["feeMode"],
    boothRentMode: row.booth_rent_mode as PayoutSettings["boothRentMode"],
    negativeBalanceMode: row.negative_balance_mode as PayoutSettings["negativeBalanceMode"],
    serviceChargeMode: row.service_charge_mode as PayoutSettings["serviceChargeMode"],
    serviceChargeRules: Array.isArray(row.service_charge_rules) ? (row.service_charge_rules as PayoutSettings["serviceChargeRules"]) : [],
    roundingMode: "half_even",
    updatedAt: str(row.updated_at),
  };
}
function settingsRow(value: PayoutSettings): Row {
  return {
    shop_id: value.shopId,
    exclude_sales_tax: value.excludeSalesTax,
    exclude_tips: value.excludeTips,
    fee_mode: value.feeMode,
    booth_rent_mode: value.boothRentMode,
    negative_balance_mode: value.negativeBalanceMode,
    service_charge_mode: value.serviceChargeMode,
    service_charge_rules: value.serviceChargeRules,
    rounding_mode: value.roundingMode,
    updated_at: value.updatedAt,
  };
}
function connection(row: Row): SquareConnection {
  return {
    shopId: str(row.shop_id),
    merchantId: str(row.merchant_id),
    accessTokenCipher: str(row.access_token_cipher),
    refreshTokenCipher: str(row.refresh_token_cipher),
    tokenExpiresAt: str(row.token_expires_at),
    scopes: (row.scopes as string[]) ?? [],
    lastRefreshedAt: opt(row.last_refreshed_at),
    revokedAt: opt(row.revoked_at),
    sandbox: Boolean(row.sandbox),
    createdAt: str(row.created_at),
  };
}
function connectionRow(value: SquareConnection): Row {
  return {
    shop_id: value.shopId,
    merchant_id: value.merchantId,
    access_token_cipher: value.accessTokenCipher,
    refresh_token_cipher: value.refreshTokenCipher,
    token_expires_at: value.tokenExpiresAt,
    scopes: value.scopes,
    last_refreshed_at: value.lastRefreshedAt,
    revoked_at: value.revokedAt,
    sandbox: value.sandbox,
    created_at: value.createdAt,
  };
}
function location(row: Row): ShopLocation {
  return { id: str(row.id), shopId: str(row.shop_id), squareLocationId: str(row.square_location_id), name: str(row.name), active: Boolean(row.active) };
}
function locationRow(value: ShopLocation): Row {
  return { id: value.id, shop_id: value.shopId, square_location_id: value.squareLocationId, name: value.name, active: value.active };
}
function vendor(row: Row): Vendor {
  return {
    id: str(row.id),
    shopId: str(row.shop_id),
    displayName: str(row.display_name),
    email: opt(row.email),
    phone: opt(row.phone),
    commissionBps: Number(row.commission_bps),
    boothRentCents: Number(row.booth_rent_cents),
    payoutMethod: (row.payout_method as Vendor["payoutMethod"]) ?? null,
    payoutDetails: opt(row.payout_details),
    payoutDay: row.payout_day == null ? null : Number(row.payout_day),
    archivedAt: opt(row.archived_at),
    createdAt: str(row.created_at),
  };
}
function vendorRow(value: Vendor): Row {
  return {
    id: value.id,
    shop_id: value.shopId,
    display_name: value.displayName,
    email: value.email,
    phone: value.phone,
    commission_bps: value.commissionBps,
    booth_rent_cents: value.boothRentCents,
    payout_method: value.payoutMethod,
    payout_details: value.payoutDetails,
    payout_day: value.payoutDay,
    archived_at: value.archivedAt,
    created_at: value.createdAt,
  };
}
function portal(row: Row): PortalAccount {
  return { vendorId: str(row.vendor_id), authUserId: opt(row.auth_user_id), invitedEmail: str(row.invited_email), invitedAt: str(row.invited_at), lastLoginAt: opt(row.last_login_at) };
}
function catalogItem(row: Row): CatalogItem {
  return {
    shopId: str(row.shop_id),
    catalogObjectId: str(row.catalog_object_id),
    parentObjectId: opt(row.parent_object_id),
    objectType: row.object_type as CatalogItem["objectType"],
    name: opt(row.name),
    sku: opt(row.sku),
    categoryName: opt(row.category_name),
    catalogVersion: row.catalog_version == null ? null : Number(row.catalog_version),
    updatedAt: str(row.updated_at),
  };
}
function catalogItemRow(value: CatalogItem): Row {
  return {
    shop_id: value.shopId,
    catalog_object_id: value.catalogObjectId,
    parent_object_id: value.parentObjectId,
    object_type: value.objectType,
    name: value.name,
    sku: value.sku,
    category_name: value.categoryName,
    catalog_version: value.catalogVersion,
    updated_at: value.updatedAt,
  };
}
function catalogAttr(row: Row): CatalogAttr {
  return {
    shopId: str(row.shop_id),
    catalogObjectId: str(row.catalog_object_id),
    catalogVersion: row.catalog_version == null ? null : Number(row.catalog_version),
    vendorId: opt(row.vendor_id),
    vendorAttrValue: opt(row.vendor_attr_value),
    source: row.source as CatalogAttr["source"],
    updatedAt: str(row.updated_at),
  };
}
function catalogAttrRow(value: CatalogAttr): Row {
  return {
    shop_id: value.shopId,
    catalog_object_id: value.catalogObjectId,
    catalog_version: value.catalogVersion,
    vendor_id: value.vendorId,
    vendor_attr_value: value.vendorAttrValue,
    source: value.source,
    updated_at: value.updatedAt,
  };
}
function rule(row: Row): AttributionRule {
  return { id: str(row.id), shopId: str(row.shop_id), priority: Number(row.priority), ruleType: row.rule_type as AttributionRule["ruleType"], pattern: str(row.pattern), vendorId: str(row.vendor_id), active: Boolean(row.active) };
}
function ledger(row: Row): LedgerLine {
  return {
    id: str(row.id),
    shopId: str(row.shop_id),
    locationId: opt(row.location_id),
    vendorId: opt(row.vendor_id),
    squareOrderId: str(row.square_order_id),
    squareLineUid: str(row.square_line_uid),
    squarePaymentId: opt(row.square_payment_id),
    catalogObjectId: opt(row.catalog_object_id),
    catalogVersion: row.catalog_version == null ? null : Number(row.catalog_version),
    lineKind: row.line_kind as LedgerLine["lineKind"],
    soldAt: str(row.sold_at),
    periodYm: str(row.period_ym).trim(),
    quantity: String(row.quantity ?? "1"),
    grossCents: Number(row.gross_cents),
    discountCents: Number(row.discount_cents),
    taxCents: Number(row.tax_cents),
    tipCents: Number(row.tip_cents),
    feeCents: Number(row.fee_cents),
    serviceChargeCents: Number(row.service_charge_cents ?? 0),
    baseCents: Number(row.base_cents),
    vendorEarnCents: Number(row.vendor_earn_cents),
    commissionBps: row.commission_bps == null ? null : Number(row.commission_bps),
    feeMode: (row.fee_mode as LedgerLine["feeMode"]) ?? "shop_absorbs",
    attributionSource: opt(row.attribution_source),
    isOffline: Boolean(row.is_offline),
    statementId: opt(row.statement_id),
    sourceOrderId: opt(row.source_order_id),
    sourceLineUid: opt(row.source_line_uid),
    itemName: opt(row.item_name),
    currency: str(row.currency || "USD"),
    rawHash: str(row.raw_hash),
    createdAt: str(row.created_at),
  };
}
function ledgerRow(value: LedgerLine): Row {
  return {
    id: value.id,
    shop_id: value.shopId,
    location_id: value.locationId,
    vendor_id: value.vendorId,
    square_order_id: value.squareOrderId,
    square_line_uid: value.squareLineUid,
    square_payment_id: value.squarePaymentId,
    catalog_object_id: value.catalogObjectId,
    catalog_version: value.catalogVersion,
    line_kind: value.lineKind,
    sold_at: value.soldAt,
    period_ym: value.periodYm,
    quantity: value.quantity,
    gross_cents: value.grossCents,
    discount_cents: value.discountCents,
    tax_cents: value.taxCents,
    tip_cents: value.tipCents,
    fee_cents: value.feeCents,
    service_charge_cents: value.serviceChargeCents,
    base_cents: value.baseCents,
    vendor_earn_cents: value.vendorEarnCents,
    commission_bps: value.commissionBps,
    fee_mode: value.feeMode,
    attribution_source: value.attributionSource,
    is_offline: value.isOffline,
    statement_id: value.statementId,
    source_order_id: value.sourceOrderId,
    source_line_uid: value.sourceLineUid,
    item_name: value.itemName,
    currency: value.currency,
    raw_hash: value.rawHash,
    created_at: value.createdAt,
  };
}
function unassigned(row: Row): UnassignedItem {
  return { id: str(row.id), shopId: str(row.shop_id), ledgerLineId: str(row.ledger_line_id), reason: str(row.reason), status: row.status as UnassignedItem["status"], allocatedVendorId: opt(row.allocated_vendor_id), resolvedAt: opt(row.resolved_at), createdAt: str(row.created_at) };
}
function statement(row: Row): Statement {
  return {
    id: str(row.id),
    shopId: str(row.shop_id),
    vendorId: str(row.vendor_id),
    periodYm: str(row.period_ym).trim(),
    status: row.status as Statement["status"],
    openingBalanceCents: Number(row.opening_balance_cents),
    salesEarnCents: Number(row.sales_earn_cents),
    refundsCents: Number(row.refunds_cents),
    adjustmentsCents: Number(row.adjustments_cents),
    boothRentCents: Number(row.booth_rent_cents),
    payoutCents: Number(row.payout_cents),
    squareSalesTotalCents: row.square_sales_total_cents == null ? null : Number(row.square_sales_total_cents),
    reconcileDeltaCents: row.reconcile_delta_cents == null ? null : Number(row.reconcile_delta_cents),
    pdfPath: opt(row.pdf_path),
    csvPath: opt(row.csv_path),
    approvedAt: opt(row.approved_at),
    paidAt: opt(row.paid_at),
    paidMethod: opt(row.paid_method),
    paidReference: opt(row.paid_reference),
    writtenOffAt: opt(row.written_off_at),
  };
}
function statementRow(value: Statement): Row {
  return {
    id: value.id,
    shop_id: value.shopId,
    vendor_id: value.vendorId,
    period_ym: value.periodYm,
    status: value.status,
    opening_balance_cents: value.openingBalanceCents,
    sales_earn_cents: value.salesEarnCents,
    refunds_cents: value.refundsCents,
    adjustments_cents: value.adjustmentsCents,
    booth_rent_cents: value.boothRentCents,
    payout_cents: value.payoutCents,
    square_sales_total_cents: value.squareSalesTotalCents,
    reconcile_delta_cents: value.reconcileDeltaCents,
    pdf_path: value.pdfPath,
    csv_path: value.csvPath,
    approved_at: value.approvedAt,
    paid_at: value.paidAt,
    paid_method: value.paidMethod,
    paid_reference: value.paidReference,
    written_off_at: value.writtenOffAt,
  };
}
function webhook(row: Row): WebhookEvent {
  return { eventId: str(row.event_id), merchantId: opt(row.merchant_id), eventType: str(row.event_type), receivedAt: str(row.received_at), processedAt: opt(row.processed_at), status: row.status as WebhookEvent["status"], error: opt(row.error) };
}
function reconcile(row: Row): ReconcileRun {
  return { id: str(row.id), shopId: str(row.shop_id), ranAt: str(row.ran_at), windowStart: str(row.window_start), windowEnd: str(row.window_end), squareOrderCount: Number(row.square_order_count ?? 0), ledgerLineCount: Number(row.ledger_line_count ?? 0), mismatchCount: Number(row.mismatch_count ?? 0), notes: (row.notes as Record<string, unknown>) ?? {} };
}
function backfill(row: Row): BackfillRun {
  return { id: str(row.id), shopId: str(row.shop_id), status: row.status as BackfillRun["status"], ordersSeen: Number(row.orders_seen ?? 0), linesUpserted: Number(row.lines_upserted ?? 0), error: opt(row.error), startedAt: str(row.started_at), finishedAt: opt(row.finished_at) };
}
function email(row: Row): EmailLog {
  return { id: str(row.id), shopId: opt(row.shop_id), toEmail: str(row.to_email), template: str(row.template), subject: str(row.subject), bodyPreview: str(row.body_preview ?? ""), status: row.status as EmailLog["status"], error: opt(row.error), createdAt: str(row.created_at) };
}
function str(value: unknown): string {
  return String(value ?? "");
}
function opt(value: unknown): string | null {
  return value == null || value === "" ? null : String(value);
}

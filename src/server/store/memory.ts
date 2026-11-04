import { sameLine } from "@/domain/ingest";
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
import type { AppStore, LedgerFilter, StoreDump } from "./types";

function emptyDump(): StoreDump {
  return {
    users: [],
    shops: [],
    members: [],
    settings: [],
    connections: [],
    locations: [],
    vendors: [],
    portals: [],
    catalogItems: [],
    catalogAttrs: [],
    rules: [],
    ledger: [],
    unassigned: [],
    statements: [],
    webhooks: [],
    reconciles: [],
    backfills: [],
    audit: [],
    emails: [],
  };
}

export class MemoryStore implements AppStore {
  private db: StoreDump;

  constructor(
    initial?: Partial<StoreDump>,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.db = { ...emptyDump(), ...initial };
  }

  now(): Date {
    return this.clock();
  }

  dump(): StoreDump {
    return structuredClone(this.db);
  }

  replace(dump: StoreDump): void {
    this.db = structuredClone(dump);
  }

  async getUser(id: string): Promise<Profile | null> {
    return this.db.users.find((user) => user.id === id) ?? null;
  }

  async getUserByEmail(email: string): Promise<Profile | null> {
    return this.db.users.find((user) => user.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async upsertUser(user: Profile): Promise<void> {
    const index = this.db.users.findIndex((row) => row.id === user.id);
    if (index >= 0) this.db.users[index] = user;
    else this.db.users.push(user);
  }

  async listShopsForUser(userId: string): Promise<Shop[]> {
    const ids = new Set(this.db.members.filter((member) => member.userId === userId).map((member) => member.shopId));
    return this.db.shops.filter((shop) => ids.has(shop.id));
  }

  async listAllShops(): Promise<Shop[]> {
    return [...this.db.shops];
  }

  async getShop(id: string): Promise<Shop | null> {
    return this.db.shops.find((shop) => shop.id === id) ?? null;
  }

  async createShop(input: { userId: string; name: string; timezone: string; statementDay: number }): Promise<Shop> {
    const now = this.clock().toISOString();
    const shop: Shop = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      slug: slugify(input.name),
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
    };
    this.db.shops.push(shop);
    this.db.members.push({ shopId: shop.id, userId: input.userId, role: "owner", createdAt: now });
    this.db.settings.push(defaultSettings(shop.id, now));
    return shop;
  }

  async updateShop(id: string, patch: Partial<Shop>): Promise<Shop> {
    const shop = await this.mustShop(id);
    Object.assign(shop, patch, { id });
    return shop;
  }

  async getMembership(shopId: string, userId: string): Promise<Membership | null> {
    return this.db.members.find((member) => member.shopId === shopId && member.userId === userId) ?? null;
  }

  async listMembers(shopId: string): Promise<Membership[]> {
    return this.db.members.filter((member) => member.shopId === shopId);
  }

  async listMembershipsForUser(userId: string): Promise<Membership[]> {
    return this.db.members.filter((member) => member.userId === userId);
  }

  async getSettings(shopId: string): Promise<PayoutSettings> {
    return this.db.settings.find((row) => row.shopId === shopId) ?? defaultSettings(shopId, this.clock().toISOString());
  }

  async updateSettings(shopId: string, patch: Partial<PayoutSettings>): Promise<PayoutSettings> {
    const current = await this.getSettings(shopId);
    const next = { ...current, ...patch, shopId, updatedAt: this.clock().toISOString() };
    const index = this.db.settings.findIndex((row) => row.shopId === shopId);
    if (index >= 0) this.db.settings[index] = next;
    else this.db.settings.push(next);
    return next;
  }

  async getConnection(shopId: string): Promise<SquareConnection | null> {
    return this.db.connections.find((row) => row.shopId === shopId && !row.revokedAt) ?? null;
  }

  async upsertConnection(connection: SquareConnection): Promise<void> {
    const index = this.db.connections.findIndex((row) => row.shopId === connection.shopId);
    if (index >= 0) this.db.connections[index] = connection;
    else this.db.connections.push(connection);
  }

  async listConnections(): Promise<SquareConnection[]> {
    return this.db.connections.filter((row) => !row.revokedAt);
  }

  async findShopIdByMerchant(merchantId: string): Promise<string | null> {
    return this.db.connections.find((row) => row.merchantId === merchantId && !row.revokedAt)?.shopId ?? null;
  }

  async listLocations(shopId: string): Promise<ShopLocation[]> {
    return this.db.locations.filter((row) => row.shopId === shopId);
  }

  async addLocation(location: ShopLocation): Promise<ShopLocation> {
    const shop = await this.mustShop(location.shopId);
    if (location.active) {
      const active = this.db.locations.filter((row) => row.shopId === location.shopId && row.active).length;
      assertCanAddLocation(resolveAccess(shop, this.clock()), active);
    }
    this.db.locations.push(location);
    return location;
  }

  async saveLocations(shopId: string, locations: ShopLocation[]): Promise<void> {
    this.db.locations = this.db.locations.filter((row) => row.shopId !== shopId).concat(locations);
  }

  async listVendors(shopId: string, includeArchived = false): Promise<Vendor[]> {
    return this.db.vendors.filter((vendor) => vendor.shopId === shopId && (includeArchived || !vendor.archivedAt));
  }

  async getVendor(id: string): Promise<Vendor | null> {
    return this.db.vendors.find((vendor) => vendor.id === id) ?? null;
  }

  async createVendor(input: Omit<Vendor, "id" | "createdAt" | "archivedAt"> & { id?: string }): Promise<Vendor> {
    const shop = await this.mustShop(input.shopId);
    const active = this.db.vendors.filter((vendor) => vendor.shopId === input.shopId && !vendor.archivedAt).length;
    assertCanCreateVendor(resolveAccess(shop, this.clock()), active);
    const vendor: Vendor = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      archivedAt: null,
      createdAt: this.clock().toISOString(),
    };
    this.db.vendors.push(vendor);
    return vendor;
  }

  async updateVendor(id: string, patch: Partial<Vendor>): Promise<Vendor> {
    const vendor = this.db.vendors.find((row) => row.id === id);
    if (!vendor) throw new Error("Vendor not found");
    const restoring = vendor.archivedAt && patch.archivedAt === null;
    if (restoring) {
      const shop = await this.mustShop(vendor.shopId);
      const active = this.db.vendors.filter((row) => row.shopId === vendor.shopId && !row.archivedAt).length;
      assertCanCreateVendor(resolveAccess(shop, this.clock()), active);
    }
    Object.assign(vendor, patch, { id: vendor.id, shopId: vendor.shopId });
    return vendor;
  }

  async getPortalByUser(userId: string): Promise<PortalAccount | null> {
    return this.db.portals.find((row) => row.authUserId === userId) ?? null;
  }

  async getPortalByVendor(vendorId: string): Promise<PortalAccount | null> {
    return this.db.portals.find((row) => row.vendorId === vendorId) ?? null;
  }

  async upsertPortal(account: PortalAccount): Promise<void> {
    const index = this.db.portals.findIndex((row) => row.vendorId === account.vendorId);
    if (index >= 0) this.db.portals[index] = account;
    else this.db.portals.push(account);
  }

  async listCatalogItems(shopId: string): Promise<CatalogItem[]> {
    return this.db.catalogItems.filter((row) => row.shopId === shopId);
  }

  async upsertCatalogItems(items: CatalogItem[]): Promise<void> {
    for (const item of items) {
      const index = this.db.catalogItems.findIndex(
        (row) => row.shopId === item.shopId && row.catalogObjectId === item.catalogObjectId,
      );
      if (index >= 0) this.db.catalogItems[index] = item;
      else this.db.catalogItems.push(item);
    }
  }

  async listCatalogAttrs(shopId: string): Promise<CatalogAttr[]> {
    return this.db.catalogAttrs.filter((row) => row.shopId === shopId);
  }

  async upsertCatalogAttr(attr: CatalogAttr): Promise<void> {
    const index = this.db.catalogAttrs.findIndex(
      (row) => row.shopId === attr.shopId && row.catalogObjectId === attr.catalogObjectId,
    );
    if (index >= 0) this.db.catalogAttrs[index] = attr;
    else this.db.catalogAttrs.push(attr);
  }

  async listRules(shopId: string): Promise<AttributionRule[]> {
    return this.db.rules.filter((row) => row.shopId === shopId).sort((a, b) => a.priority - b.priority);
  }

  async createRule(rule: Omit<AttributionRule, "id"> & { id?: string }): Promise<AttributionRule> {
    const saved: AttributionRule = { ...rule, id: rule.id ?? crypto.randomUUID() };
    this.db.rules.push(saved);
    return saved;
  }

  async deleteRule(id: string): Promise<void> {
    this.db.rules = this.db.rules.filter((rule) => rule.id !== id);
  }

  async listLedger(shopId: string, filter: LedgerFilter = {}): Promise<LedgerLine[]> {
    return this.db.ledger.filter((line) => {
      if (line.shopId !== shopId) return false;
      if (filter.vendorId && line.vendorId !== filter.vendorId) return false;
      if (filter.locationId && line.locationId !== filter.locationId) return false;
      if (filter.periodYm && line.periodYm !== filter.periodYm) return false;
      if (filter.from && line.soldAt < filter.from) return false;
      if (filter.to && line.soldAt > filter.to) return false;
      return true;
    });
  }

  async upsertLedgerLines(lines: LedgerLine[]): Promise<void> {
    for (const line of lines) {
      const index = this.db.ledger.findIndex((row) => sameLine(row, line));
      if (index >= 0) this.db.ledger[index] = { ...line, id: this.db.ledger[index].id, createdAt: this.db.ledger[index].createdAt };
      else this.db.ledger.push(line);
    }
  }

  async updateLedgerLine(id: string, patch: Partial<LedgerLine>): Promise<LedgerLine> {
    const line = this.db.ledger.find((row) => row.id === id);
    if (!line) throw new Error("Ledger line not found");
    Object.assign(line, patch, { id: line.id });
    return line;
  }

  async listUnassigned(shopId: string, status?: UnassignedItem["status"]): Promise<UnassignedItem[]> {
    return this.db.unassigned.filter((row) => row.shopId === shopId && (!status || row.status === status));
  }

  async ensureUnassigned(item: { shopId: string; ledgerLineId: string; reason: string }): Promise<void> {
    const existing = this.db.unassigned.find((row) => row.ledgerLineId === item.ledgerLineId);
    if (existing) {
      if (existing.status !== "open") return;
      existing.reason = item.reason;
      return;
    }
    this.db.unassigned.push({
      id: crypto.randomUUID(),
      shopId: item.shopId,
      ledgerLineId: item.ledgerLineId,
      reason: item.reason,
      status: "open",
      allocatedVendorId: null,
      resolvedAt: null,
      createdAt: this.clock().toISOString(),
    });
  }

  async resolveUnassigned(
    id: string,
    resolution: { status: "allocated" | "ignored"; vendorId: string | null; resolvedAt: string },
  ): Promise<UnassignedItem> {
    const row = this.db.unassigned.find((item) => item.id === id);
    if (!row) throw new Error("Queue item not found");
    row.status = resolution.status;
    row.allocatedVendorId = resolution.vendorId;
    row.resolvedAt = resolution.resolvedAt;
    return row;
  }

  async listStatements(shopId: string): Promise<Statement[]> {
    return this.db.statements.filter((row) => row.shopId === shopId);
  }

  async getStatement(id: string): Promise<Statement | null> {
    return this.db.statements.find((row) => row.id === id) ?? null;
  }

  async upsertStatement(statement: Statement): Promise<Statement> {
    const index = this.db.statements.findIndex(
      (row) => row.shopId === statement.shopId && row.vendorId === statement.vendorId && row.periodYm === statement.periodYm,
    );
    if (index >= 0) {
      const prev = this.db.statements[index];
      this.db.statements[index] = { ...statement, id: prev.id };
      return this.db.statements[index];
    }
    this.db.statements.push(statement);
    return statement;
  }

  async updateStatement(id: string, patch: Partial<Statement>): Promise<Statement> {
    const statement = this.db.statements.find((row) => row.id === id);
    if (!statement) throw new Error("Statement not found");
    Object.assign(statement, patch, { id });
    return statement;
  }

  async getWebhookEvent(eventId: string): Promise<WebhookEvent | null> {
    return this.db.webhooks.find((row) => row.eventId === eventId) ?? null;
  }

  async insertWebhookEvent(event: WebhookEvent): Promise<void> {
    if (this.db.webhooks.some((row) => row.eventId === event.eventId)) {
      throw new Error("duplicate webhook");
    }
    this.db.webhooks.push(event);
  }

  async markWebhook(eventId: string, patch: Partial<WebhookEvent>): Promise<void> {
    const event = this.db.webhooks.find((row) => row.eventId === eventId);
    if (!event) throw new Error("webhook not found");
    Object.assign(event, patch, { eventId });
  }

  async listWebhookEvents(): Promise<WebhookEvent[]> {
    return [...this.db.webhooks];
  }

  async addReconcileRun(run: ReconcileRun): Promise<void> {
    this.db.reconciles.push(run);
  }

  async latestReconcile(shopId: string): Promise<ReconcileRun | null> {
    const rows = this.db.reconciles.filter((row) => row.shopId === shopId);
    return rows[rows.length - 1] ?? null;
  }

  async addBackfillRun(run: BackfillRun): Promise<void> {
    this.db.backfills.push(run);
  }

  async updateBackfillRun(id: string, patch: Partial<BackfillRun>): Promise<void> {
    const run = this.db.backfills.find((row) => row.id === id);
    if (!run) throw new Error("backfill not found");
    Object.assign(run, patch, { id });
  }

  async latestBackfill(shopId: string): Promise<BackfillRun | null> {
    const rows = this.db.backfills.filter((row) => row.shopId === shopId);
    return rows[rows.length - 1] ?? null;
  }

  async audit(entry: Omit<AuditEntry, "id" | "createdAt">): Promise<void> {
    this.db.audit.push({ ...entry, id: crypto.randomUUID(), createdAt: this.clock().toISOString() });
  }

  async listAudit(): Promise<AuditEntry[]> {
    return [...this.db.audit].reverse();
  }

  async logEmail(entry: Omit<EmailLog, "id" | "createdAt">): Promise<EmailLog> {
    const saved: EmailLog = { ...entry, id: crypto.randomUUID(), createdAt: this.clock().toISOString() };
    this.db.emails.push(saved);
    return saved;
  }

  async listEmails(shopId?: string): Promise<EmailLog[]> {
    return this.db.emails.filter((row) => !shopId || row.shopId === shopId);
  }

  async deleteSellerSquareData(merchantId: string): Promise<{ shopId: string | null }> {
    const connection = this.db.connections.find((row) => row.merchantId === merchantId);
    if (!connection) return { shopId: null };
    const shopId = connection.shopId;
    this.db.connections = this.db.connections.filter((row) => row.shopId !== shopId);
    this.db.catalogAttrs = this.db.catalogAttrs.filter((row) => row.shopId !== shopId);
    this.db.catalogItems = this.db.catalogItems.filter((row) => row.shopId !== shopId);
    this.db.locations = this.db.locations.filter((row) => row.shopId !== shopId);
    const lineIds = new Set(this.db.ledger.filter((row) => row.shopId === shopId).map((row) => row.id));
    this.db.ledger = this.db.ledger.filter((row) => row.shopId !== shopId);
    this.db.unassigned = this.db.unassigned.filter((row) => !lineIds.has(row.ledgerLineId));
    this.db.reconciles = this.db.reconciles.filter((row) => row.shopId !== shopId);
    this.db.backfills = this.db.backfills.filter((row) => row.shopId !== shopId);
    await this.audit({
      actorUserId: null,
      action: "square.authorization.revoked",
      meta: { shopId, merchantId },
    });
    return { shopId };
  }

  private async mustShop(id: string): Promise<Shop> {
    const shop = await this.getShop(id);
    if (!shop) throw new Error("Shop not found");
    return shop;
  }
}

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "shop";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

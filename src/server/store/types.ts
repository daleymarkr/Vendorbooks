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

export type LedgerFilter = {
  vendorId?: string;
  locationId?: string;
  periodYm?: string;
  from?: string;
  to?: string;
};

export interface AppStore {
  now(): Date;
  getUser(id: string): Promise<Profile | null>;
  getUserByEmail(email: string): Promise<Profile | null>;
  upsertUser(user: Profile): Promise<void>;
  listShopsForUser(userId: string): Promise<Shop[]>;
  listAllShops(): Promise<Shop[]>;
  getShop(id: string): Promise<Shop | null>;
  createShop(input: { userId: string; name: string; timezone: string; statementDay: number }): Promise<Shop>;
  updateShop(id: string, patch: Partial<Shop>): Promise<Shop>;
  getMembership(shopId: string, userId: string): Promise<Membership | null>;
  listMembers(shopId: string): Promise<Membership[]>;
  listMembershipsForUser(userId: string): Promise<Membership[]>;
  getSettings(shopId: string): Promise<PayoutSettings>;
  updateSettings(shopId: string, patch: Partial<PayoutSettings>): Promise<PayoutSettings>;
  getConnection(shopId: string): Promise<SquareConnection | null>;
  upsertConnection(connection: SquareConnection): Promise<void>;
  listConnections(): Promise<SquareConnection[]>;
  findShopIdByMerchant(merchantId: string): Promise<string | null>;
  listLocations(shopId: string): Promise<ShopLocation[]>;
  addLocation(location: ShopLocation): Promise<ShopLocation>;
  saveLocations(shopId: string, locations: ShopLocation[]): Promise<void>;
  listVendors(shopId: string, includeArchived?: boolean): Promise<Vendor[]>;
  getVendor(id: string): Promise<Vendor | null>;
  createVendor(vendor: Omit<Vendor, "id" | "createdAt" | "archivedAt"> & { id?: string }): Promise<Vendor>;
  updateVendor(id: string, patch: Partial<Vendor>): Promise<Vendor>;
  getPortalByUser(userId: string): Promise<PortalAccount | null>;
  getPortalByVendor(vendorId: string): Promise<PortalAccount | null>;
  upsertPortal(account: PortalAccount): Promise<void>;
  listCatalogItems(shopId: string): Promise<CatalogItem[]>;
  upsertCatalogItems(items: CatalogItem[]): Promise<void>;
  listCatalogAttrs(shopId: string): Promise<CatalogAttr[]>;
  upsertCatalogAttr(attr: CatalogAttr): Promise<void>;
  listRules(shopId: string): Promise<AttributionRule[]>;
  createRule(rule: Omit<AttributionRule, "id"> & { id?: string }): Promise<AttributionRule>;
  deleteRule(id: string): Promise<void>;
  listLedger(shopId: string, filter?: LedgerFilter): Promise<LedgerLine[]>;
  upsertLedgerLines(lines: LedgerLine[]): Promise<void>;
  updateLedgerLine(id: string, patch: Partial<LedgerLine>): Promise<LedgerLine>;
  listUnassigned(shopId: string, status?: UnassignedItem["status"]): Promise<UnassignedItem[]>;
  ensureUnassigned(item: Omit<UnassignedItem, "id" | "createdAt" | "resolvedAt" | "allocatedVendorId" | "status"> & { reason: string }): Promise<void>;
  resolveUnassigned(id: string, resolution: { status: "allocated" | "ignored"; vendorId: string | null; resolvedAt: string }): Promise<UnassignedItem>;
  listStatements(shopId: string): Promise<Statement[]>;
  getStatement(id: string): Promise<Statement | null>;
  upsertStatement(statement: Statement): Promise<Statement>;
  updateStatement(id: string, patch: Partial<Statement>): Promise<Statement>;
  getWebhookEvent(eventId: string): Promise<WebhookEvent | null>;
  insertWebhookEvent(event: WebhookEvent): Promise<void>;
  markWebhook(eventId: string, patch: Partial<WebhookEvent>): Promise<void>;
  listWebhookEvents(): Promise<WebhookEvent[]>;
  addReconcileRun(run: ReconcileRun): Promise<void>;
  latestReconcile(shopId: string): Promise<ReconcileRun | null>;
  addBackfillRun(run: BackfillRun): Promise<void>;
  updateBackfillRun(id: string, patch: Partial<BackfillRun>): Promise<void>;
  latestBackfill(shopId: string): Promise<BackfillRun | null>;
  audit(entry: Omit<AuditEntry, "id" | "createdAt">): Promise<void>;
  listAudit(): Promise<AuditEntry[]>;
  logEmail(entry: Omit<EmailLog, "id" | "createdAt">): Promise<EmailLog>;
  listEmails(shopId?: string): Promise<EmailLog[]>;
  deleteSellerSquareData(merchantId: string): Promise<{ shopId: string | null }>;
  dump(): StoreDump;
  replace(dump: StoreDump): void;
}

export type StoreDump = {
  users: Profile[];
  shops: Shop[];
  members: Membership[];
  settings: PayoutSettings[];
  connections: SquareConnection[];
  locations: ShopLocation[];
  vendors: Vendor[];
  portals: PortalAccount[];
  catalogItems: CatalogItem[];
  catalogAttrs: CatalogAttr[];
  rules: AttributionRule[];
  ledger: LedgerLine[];
  unassigned: UnassignedItem[];
  statements: Statement[];
  webhooks: WebhookEvent[];
  reconciles: ReconcileRun[];
  backfills: BackfillRun[];
  audit: AuditEntry[];
  emails: EmailLog[];
};

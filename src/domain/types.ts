export type PlanId = "free" | "shop" | "mall";
export type MemberRole = "owner" | "manager" | "bookkeeper";
export type FeeMode = "shop_absorbs" | "pass_through";
export type BoothRentMode = "deduct" | "separate";
export type NegativeBalanceMode = "carry" | "forgive";
export type ServiceChargeMode = "exclude" | "include" | "map";
export type PayoutMethod = "check" | "ach" | "zelle" | "other";
export type LineKind = "sale" | "refund" | "adjustment" | "booth_rent" | "fee_passthrough";
export type AttributionSource =
  | "override"
  | "square_attr"
  | "sku_rule"
  | "category_rule"
  | "name_rule"
  | "csv"
  | "manual"
  | "unassigned";
export type StatementStatus = "draft" | "pending_review" | "approved" | "paid";
export type UnassignedStatus = "open" | "allocated" | "ignored";

export type ServiceChargeRule = {
  name: string;
  target: "shop" | "base" | "vendor";
  vendorId?: string | null;
};

export type Shop = {
  id: string;
  name: string;
  slug: string;
  plan: PlanId;
  trialEndsAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeStatus: string | null;
  billingGraceUntil: string | null;
  trialEndingEmailSentAt: string | null;
  timezone: string;
  statementDay: number;
  createdAt: string;
};

export type Profile = {
  id: string;
  email: string;
  fullName: string | null;
  isPlatformAdmin: boolean;
  createdAt: string;
};

export type Membership = {
  shopId: string;
  userId: string;
  role: MemberRole;
  createdAt: string;
};

export type PayoutSettings = {
  shopId: string;
  excludeSalesTax: boolean;
  excludeTips: boolean;
  feeMode: FeeMode;
  boothRentMode: BoothRentMode;
  negativeBalanceMode: NegativeBalanceMode;
  serviceChargeMode: ServiceChargeMode;
  serviceChargeRules: ServiceChargeRule[];
  roundingMode: "half_even";
  updatedAt: string;
};

export type SquareConnection = {
  shopId: string;
  merchantId: string;
  accessTokenCipher: string;
  refreshTokenCipher: string;
  tokenExpiresAt: string;
  scopes: string[];
  lastRefreshedAt: string | null;
  revokedAt: string | null;
  sandbox: boolean;
  createdAt: string;
};

export type PublicSquareConnection = {
  connected: boolean;
  merchantId?: string;
  sandbox?: boolean;
  tokenExpiresAt?: string;
  lastRefreshedAt?: string | null;
  scopes?: string[];
  revokedAt?: string | null;
};

export type ShopLocation = {
  id: string;
  shopId: string;
  squareLocationId: string;
  name: string;
  active: boolean;
};

export type Vendor = {
  id: string;
  shopId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  commissionBps: number;
  boothRentCents: number;
  payoutMethod: PayoutMethod | null;
  payoutDetails: string | null;
  payoutDay: number | null;
  archivedAt: string | null;
  createdAt: string;
};

export type PortalAccount = {
  vendorId: string;
  authUserId: string | null;
  invitedEmail: string;
  invitedAt: string;
  lastLoginAt: string | null;
};

export type CatalogItem = {
  shopId: string;
  catalogObjectId: string;
  parentObjectId: string | null;
  objectType: "ITEM" | "ITEM_VARIATION";
  name: string | null;
  sku: string | null;
  categoryName: string | null;
  catalogVersion: number | null;
  updatedAt: string;
};

export type CatalogAttr = {
  shopId: string;
  catalogObjectId: string;
  catalogVersion: number | null;
  vendorId: string | null;
  vendorAttrValue: string | null;
  source: "square_attr" | "sku_rule" | "category_rule" | "name_rule" | "csv" | "manual";
  updatedAt: string;
};

export type AttributionRule = {
  id: string;
  shopId: string;
  priority: number;
  ruleType: "sku_prefix" | "category" | "name_pattern";
  pattern: string;
  vendorId: string;
  active: boolean;
};

export type LedgerLine = {
  id: string;
  shopId: string;
  locationId: string | null;
  vendorId: string | null;
  squareOrderId: string;
  squareLineUid: string;
  squarePaymentId: string | null;
  catalogObjectId: string | null;
  catalogVersion: number | null;
  lineKind: LineKind;
  soldAt: string;
  periodYm: string;
  quantity: string;
  grossCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  feeCents: number;
  serviceChargeCents: number;
  baseCents: number;
  vendorEarnCents: number;
  commissionBps: number | null;
  feeMode: FeeMode;
  attributionSource: string | null;
  isOffline: boolean;
  statementId: string | null;
  sourceOrderId: string | null;
  sourceLineUid: string | null;
  itemName: string | null;
  currency: string;
  rawHash: string;
  createdAt: string;
};

export type UnassignedItem = {
  id: string;
  shopId: string;
  ledgerLineId: string;
  reason: string;
  status: UnassignedStatus;
  allocatedVendorId: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type Statement = {
  id: string;
  shopId: string;
  vendorId: string;
  periodYm: string;
  status: StatementStatus;
  openingBalanceCents: number;
  salesEarnCents: number;
  refundsCents: number;
  adjustmentsCents: number;
  boothRentCents: number;
  payoutCents: number;
  squareSalesTotalCents: number | null;
  reconcileDeltaCents: number | null;
  pdfPath: string | null;
  csvPath: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  paidMethod: string | null;
  paidReference: string | null;
  writtenOffAt: string | null;
};

export type WebhookEvent = {
  eventId: string;
  merchantId: string | null;
  eventType: string;
  receivedAt: string;
  processedAt: string | null;
  status: "received" | "processed" | "ignored" | "error";
  error: string | null;
};

export type ReconcileRun = {
  id: string;
  shopId: string;
  ranAt: string;
  windowStart: string;
  windowEnd: string;
  squareOrderCount: number;
  ledgerLineCount: number;
  mismatchCount: number;
  notes: Record<string, unknown>;
};

export type BackfillRun = {
  id: string;
  shopId: string;
  status: "running" | "completed" | "error";
  ordersSeen: number;
  linesUpserted: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type AuditEntry = {
  id: string;
  actorUserId: string | null;
  action: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

export type EmailLog = {
  id: string;
  shopId: string | null;
  toEmail: string;
  template: string;
  subject: string;
  bodyPreview: string;
  status: "logged" | "sent" | "error";
  error: string | null;
  createdAt: string;
};

export type SquareMoney = { amount?: number; currency?: string };

export type SquareOrderLine = {
  uid?: string;
  name?: string;
  quantity?: string;
  catalog_object_id?: string;
  catalog_version?: number;
  item_type?: string;
  gross_sales_money?: SquareMoney;
  total_discount_money?: SquareMoney;
  total_tax_money?: SquareMoney;
  total_money?: SquareMoney;
  variation_total_price_money?: SquareMoney;
  base_price_money?: SquareMoney;
  applied_discounts?: { discount_uid?: string; applied_money?: SquareMoney }[];
  sku?: string;
  category_name?: string;
  note?: string;
};

export type SquareReturnLine = {
  uid?: string;
  source_line_item_uid?: string;
  name?: string;
  quantity?: string;
  item_type?: string;
  catalog_object_id?: string;
  gross_return_money?: SquareMoney;
  total_discount_money?: SquareMoney;
  total_tax_money?: SquareMoney;
  total_money?: SquareMoney;
  applied_discounts?: { applied_money?: SquareMoney }[];
};

export type SquareReturn = {
  uid?: string;
  source_order_id?: string;
  return_line_items?: SquareReturnLine[];
};

export type SquareServiceCharge = {
  name?: string;
  amount_money?: SquareMoney;
  total_money?: SquareMoney;
  applied_money?: SquareMoney;
};

export type SquareOrder = {
  id: string;
  location_id?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  state?: string;
  total_money?: SquareMoney;
  line_items?: SquareOrderLine[];
  returns?: SquareReturn[];
  service_charges?: SquareServiceCharge[];
  tenders?: { id?: string; payment_id?: string }[];
};

export type SquarePayment = {
  id: string;
  order_id?: string;
  status?: string;
  tip_money?: SquareMoney;
  processing_fee?: { amount_money?: SquareMoney; type?: string }[];
  is_offline_payment?: boolean;
  amount_money?: SquareMoney;
};

export const SQUARE_SCOPES = [
  "ORDERS_READ",
  "ITEMS_READ",
  "ITEMS_WRITE",
  "PAYMENTS_READ",
  "MERCHANT_PROFILE_READ",
] as const;

export const VENDOR_ATTR_KEY = "vendorbooks_vendor";

export const PLAN_PRICE_CENTS = {
  shop: { monthly: 4900, annual: 49000 },
  mall: { monthly: 12900, annual: 129000 },
} as const;

export const FORBIDDEN_MONEY_PHRASES = [
  "we pay",
  "we'll pay",
  "we will pay",
  "instant payout",
  "transfer funds",
  "wallet",
  "escrow",
] as const;

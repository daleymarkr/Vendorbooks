import { defaultSettings } from "@/domain/payout";
import type { IngestContext } from "@/domain/ingest";
import type { AttributionCatalog } from "@/domain/attribution";
import type { CatalogAttr, CatalogItem, LedgerLine, PayoutSettings, Vendor } from "@/domain/types";

export const SHOP = "11111111-1111-4111-8111-111111111111";

export function vendor(partial: Partial<Vendor> & Pick<Vendor, "id" | "displayName" | "commissionBps">): Vendor {
  return {
    shopId: SHOP,
    email: null,
    phone: null,
    boothRentCents: 0,
    payoutMethod: "check",
    payoutDetails: null,
    payoutDay: 5,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

export function item(partial: Partial<CatalogItem> & Pick<CatalogItem, "catalogObjectId" | "objectType">): CatalogItem {
  return {
    shopId: SHOP,
    parentObjectId: null,
    name: null,
    sku: null,
    categoryName: null,
    catalogVersion: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

export function attr(partial: Partial<CatalogAttr> & Pick<CatalogAttr, "catalogObjectId" | "vendorId" | "source">): CatalogAttr {
  return {
    shopId: SHOP,
    catalogVersion: 1,
    vendorAttrValue: partial.vendorId,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

export function catalog(overrides: Partial<AttributionCatalog> = {}): AttributionCatalog {
  return {
    items: overrides.items ?? [],
    attrs: overrides.attrs ?? [],
    rules: overrides.rules ?? [],
    vendors: overrides.vendors ?? [],
  };
}

export function context(overrides: Partial<IngestContext> = {}): IngestContext {
  return {
    shopId: SHOP,
    timezone: "America/New_York",
    locationIdBySquareId: { LOC1: "loc-main", LOC2: "loc-annex" },
    catalog: catalog(),
    priorLines: [],
    statementStatus: {},
    closedPeriods: {},
    payments: [],
    nowIso: "2026-11-04T15:00:00.000Z",
    ...overrides,
    settings: overrides.settings ?? defaultSettings(SHOP),
  };
}

export function line(partial: Partial<LedgerLine> & Pick<LedgerLine, "id" | "squareOrderId" | "squareLineUid">): LedgerLine {
  return {
    shopId: SHOP,
    locationId: "loc-main",
    vendorId: null,
    squarePaymentId: null,
    catalogObjectId: null,
    catalogVersion: null,
    lineKind: "sale",
    soldAt: "2026-10-15T16:00:00.000Z",
    periodYm: "2026-10",
    quantity: "1",
    grossCents: 0,
    discountCents: 0,
    taxCents: 0,
    tipCents: 0,
    feeCents: 0,
    serviceChargeCents: 0,
    baseCents: 0,
    vendorEarnCents: 0,
    commissionBps: null,
    feeMode: "shop_absorbs",
    attributionSource: null,
    isOffline: false,
    statementId: null,
    sourceOrderId: null,
    sourceLineUid: null,
    itemName: null,
    currency: "USD",
    rawHash: "hash",
    createdAt: "2026-10-15T16:00:00.000Z",
    ...partial,
  };
}

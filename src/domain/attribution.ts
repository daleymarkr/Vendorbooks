import type { AttributionRule, CatalogAttr, CatalogItem, Vendor } from "./types";

export type AttributionInput = {
  /** Catalog object on the line. Square puts the variation id here for itemized sales. */
  catalogObjectId?: string | null;
  /** Parent ITEM id when known. Checked only after the variation. */
  parentObjectId?: string | null;
  sku?: string | null;
  categoryName?: string | null;
  itemName?: string | null;
  /** Owner override wins over catalog, rules, and CSV. */
  overrideVendorId?: string | null;
};

export type AttributionHit = {
  vendorId: string | null;
  source: "override" | "square_attr" | "sku_rule" | "category_rule" | "name_rule" | "csv" | "manual" | "unassigned";
};

export type AttributionCatalog = {
  items: CatalogItem[];
  attrs: CatalogAttr[];
  rules: AttributionRule[];
  vendors: Vendor[];
};

/**
 * Resolution order from the build spec:
 * override → variation attribute → parent item attribute → rules by priority
 * (sku prefix, category, name pattern) → CSV/manual map → unassigned.
 * A parent Vendor attribute is not assumed to inherit onto variations inside Square.
 */
export function resolveAttribution(input: AttributionInput, catalog: AttributionCatalog): AttributionHit {
  const activeVendors = new Set(catalog.vendors.filter((v) => !v.archivedAt).map((v) => v.id));
  const usable = (vendorId: string | null | undefined): vendorId is string =>
    Boolean(vendorId && activeVendors.has(vendorId));

  if (usable(input.overrideVendorId)) return { vendorId: input.overrideVendorId, source: "override" };

  const variationId = input.catalogObjectId ?? null;
  const parentId =
    input.parentObjectId ??
    catalog.items.find((item) => item.catalogObjectId === variationId)?.parentObjectId ??
    null;

  const variationAttr = variationId ? attrFor(catalog.attrs, variationId) : undefined;
  if (variationAttr && isSquareAttr(variationAttr) && usable(variationAttr.vendorId)) {
    return { vendorId: variationAttr.vendorId, source: "square_attr" };
  }
  const parentAttr = parentId ? attrFor(catalog.attrs, parentId) : undefined;
  if (parentAttr && isSquareAttr(parentAttr) && usable(parentAttr.vendorId)) {
    return { vendorId: parentAttr.vendorId, source: "square_attr" };
  }

  const rules = catalog.rules
    .filter((rule) => rule.active && usable(rule.vendorId))
    .slice()
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  const sku = input.sku ?? catalog.items.find((item) => item.catalogObjectId === variationId)?.sku ?? "";
  const category =
    input.categoryName ??
    catalog.items.find((item) => item.catalogObjectId === variationId)?.categoryName ??
    catalog.items.find((item) => item.catalogObjectId === parentId)?.categoryName ??
    "";
  const name = input.itemName ?? "";

  for (const rule of rules) {
    if (rule.ruleType === "sku_prefix" && sku && sku.toLowerCase().startsWith(rule.pattern.toLowerCase())) {
      return { vendorId: rule.vendorId, source: "sku_rule" };
    }
    if (rule.ruleType === "category" && category && category.toLowerCase() === rule.pattern.toLowerCase()) {
      return { vendorId: rule.vendorId, source: "category_rule" };
    }
    if (rule.ruleType === "name_pattern" && name && nameMatches(name, rule.pattern)) {
      return { vendorId: rule.vendorId, source: "name_rule" };
    }
  }

  const csvHit = [variationAttr, parentAttr].find(
    (attr) => attr && (attr.source === "csv" || attr.source === "manual") && usable(attr.vendorId),
  );
  if (csvHit?.vendorId) return { vendorId: csvHit.vendorId, source: csvHit.source };

  const skuMap = catalog.attrs.find((attr) => {
    if (attr.source !== "csv" && attr.source !== "manual") return false;
    if (!usable(attr.vendorId)) return false;
    const item = catalog.items.find((row) => row.catalogObjectId === attr.catalogObjectId);
    return Boolean(sku && item?.sku && item.sku.toLowerCase() === sku.toLowerCase());
  });
  if (skuMap?.vendorId) return { vendorId: skuMap.vendorId, source: skuMap.source };

  return { vendorId: null, source: "unassigned" };
}

function attrFor(attrs: CatalogAttr[], id: string): CatalogAttr | undefined {
  return attrs.find((attr) => attr.catalogObjectId === id);
}

function isSquareAttr(attr: CatalogAttr): boolean {
  return attr.source === "square_attr";
}

function nameMatches(name: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed.startsWith("/") && trimmed.lastIndexOf("/") > 0) {
    const last = trimmed.lastIndexOf("/");
    const body = trimmed.slice(1, last);
    const flags = trimmed.slice(last + 1);
    try {
      return new RegExp(body, flags || "i").test(name);
    } catch {
      return name.toLowerCase().includes(trimmed.toLowerCase());
    }
  }
  return name.toLowerCase().includes(trimmed.toLowerCase());
}

export function taggedPercent(items: CatalogItem[], attrs: CatalogAttr[]): number {
  const variations = items.filter((item) => item.objectType === "ITEM_VARIATION");
  const pool = variations.length > 0 ? variations : items;
  if (pool.length === 0) return 0;
  const tagged = new Set(attrs.filter((attr) => attr.vendorId).map((attr) => attr.catalogObjectId));
  const hits = pool.filter((item) => {
    if (tagged.has(item.catalogObjectId)) return true;
    if (item.parentObjectId && tagged.has(item.parentObjectId)) return true;
    return false;
  }).length;
  return Math.round((hits / pool.length) * 1000) / 10;
}

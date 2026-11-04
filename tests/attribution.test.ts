import { describe, expect, it } from "vitest";
import { resolveAttribution, taggedPercent } from "@/domain/attribution";
import { attr, catalog, item, vendor } from "./helpers";

const alice = vendor({ id: "alice", displayName: "Alice", commissionBps: 6000 });
const bob = vendor({ id: "bob", displayName: "Bob", commissionBps: 5000 });
const carol = vendor({ id: "carol", displayName: "Carol", commissionBps: 7000 });

describe("attribution order", () => {
  it("prefers the variation attribute and falls back to the parent item", () => {
    const items = [
      item({ catalogObjectId: "ITEM_LAMP", objectType: "ITEM", name: "Lamp" }),
      item({ catalogObjectId: "VAR_LAMP", objectType: "ITEM_VARIATION", parentObjectId: "ITEM_LAMP", sku: "BK-20" }),
      item({ catalogObjectId: "VAR_VASE", objectType: "ITEM_VARIATION", parentObjectId: "ITEM_VASE", sku: "AL-1" }),
    ];
    const attrs = [
      attr({ catalogObjectId: "ITEM_LAMP", vendorId: "bob", source: "square_attr" }),
      attr({ catalogObjectId: "VAR_VASE", vendorId: "alice", source: "square_attr" }),
      attr({ catalogObjectId: "ITEM_VASE", vendorId: "bob", source: "square_attr" }),
    ];
    const book = catalog({ items, attrs, vendors: [alice, bob, carol] });

    expect(resolveAttribution({ catalogObjectId: "VAR_LAMP" }, book)).toEqual({
      vendorId: "bob",
      source: "square_attr",
    });
    expect(resolveAttribution({ catalogObjectId: "VAR_VASE" }, book).vendorId).toBe("alice");
  });

  it("applies sku, category, and name rules by priority before a CSV map", () => {
    const book = catalog({
      items: [item({ catalogObjectId: "VAR_Q", objectType: "ITEM_VARIATION", sku: "AL-9", categoryName: "Textiles", name: "Quilt" })],
      attrs: [attr({ catalogObjectId: "VAR_Q", vendorId: "carol", source: "csv" })],
      rules: [
        { id: "r2", shopId: "s", priority: 20, ruleType: "category", pattern: "Textiles", vendorId: "carol", active: true },
        { id: "r1", shopId: "s", priority: 10, ruleType: "sku_prefix", pattern: "AL-", vendorId: "alice", active: true },
        { id: "r3", shopId: "s", priority: 30, ruleType: "name_pattern", pattern: "quilt", vendorId: "bob", active: true },
      ],
      vendors: [alice, bob, carol],
    });
    expect(resolveAttribution({ catalogObjectId: "VAR_Q", sku: "AL-9", categoryName: "Textiles", itemName: "Quilt" }, book)).toEqual({
      vendorId: "alice",
      source: "sku_rule",
    });
  });

  it("uses a CSV map when no rule matches, and an override before everything", () => {
    const book = catalog({
      items: [item({ catalogObjectId: "VAR_X", objectType: "ITEM_VARIATION", sku: "MISC-1" })],
      attrs: [attr({ catalogObjectId: "VAR_X", vendorId: "carol", source: "csv" })],
      vendors: [alice, bob, carol],
    });
    expect(resolveAttribution({ catalogObjectId: "VAR_X" }, book).source).toBe("csv");
    expect(resolveAttribution({ catalogObjectId: "VAR_X", overrideVendorId: "bob" }, book)).toEqual({
      vendorId: "bob",
      source: "override",
    });
    expect(resolveAttribution({ catalogObjectId: "NOPE", itemName: "Unknown" }, book).vendorId).toBeNull();
  });

  it("matches a name pattern with a regular expression", () => {
    const book = catalog({
      rules: [
        { id: "r", shopId: "s", priority: 1, ruleType: "name_pattern", pattern: "/lamp|vase/i", vendorId: "alice", active: true },
      ],
      vendors: [alice],
    });
    expect(resolveAttribution({ itemName: "Brass Lamp" }, book).vendorId).toBe("alice");
  });

  it("reports the share of variations that have a vendor", () => {
    const items = [
      item({ catalogObjectId: "V1", objectType: "ITEM_VARIATION", parentObjectId: "I1" }),
      item({ catalogObjectId: "V2", objectType: "ITEM_VARIATION", parentObjectId: "I2" }),
    ];
    const attrs = [attr({ catalogObjectId: "I1", vendorId: "alice", source: "square_attr" })];
    expect(taggedPercent(items, attrs)).toBe(50);
  });
});

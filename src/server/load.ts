import "server-only";

import { resolveAccess } from "@/domain/plans";
import { toPublicConnection } from "@/domain/square";
import type { MemberRole, PayoutSettings, PublicSquareConnection, Shop, ShopLocation, Vendor } from "@/domain/types";
import type { ShopAccess } from "@/domain/plans";
import { requireViewer, selectedShop, type Viewer } from "@/server/session";
import { getStore, type AppStore } from "@/server/store";

export type ShopBundle = {
  viewer: Viewer;
  shop: Shop | null;
  role: MemberRole | null;
  settings: PayoutSettings | null;
  access: ShopAccess | null;
  vendors: Vendor[];
  locations: ShopLocation[];
  connection: PublicSquareConnection;
  unassigned: number;
  store: AppStore;
};

export async function loadShop(): Promise<ShopBundle> {
  const viewer = await requireViewer();
  const selected = await selectedShop(viewer);
  const store = await getStore();
  if (!selected) {
    return {
      viewer,
      shop: null,
      role: null,
      settings: null,
      access: null,
      vendors: [],
      locations: [],
      connection: { connected: false },
      unassigned: 0,
      store,
    };
  }
  const [settings, vendors, locations, connection, open] = await Promise.all([
    store.getSettings(selected.shop.id),
    store.listVendors(selected.shop.id, true),
    store.listLocations(selected.shop.id),
    store.getConnection(selected.shop.id),
    store.listUnassigned(selected.shop.id, "open"),
  ]);
  return {
    viewer,
    shop: selected.shop,
    role: selected.role,
    settings,
    access: resolveAccess(selected.shop, new Date()),
    vendors,
    locations,
    connection: toPublicConnection(connection),
    unassigned: open.length,
    store,
  };
}

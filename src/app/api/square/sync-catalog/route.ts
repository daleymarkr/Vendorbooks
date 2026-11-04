import { NextResponse } from "next/server";
import { syncCatalog } from "@/server/workflows";
import { loadShop } from "@/server/load";

export async function POST(request: Request) {
  const bundle = await loadShop();
  if (!bundle.shop) return NextResponse.redirect(new URL("/app/connect", request.url));
  try {
    const count = await syncCatalog(bundle.store, bundle.shop.id);
    const message = count ? `Synced ${count} catalog objects.` : "Connect Square to sync the catalog. Demo items are already loaded.";
    return NextResponse.redirect(new URL(`/app/connect?notice=${encodeURIComponent(message)}`, request.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Catalog sync failed.";
    return NextResponse.redirect(new URL(`/app/connect?error=${encodeURIComponent(message)}`, request.url));
  }
}

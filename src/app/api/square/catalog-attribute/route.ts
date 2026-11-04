import { NextResponse } from "next/server";
import { setupCatalogAttribute } from "@/server/workflows";
import { loadShop } from "@/server/load";

export async function POST(request: Request) {
  const bundle = await loadShop();
  if (!bundle.shop) return NextResponse.redirect(new URL("/app/connect", request.url));
  const result = await setupCatalogAttribute(bundle.store, bundle.shop.id);
  const key = result.ok ? "notice" : "error";
  return NextResponse.redirect(new URL(`/app/connect?${key}=${encodeURIComponent(result.message)}`, request.url));
}

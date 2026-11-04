import { NextResponse } from "next/server";
import { backfillShop } from "@/server/workflows";
import { loadShop } from "@/server/load";

export async function POST(request: Request) {
  const bundle = await loadShop();
  if (!bundle.shop || !bundle.role || !["owner", "manager"].includes(bundle.role)) {
    return NextResponse.redirect(new URL("/app/connect?error=Not+allowed", request.url));
  }
  try {
    const result = await backfillShop(bundle.store, bundle.shop.id, bundle.viewer.user.id);
    const notice = result.note ?? `Imported ${result.orders} orders.`;
    return NextResponse.redirect(new URL(`/app/connect?notice=${encodeURIComponent(notice)}`, request.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backfill failed.";
    return NextResponse.redirect(new URL(`/app/connect?error=${encodeURIComponent(message)}`, request.url));
  }
}

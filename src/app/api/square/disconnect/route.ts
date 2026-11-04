import { NextResponse } from "next/server";
import { disconnectSquare } from "@/server/workflows";
import { loadShop } from "@/server/load";

export async function POST(request: Request) {
  const bundle = await loadShop();
  if (!bundle.shop || bundle.role !== "owner") {
    return NextResponse.redirect(new URL("/app/settings?error=Only+an+owner+can+disconnect", request.url));
  }
  await disconnectSquare(bundle.store, bundle.shop.id, bundle.viewer.user.id);
  return NextResponse.redirect(new URL("/app/connect?notice=Square+disconnected+and+seller+data+deleted", request.url));
}

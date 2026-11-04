import { NextResponse } from "next/server";
import { beginSquareConnect } from "@/server/workflows";
import { loadShop } from "@/server/load";

export async function GET(request: Request) {
  const bundle = await loadShop();
  if (!bundle.shop || bundle.role !== "owner") {
    return NextResponse.redirect(new URL("/app/connect?error=Only+an+owner+can+connect+Square", request.url));
  }
  try {
    const url = await beginSquareConnect({ shopId: bundle.shop.id, userId: bundle.viewer.user.id });
    return NextResponse.redirect(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Square is not configured.";
    return NextResponse.redirect(new URL(`/app/connect?error=${encodeURIComponent(message)}`, request.url));
  }
}

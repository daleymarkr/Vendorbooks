import { NextResponse } from "next/server";
import { createPortal } from "@/server/workflows";
import { loadShop } from "@/server/load";

export async function GET(request: Request) {
  const bundle = await loadShop();
  if (!bundle.shop || bundle.role !== "owner") {
    return NextResponse.redirect(new URL("/app/settings?error=Only+an+owner+can+open+billing", request.url));
  }
  try {
    return NextResponse.redirect(await createPortal(bundle.shop));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Billing portal is not configured.";
    return NextResponse.redirect(new URL(`/app/settings?error=${encodeURIComponent(message)}`, request.url));
  }
}

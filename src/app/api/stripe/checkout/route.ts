import { NextResponse } from "next/server";
import { createCheckout } from "@/server/workflows";
import { loadShop } from "@/server/load";

export async function GET(request: Request) {
  const bundle = await loadShop();
  const url = new URL(request.url);
  const plan = url.searchParams.get("plan");
  const interval = url.searchParams.get("interval");
  if (!bundle.shop || bundle.role !== "owner") {
    return NextResponse.redirect(new URL("/app/settings?error=Only+an+owner+can+change+billing", request.url));
  }
  if ((plan !== "shop" && plan !== "mall") || (interval !== "monthly" && interval !== "annual")) {
    return NextResponse.redirect(new URL("/app/settings?error=Choose+Shop+or+Mall", request.url));
  }
  try {
    const checkout = await createCheckout(bundle.shop, plan, interval);
    return NextResponse.redirect(checkout);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Billing is not configured.";
    return NextResponse.redirect(new URL(`/app/settings?error=${encodeURIComponent(message)}`, request.url));
  }
}

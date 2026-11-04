import { applyStripeEvent, stripeClient } from "@/server/workflows";
import { getStore } from "@/server/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "STRIPE_WEBHOOK_SECRET is not set." }, { status: 500 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing Stripe signature." }, { status: 400 });
  const raw = await request.text();
  try {
    const event = stripeClient().webhooks.constructEvent(raw, signature, secret);
    await applyStripeEvent(await getStore(), event);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Stripe event.";
    return Response.json({ error: message }, { status: 400 });
  }
}

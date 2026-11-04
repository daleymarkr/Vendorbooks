// Stripe signature checks use the Stripe SDK in the Next.js route at
// /api/stripe/webhook, which is the supported deploy path on Vercel.
// This function forwards the raw, signed request when APP_URL is set.
Deno.serve(async (request) => {
  const appUrl = Deno.env.get("APP_URL");
  if (!appUrl) return new Response("Set APP_URL to the VendorBooks deployment.", { status: 500 });
  const response = await fetch(new URL("/api/stripe/webhook", appUrl), {
    method: "POST",
    headers: request.headers,
    body: await request.text(),
  });
  return new Response(await response.text(), { status: response.status });
});

Deno.serve(() =>
  new Response(
    JSON.stringify({
      ok: true,
      note: "Bulk tagging runs in the Next.js app at /app/catalog and /api routes. Deploy VendorBooks on Vercel and use that catalog screen.",
    }),
    { headers: { "content-type": "application/json" } },
  ),
);

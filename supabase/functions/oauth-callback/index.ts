Deno.serve((request) => {
  const incoming = new URL(request.url);
  const target = new URL("/api/square/oauth/callback", Deno.env.get("APP_URL") ?? "http://localhost:3000");
  target.search = incoming.search;
  return Response.redirect(target, 302);
});

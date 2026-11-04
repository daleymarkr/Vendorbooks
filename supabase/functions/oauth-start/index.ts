Deno.serve(() =>
  Response.redirect(`${Deno.env.get("APP_URL") ?? ""}/api/square/oauth/start`, 302),
);

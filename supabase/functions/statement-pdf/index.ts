Deno.serve((request) => {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const appUrl = Deno.env.get("APP_URL");
  if (!appUrl || !id) return new Response("Pass id and set APP_URL", { status: 400 });
  return fetch(new URL(`/api/statements/${id}/pdf`, appUrl), { headers: request.headers });
});

Deno.serve((request) => proxy(request, "/api/cron/nightly-reconcile"));

function proxy(request: Request, path: string): Promise<Response> {
  const appUrl = Deno.env.get("APP_URL");
  if (!appUrl) return Promise.resolve(new Response("Set APP_URL", { status: 500 }));
  return fetch(new URL(path, appUrl), { headers: { authorization: request.headers.get("authorization") ?? "" } });
}

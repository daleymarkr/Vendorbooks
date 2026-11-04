import { Flash, PageIntro } from "@/components/ui";
import { loadShop } from "@/server/load";
import { redirect } from "next/navigation";

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; connected?: string }> }) {
  const bundle = await loadShop();
  if (!bundle.shop) redirect("/app/onboarding");
  const query = await searchParams;
  const backfill = await bundle.store.latestBackfill(bundle.shop.id);
  const reconcile = await bundle.store.latestReconcile(bundle.shop.id);
  return (
    <div>
      <PageIntro eyebrow="Square" title={bundle.connection.connected ? "Square is connected" : "Connect Square"} lede="OAuth only. VendorBooks stores an encrypted token and reads orders, catalog, payments, and the merchant profile. It never asks for a Square password." />
      <Flash error={query.error} notice={query.connected ? "Square connected. Run a backfill to pull history." : query.notice} />
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <article className="card space-y-3 p-6">
          <p className="text-sm text-ink-soft">{bundle.connection.connected ? `Merchant ${bundle.connection.merchantId}` : "No seller connected."}</p>
          {bundle.connection.connected ? <p className="text-sm text-ink-soft">Last refresh {bundle.connection.lastRefreshedAt?.slice(0, 16).replace("T", " ") ?? "not yet"} · expires {bundle.connection.tokenExpiresAt?.slice(0, 10)}</p> : null}
          {bundle.role === "owner" ? <a className="btn-primary" href="/api/square/oauth/start">Connect Square</a> : <p className="text-sm">An owner connects Square.</p>}
          <form action="/api/square/backfill" method="post"><button className="btn-ghost" type="submit">Backfill orders</button></form>
          <form action="/api/square/catalog-attribute" method="post"><button className="btn-ghost" type="submit">Create vendor attribute</button></form>
          <form action="/api/square/sync-catalog" method="post"><button className="btn-ghost" type="submit">Sync catalog</button></form>
        </article>
        <article className="card p-6 text-sm text-ink-soft">
          <h2 className="font-serif text-2xl text-ink">Latest jobs</h2>
          <p className="mt-3">Backfill: {backfill ? `${backfill.status}, ${backfill.ordersSeen} orders` : "none yet"}{backfill?.error ? ` — ${backfill.error}` : ""}</p>
          <p className="mt-2">Reconcile: {reconcile ? `${reconcile.mismatchCount} mismatches on ${reconcile.ranAt.slice(0, 10)}` : "none yet"}</p>
          <p className="mt-4">Scopes: ORDERS_READ, ITEMS_READ, ITEMS_WRITE, PAYMENTS_READ, MERCHANT_PROFILE_READ. Tokens refresh at least every 7 days.</p>
        </article>
      </div>
    </div>
  );
}

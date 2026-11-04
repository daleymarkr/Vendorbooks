import Link from "next/link";
import { redirect } from "next/navigation";
import { formatUsd, periodYm } from "@/domain/money";
import { Flash, PageIntro } from "@/components/ui";
import { loadShop } from "@/server/load";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const query = await searchParams;
  const bundle = await loadShop();
  if (!bundle.shop) {
    if (bundle.viewer.isPlatformAdmin) redirect("/admin");
    redirect("/app/onboarding");
  }
  const period = periodYm(new Date().toISOString(), bundle.shop.timezone);
  const lines = await bundle.store.listLedger(bundle.shop.id, { periodYm: period });
  const earn = lines.reduce((sum, line) => sum + line.vendorEarnCents, 0);
  const statements = await bundle.store.listStatements(bundle.shop.id);
  const awaiting = statements.filter((statement) => statement.status === "approved").reduce((sum, statement) => sum + Math.max(0, statement.payoutCents), 0);
  const reconcile = await bundle.store.latestReconcile(bundle.shop.id);
  const activeVendors = bundle.vendors.filter((vendor) => !vendor.archivedAt).length;
  return (
    <div>
      <PageIntro eyebrow={period} title="This month in the ledger" lede="VendorBooks is adding up what the shop should pay. It does not send those payments." />
      <Flash notice={query.notice} />
      <div className="mt-6 grid gap-4 md:grid-cols-4">
        {[
          ["Vendor amount", formatUsd(earn)],
          ["Unassigned", String(bundle.unassigned)],
          ["Approved, not recorded paid", formatUsd(awaiting)],
          ["Last reconcile mismatches", String(reconcile?.mismatchCount ?? "—")],
        ].map(([label, value]) => (
          <article key={label} className="card p-5">
            <p className="text-xs uppercase tracking-[0.14em] text-ink-soft">{label}</p>
            <p className="mt-2 font-serif text-3xl text-pine">{value}</p>
          </article>
        ))}
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <article className="card p-5">
          <h2 className="font-serif text-2xl">Square</h2>
          <p className="mt-2 text-sm text-ink-soft">{bundle.connection.connected ? `Connected${bundle.connection.sandbox ? " · sandbox" : ""} · ${bundle.connection.merchantId}` : "Not connected yet."}</p>
          <Link className="btn-ghost mt-4" href="/app/connect">Connection</Link>
        </article>
        <article className="card p-5">
          <h2 className="font-serif text-2xl">Vendors</h2>
          <p className="mt-2 text-sm text-ink-soft">{activeVendors} active{bundle.access?.vendorCap ? ` of ${bundle.access.vendorCap}` : ""}.</p>
          <Link className="btn-ghost mt-4" href="/app/vendors">Manage vendors</Link>
        </article>
      </div>
    </div>
  );
}

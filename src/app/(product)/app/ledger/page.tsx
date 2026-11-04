import { redirect } from "next/navigation";
import { formatUsd } from "@/domain/money";
import { PageIntro, Stamp } from "@/components/ui";
import { loadShop } from "@/server/load";

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ vendor?: string; location?: string; period?: string }> }) {
  const bundle = await loadShop();
  if (!bundle.shop) redirect("/app/onboarding");
  const query = await searchParams;
  const lines = await bundle.store.listLedger(bundle.shop.id, {
    vendorId: query.vendor || undefined,
    locationId: query.location || undefined,
    periodYm: query.period || undefined,
  });
  return (
    <div>
      <PageIntro title="Ledger" lede="Each row is one Square line. Drill into the order id when you need the source sale." />
      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <select className="field max-w-xs" name="vendor" defaultValue={query.vendor ?? ""}>
          <option value="">All vendors</option>
          {bundle.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.displayName}</option>)}
        </select>
        <select className="field max-w-xs" name="location" defaultValue={query.location ?? ""}>
          <option value="">All locations</option>
          {bundle.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
        <input className="field max-w-[10rem]" name="period" placeholder="2026-11" defaultValue={query.period ?? ""} />
        <button className="btn-ghost" type="submit">Filter</button>
      </form>
      <div className="card table-wrap">
        <table className="data">
          <thead><tr><th>When</th><th>Item</th><th>Order</th><th>Kind</th><th>Base</th><th>Vendor amount</th></tr></thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td>{line.soldAt.slice(0, 10)}{line.isOffline ? <Stamp tone="warn">Offline</Stamp> : null}</td>
                <td>{line.itemName ?? "—"}<div className="text-xs text-ink-soft">{bundle.vendors.find((vendor) => vendor.id === line.vendorId)?.displayName ?? "Unassigned"}</div></td>
                <td className="font-mono text-xs">{line.squareOrderId}</td>
                <td>{line.lineKind}</td>
                <td>{formatUsd(line.baseCents)}</td>
                <td>{formatUsd(line.vendorEarnCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

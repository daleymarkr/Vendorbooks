import { redirect } from "next/navigation";
import { formatUsd } from "@/domain/money";
import { allocateAction } from "@/server/actions";
import { Flash, PageIntro } from "@/components/ui";
import { PendingButton } from "@/components/submit-button";
import { loadShop } from "@/server/load";

export default async function UnassignedPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const bundle = await loadShop();
  if (!bundle.shop) redirect("/app/onboarding");
  const query = await searchParams;
  const queue = await bundle.store.listUnassigned(bundle.shop.id, "open");
  const lines = await bundle.store.listLedger(bundle.shop.id);
  const active = bundle.vendors.filter((vendor) => !vendor.archivedAt);
  return (
    <div>
      <PageIntro title="Unassigned queue" lede="Custom-amount sales and refunds Square could not tie to an item wait here. Allocate a vendor, or mark the amount as kept by the shop. Monthly close cannot be approved while any row is open." />
      <Flash error={query.error} notice={query.notice} />
      <div className="mt-4 space-y-3">
        {queue.length === 0 ? <p className="card p-6 text-ink-soft">Nothing is waiting.</p> : null}
        {queue.map((item) => {
          const line = lines.find((row) => row.id === item.ledgerLineId);
          return (
            <form key={item.id} action={allocateAction} className="card flex flex-wrap items-end gap-3 p-4">
              <input type="hidden" name="id" value={item.id} />
              <div className="min-w-48 flex-1">
                <p className="font-medium">{line?.itemName ?? "Line"} · {line ? formatUsd(line.grossCents) : ""}</p>
                <p className="text-xs text-ink-soft">{item.reason} · order {line?.squareOrderId}</p>
              </div>
              <select className="field max-w-xs" name="vendorId">
                <option value="">Shop keeps this</option>
                {active.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.displayName}</option>)}
              </select>
              <PendingButton>Apply</PendingButton>
            </form>
          );
        })}
      </div>
    </div>
  );
}

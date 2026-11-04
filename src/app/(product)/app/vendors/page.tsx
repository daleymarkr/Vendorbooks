import Link from "next/link";
import { redirect } from "next/navigation";
import { bpsToPercentLabel, formatUsd } from "@/domain/money";
import { archiveVendorAction } from "@/server/actions";
import { Flash, PageIntro, Stamp } from "@/components/ui";
import { loadShop } from "@/server/load";

export default async function VendorsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const bundle = await loadShop();
  if (!bundle.shop) redirect("/app/onboarding");
  const query = await searchParams;
  const active = bundle.vendors.filter((vendor) => !vendor.archivedAt).length;
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageIntro title="Vendors" lede={`${active} active${bundle.access?.vendorCap ? ` of ${bundle.access.vendorCap}` : ""}. Archiving frees a seat.`} />
        <Link className="btn-primary" href="/app/vendors/new">Add vendor</Link>
      </div>
      <Flash error={query.error} />
      <div className="card mt-4 table-wrap">
        <table className="data">
          <thead><tr><th>Name</th><th>Commission</th><th>Booth rent</th><th>Pays by</th><th></th></tr></thead>
          <tbody>
            {bundle.vendors.map((vendor) => (
              <tr key={vendor.id}>
                <td><Link className="text-pine underline" href={`/app/vendors/${vendor.id}`}>{vendor.displayName}</Link>{vendor.archivedAt ? <Stamp tone="warn">Archived</Stamp> : null}</td>
                <td>{bpsToPercentLabel(vendor.commissionBps)}%</td>
                <td>{formatUsd(vendor.boothRentCents)}</td>
                <td>{vendor.payoutMethod ?? "—"}</td>
                <td>
                  <form action={archiveVendorAction}>
                    <input type="hidden" name="id" value={vendor.id} />
                    <button className="text-sm text-brass" type="submit">{vendor.archivedAt ? "Restore" : "Archive"}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

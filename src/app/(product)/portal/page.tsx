import { redirect } from "next/navigation";
import { formatUsd } from "@/domain/money";
import { visibleLedger } from "@/domain/visibility";
import { PageIntro } from "@/components/ui";
import { requireViewer } from "@/server/session";
import { getStore } from "@/server/store";

export default async function PortalSalesPage() {
  const viewer = await requireViewer();
  if (!viewer.vendorId) redirect("/login");
  const store = await getStore();
  const vendor = await store.getVendor(viewer.vendorId);
  if (!vendor) redirect("/login");
  const lines = visibleLedger(await store.listLedger(vendor.shopId, { vendorId: vendor.id }), {
    userId: viewer.user.id,
    isPlatformAdmin: false,
    memberships: [],
    vendorId: viewer.vendorId,
  });
  return (
    <div>
      <PageIntro title={vendor.displayName} lede="Your sales, as the shop calculated them. Commission and catalog stay with the shop." />
      <div className="card table-wrap">
        <table className="data">
          <thead><tr><th>Date</th><th>Item</th><th>Kind</th><th>Amount</th></tr></thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}><td>{line.soldAt.slice(0, 10)}</td><td>{line.itemName}</td><td>{line.lineKind}</td><td>{formatUsd(line.vendorEarnCents)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

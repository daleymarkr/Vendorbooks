import { redirect } from "next/navigation";
import { formatUsd } from "@/domain/money";
import { visibleStatements } from "@/domain/visibility";
import { PageIntro } from "@/components/ui";
import { requireViewer } from "@/server/session";
import { getStore } from "@/server/store";

export default async function PortalPayoutsPage() {
  const viewer = await requireViewer();
  if (!viewer.vendorId) redirect("/login");
  const store = await getStore();
  const vendor = await store.getVendor(viewer.vendorId);
  if (!vendor) redirect("/login");
  const paid = visibleStatements(await store.listStatements(vendor.shopId), {
    userId: viewer.user.id,
    isPlatformAdmin: false,
    memberships: [],
    vendorId: viewer.vendorId,
  }).filter((statement) => statement.status === "paid");
  return (
    <div>
      <PageIntro title="Payout record" lede="Dates the shop recorded a payment it made outside VendorBooks." />
      <div className="card table-wrap">
        <table className="data">
          <thead><tr><th>Period</th><th>Amount</th><th>Recorded</th><th>Method</th><th>Reference</th></tr></thead>
          <tbody>
            {paid.map((statement) => (
              <tr key={statement.id}>
                <td>{statement.periodYm}</td>
                <td>{formatUsd(statement.payoutCents)}</td>
                <td>{statement.paidAt?.slice(0, 10)}</td>
                <td>{statement.paidMethod}</td>
                <td>{statement.paidReference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

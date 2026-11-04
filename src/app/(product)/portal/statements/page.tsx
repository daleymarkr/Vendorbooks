import { redirect } from "next/navigation";
import { formatUsd } from "@/domain/money";
import { visibleStatements } from "@/domain/visibility";
import { PageIntro } from "@/components/ui";
import { requireViewer } from "@/server/session";
import { getStore } from "@/server/store";

export default async function PortalStatementsPage() {
  const viewer = await requireViewer();
  if (!viewer.vendorId) redirect("/login");
  const store = await getStore();
  const vendor = await store.getVendor(viewer.vendorId);
  if (!vendor) redirect("/login");
  const statements = visibleStatements(await store.listStatements(vendor.shopId), {
    userId: viewer.user.id,
    isPlatformAdmin: false,
    memberships: [],
    vendorId: viewer.vendorId,
  });
  return (
    <div>
      <PageIntro title="Statements" lede="Drafts stay with the shop. Approved and paid statements can be downloaded." />
      <ul className="space-y-3">
        {statements.map((statement) => (
          <li key={statement.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">{statement.periodYm} · {statement.status}</p>
              <p className="text-sm text-ink-soft">{formatUsd(statement.payoutCents)} for the shop to pay</p>
            </div>
            <div className="flex gap-2">
              <a className="btn-ghost" href={`/api/statements/${statement.id}/pdf`}>PDF</a>
              <a className="btn-ghost" href={`/api/statements/${statement.id}/csv`}>CSV</a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

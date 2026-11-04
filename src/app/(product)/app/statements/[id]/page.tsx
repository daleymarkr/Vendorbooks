import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { formatUsd } from "@/domain/money";
import { approveAction, forgiveAction, markPaidAction } from "@/server/actions";
import { Flash, PageIntro, Stamp } from "@/components/ui";
import { PendingButton } from "@/components/submit-button";
import { loadShop } from "@/server/load";

export default async function StatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const bundle = await loadShop();
  if (!bundle.shop) redirect("/app/onboarding");
  const { id } = await params;
  const query = await searchParams;
  const statement = await bundle.store.getStatement(id);
  if (!statement || statement.shopId !== bundle.shop.id) notFound();
  const vendor = await bundle.store.getVendor(statement.vendorId);
  const lines = await bundle.store.listLedger(bundle.shop.id, { vendorId: statement.vendorId, periodYm: statement.periodYm });
  return (
    <div>
      <PageIntro eyebrow={statement.periodYm} title={vendor?.displayName ?? "Vendor"} lede="The amount below is what the shop should pay. Recording it as paid does not move money." />
      <Flash error={query.error} notice={query.notice} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Stamp tone={statement.status === "paid" ? "good" : "ink"}>{statement.status}</Stamp>
        <a className="btn-ghost" href={`/api/statements/${statement.id}/pdf`}>PDF</a>
        <a className="btn-ghost" href={`/api/statements/${statement.id}/csv`}>CSV</a>
        <Link className="text-sm text-pine" href="/app/close">Back to close</Link>
      </div>
      <dl className="card mt-4 grid gap-3 p-6 sm:grid-cols-3">
        {[
          ["Opening", statement.openingBalanceCents],
          ["Sales", statement.salesEarnCents],
          ["Refunds", statement.refundsCents],
          ["Adjustments", statement.adjustmentsCents],
          ["Booth rent", statement.boothRentCents],
          ["Amount for the shop to pay", statement.payoutCents],
        ].map(([label, cents]) => (
          <div key={String(label)}><dt className="text-xs uppercase tracking-[0.12em] text-ink-soft">{label}</dt><dd className="font-serif text-2xl">{formatUsd(Number(cents))}</dd></div>
        ))}
      </dl>
      {statement.reconcileDeltaCents != null ? <p className="mt-3 text-sm text-ink-soft">Square sales compared with this ledger differ by {formatUsd(statement.reconcileDeltaCents)}.</p> : null}
      <div className="mt-4 flex flex-wrap gap-3">
        {statement.status === "pending_review" || statement.status === "draft" ? (
          <form action={approveAction}><input type="hidden" name="id" value={statement.id} /><PendingButton>Approve</PendingButton></form>
        ) : null}
        {statement.status === "approved" || statement.status === "paid" ? (
          <form action={markPaidAction} className="card flex flex-wrap items-end gap-2 p-4">
            <input type="hidden" name="id" value={statement.id} />
            <label className="block"><span className="label">Method the shop used</span>
              <select className="field" name="method" defaultValue={statement.paidMethod ?? vendor?.payoutMethod ?? "check"}>
                <option value="check">Check</option><option value="ach">ACH</option><option value="zelle">Zelle</option><option value="other">Other</option>
              </select>
            </label>
            <label className="block"><span className="label">Check # or confirmation</span><input className="field" name="reference" defaultValue={statement.paidReference ?? ""} required /></label>
            <PendingButton variant="brass">Record paid</PendingButton>
          </form>
        ) : null}
        {statement.payoutCents < 0 && !statement.writtenOffAt ? (
          <form action={forgiveAction}><input type="hidden" name="id" value={statement.id} /><PendingButton variant="ghost">Write off negative balance</PendingButton></form>
        ) : null}
      </div>
      <div className="card mt-6 table-wrap">
        <table className="data">
          <thead><tr><th>Date</th><th>Order</th><th>Item</th><th>Kind</th><th>Amount</th></tr></thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}><td>{line.soldAt.slice(0, 10)}</td><td className="font-mono text-xs">{line.squareOrderId}</td><td>{line.itemName}</td><td>{line.lineKind}</td><td>{formatUsd(line.vendorEarnCents)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

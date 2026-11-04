import Link from "next/link";
import { redirect } from "next/navigation";
import { addMonthsYm, formatUsd, periodYm } from "@/domain/money";
import { isOverVendorCap } from "@/domain/plans";
import { buildPeriodStatements, closeBlockers } from "@/domain/statements";
import { closeAction } from "@/server/actions";
import { Flash, PageIntro, Stamp } from "@/components/ui";
import { PendingButton } from "@/components/submit-button";
import { loadShop } from "@/server/load";

export default async function ClosePage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; period?: string }> }) {
  const bundle = await loadShop();
  if (!bundle.shop || !bundle.settings || !bundle.access) redirect("/app/onboarding");
  const query = await searchParams;
  const current = periodYm(new Date().toISOString(), bundle.shop.timezone);
  const period = query.period || addMonthsYm(current, -1);
  const [lines, statements, open] = await Promise.all([
    bundle.store.listLedger(bundle.shop.id, { periodYm: period }),
    bundle.store.listStatements(bundle.shop.id),
    bundle.store.listUnassigned(bundle.shop.id, "open"),
  ]);
  const active = bundle.vendors.filter((vendor) => !vendor.archivedAt);
  const preview = buildPeriodStatements({
    periodYm: period,
    vendors: active,
    lines,
    priorStatements: statements,
    deductRent: bundle.settings.boothRentMode === "deduct",
    negativeBalanceMode: bundle.settings.negativeBalanceMode,
  });
  const blockers = closeBlockers({
    openUnassigned: open.length,
    readOnly: bundle.access.readOnly,
    overCap: isOverVendorCap(bundle.access, active.length),
  });
  return (
    <div>
      <PageIntro title="Monthly close" lede="Generate statements for review. Approving one does not pay the vendor. It locks the math so the shop can pay outside VendorBooks and then record that it did." />
      <Flash error={query.error} notice={query.notice} />
      <form className="mt-4 flex gap-2" method="get">
        <input className="field max-w-[12rem]" name="period" defaultValue={period} />
        <button className="btn-ghost" type="submit">Preview</button>
      </form>
      {blockers.length ? <ul className="banner-warn mt-4 list-disc pl-5">{blockers.map((item) => <li key={item}>{item}</li>)}</ul> : null}
      <div className="card mt-4 table-wrap">
        <table className="data">
          <thead><tr><th>Vendor</th><th>Opening</th><th>Sales</th><th>Refunds</th><th>Adjustments</th><th>Rent</th><th>Amount to pay</th></tr></thead>
          <tbody>
            {preview.map((row) => {
              const vendor = active.find((item) => item.id === row.vendorId);
              const existing = statements.find((statement) => statement.vendorId === row.vendorId && statement.periodYm === period);
              return (
                <tr key={row.vendorId}>
                  <td>{vendor?.displayName} {existing ? <Stamp>{existing.status}</Stamp> : null}</td>
                  <td>{formatUsd(row.math.openingBalanceCents)}</td>
                  <td>{formatUsd(row.math.salesEarnCents)}</td>
                  <td>{formatUsd(row.math.refundsCents)}</td>
                  <td>{formatUsd(row.math.adjustmentsCents)}</td>
                  <td>{formatUsd(row.math.boothRentCents)}</td>
                  <td>{formatUsd(row.math.payoutCents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <form action={closeAction} className="mt-4">
        <input type="hidden" name="period" value={period} />
        <PendingButton>Generate statements</PendingButton>
      </form>
      <ul className="mt-6 space-y-2 text-sm">
        {statements.filter((statement) => statement.periodYm === period).map((statement) => (
          <li key={statement.id}><Link className="text-pine underline" href={`/app/statements/${statement.id}`}>{active.find((vendor) => vendor.id === statement.vendorId)?.displayName} · {statement.status} · {formatUsd(statement.payoutCents)}</Link></li>
        ))}
      </ul>
    </div>
  );
}

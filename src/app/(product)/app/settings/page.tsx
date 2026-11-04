import { redirect } from "next/navigation";
import { isDemoMode } from "@/domain/env";
import { PLAN_PRICE_CENTS } from "@/domain/types";
import { formatUsd } from "@/domain/money";
import { resetDemoAction, saveSettingsAction } from "@/server/actions";
import { Flash, PageIntro } from "@/components/ui";
import { PendingButton } from "@/components/submit-button";
import { loadShop } from "@/server/load";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const bundle = await loadShop();
  if (!bundle.shop || !bundle.settings) redirect("/app/onboarding");
  const query = await searchParams;
  const settings = bundle.settings;
  return (
    <div className="max-w-3xl space-y-8">
      <PageIntro title="Settings" lede="Rule changes apply to new sales. Reprice only unlocked lines in an open period. Approved statements stay as they were issued." />
      <Flash error={query.error} notice={query.notice} />
      <form action={saveSettingsAction} className="card space-y-4 p-6">
        <label className="block"><span className="label">Shop name</span><input className="field" name="name" defaultValue={bundle.shop.name} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Timezone</span><input className="field" name="timezone" defaultValue={bundle.shop.timezone} /></label>
          <label className="block"><span className="label">Statement day</span><input className="field" name="statementDay" type="number" min={1} max={28} defaultValue={bundle.shop.statementDay} /></label>
        </div>
        <label className="flex gap-2 text-sm"><input type="checkbox" name="excludeSalesTax" defaultChecked={settings.excludeSalesTax} /> Exclude sales tax from the vendor base</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" name="excludeTips" defaultChecked={settings.excludeTips} /> Exclude tips from the vendor base</label>
        <label className="block"><span className="label">Square fees</span>
          <select className="field" name="feeMode" defaultValue={settings.feeMode}><option value="shop_absorbs">Shop absorbs</option><option value="pass_through">Pass through, split by line</option></select>
        </label>
        <label className="block"><span className="label">Booth rent</span>
          <select className="field" name="boothRentMode" defaultValue={settings.boothRentMode}><option value="deduct">Deduct on the statement</option><option value="separate">Track separately</option></select>
        </label>
        <label className="block"><span className="label">Negative balance</span>
          <select className="field" name="negativeBalanceMode" defaultValue={settings.negativeBalanceMode}><option value="carry">Carry to the next period</option><option value="forgive">Forgive at each close</option></select>
        </label>
        <label className="block"><span className="label">Service charges</span>
          <select className="field" name="serviceChargeMode" defaultValue={settings.serviceChargeMode}><option value="exclude">Exclude</option><option value="include">Include in the base</option><option value="map">Map by name</option></select>
        </label>
        <label className="flex gap-2 text-sm"><input type="checkbox" name="reprice" /> Reprice unlocked lines in open periods with these rules</label>
        <PendingButton>Save rules</PendingButton>
      </form>
      <section className="card p-6">
        <h2 className="font-serif text-2xl text-pine">Billing</h2>
        <p className="mt-2 text-sm text-ink-soft">Current plan: {bundle.shop.plan}. Status: {bundle.shop.stripeStatus ?? "none"}. Shop is {formatUsd(PLAN_PRICE_CENTS.shop.monthly)} / month or {formatUsd(PLAN_PRICE_CENTS.shop.annual)} / year. Mall is {formatUsd(PLAN_PRICE_CENTS.mall.monthly)} / month or {formatUsd(PLAN_PRICE_CENTS.mall.annual)} / year.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a className="btn-primary" href="/api/stripe/checkout?plan=shop&interval=monthly">Trial Shop monthly</a>
          <a className="btn-ghost" href="/api/stripe/checkout?plan=shop&interval=annual">Shop annual</a>
          <a className="btn-ghost" href="/api/stripe/checkout?plan=mall&interval=monthly">Trial Mall monthly</a>
          <a className="btn-ghost" href="/api/stripe/checkout?plan=mall&interval=annual">Mall annual</a>
          <a className="btn-ghost" href="/api/stripe/portal">Billing portal</a>
        </div>
      </section>
      <section className="card p-6">
        <h2 className="font-serif text-2xl text-brick">Disconnect Square</h2>
        <p className="mt-2 text-sm text-ink-soft">This revokes the Square grant and deletes tokens, catalog cache, locations, and Square-derived ledger lines. Vendors and issued statements remain.</p>
        {bundle.role === "owner" ? <form action="/api/square/disconnect" method="post" className="mt-4"><PendingButton variant="danger">Disconnect Square</PendingButton></form> : null}
      </section>
      {isDemoMode() ? (
        <form action={resetDemoAction}><PendingButton variant="ghost">Reset demo ledger</PendingButton></form>
      ) : null}
    </div>
  );
}

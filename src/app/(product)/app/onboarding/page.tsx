import { redirect } from "next/navigation";
import { createShopAction } from "@/server/actions";
import { Flash, PageIntro } from "@/components/ui";
import { PendingButton } from "@/components/submit-button";
import { loadShop } from "@/server/load";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const bundle = await loadShop();
  if (bundle.shop) redirect("/app");
  const query = await searchParams;
  return (
    <div className="max-w-xl">
      <PageIntro eyebrow="Free plan" title="Name the shop" lede="This creates the shop, makes you the owner, and sets the default payout rules: tax and tips stay out, the shop absorbs Square fees, and booth rent deducts on the statement." />
      <Flash error={query.error} />
      <form action={createShopAction} className="card mt-6 space-y-4 p-6">
        <label className="block"><span className="label">Shop name</span><input className="field" name="name" placeholder="Harbor & Pine Vendor Mall" required /></label>
        <label className="block"><span className="label">Timezone</span>
          <select className="field" name="timezone" defaultValue="America/New_York">
            {["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix"].map((zone) => <option key={zone}>{zone}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Statement day (1–28)</span><input className="field" name="statementDay" type="number" min={1} max={28} defaultValue={1} /></label>
        <PendingButton>Create shop</PendingButton>
      </form>
    </div>
  );
}

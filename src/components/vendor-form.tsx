import { bpsToPercentLabel } from "@/domain/money";
import type { Vendor } from "@/domain/types";
import { saveVendorAction, inviteVendorAction } from "@/server/actions";
import { PendingButton } from "@/components/submit-button";
import { Flash } from "@/components/ui";

export function VendorForm({ vendor, error, notice, link }: { vendor?: Vendor; error?: string; notice?: string; link?: string }) {
  return (
    <div className="max-w-xl">
      <h1 className="font-serif text-4xl text-pine">{vendor ? vendor.displayName : "New vendor"}</h1>
      <p className="mt-2 text-sm text-ink-soft">Commission is the vendor&apos;s share of the sale after discounts. Booth rent is a monthly amount the shop may deduct.</p>
      <Flash error={error} notice={notice} />
      {link ? <p className="banner-good mt-4 break-all">Portal link: {link}</p> : null}
      <form action={saveVendorAction} className="card mt-6 space-y-4 p-6">
        {vendor ? <input type="hidden" name="id" value={vendor.id} /> : null}
        <label className="block"><span className="label">Name</span><input className="field" name="displayName" defaultValue={vendor?.displayName} required /></label>
        <label className="block"><span className="label">Email</span><input className="field" name="email" type="email" defaultValue={vendor?.email ?? ""} /></label>
        <label className="block"><span className="label">Phone</span><input className="field" name="phone" defaultValue={vendor?.phone ?? ""} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="label">Commission %</span><input className="field" name="commission" defaultValue={vendor ? bpsToPercentLabel(vendor.commissionBps) : "60"} /></label>
          <label className="block"><span className="label">Booth rent $</span><input className="field" name="boothRent" defaultValue={vendor ? (vendor.boothRentCents / 100).toFixed(2) : "0"} /></label>
        </div>
        <label className="block"><span className="label">How the shop pays them</span>
          <select className="field" name="payoutMethod" defaultValue={vendor?.payoutMethod ?? "check"}>
            <option value="check">Check</option>
            <option value="ach">ACH</option>
            <option value="zelle">Zelle</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="block"><span className="label">Payout note</span><input className="field" name="payoutDetails" defaultValue={vendor?.payoutDetails ?? ""} /></label>
        <label className="block"><span className="label">Preferred day</span><input className="field" name="payoutDay" type="number" min={1} max={28} defaultValue={vendor?.payoutDay ?? 5} /></label>
        <PendingButton>{vendor ? "Save vendor" : "Add vendor"}</PendingButton>
      </form>
      {vendor ? (
        <form action={inviteVendorAction} className="mt-4">
          <input type="hidden" name="vendorId" value={vendor.id} />
          <PendingButton variant="ghost">Send portal invite</PendingButton>
        </form>
      ) : null}
    </div>
  );
}

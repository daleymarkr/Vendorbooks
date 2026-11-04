import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Trial started", description: "Your VendorBooks trial checkout returned." };

export default function ThanksPage() {
  return (
    <div className="mx-auto max-w-xl px-6 py-20" data-analytics="trial-thanks">
      <h1 className="font-serif text-5xl text-pine">You&apos;re in.</h1>
      <p className="mt-4 text-lg text-ink-soft">If Stripe confirmed the checkout, the shop plan updates in a few seconds. The 14-day trial includes the paid features. VendorBooks still does not pay your vendors — it only prepares the amounts.</p>
      <Link href="/app" className="btn-primary mt-8">Go to the ledger</Link>
    </div>
  );
}

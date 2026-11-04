import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Vendor mall payouts",
  description: "Monthly vendor statements for antique malls and maker co-ops that sell on Square.",
};

export default function Page() {
  return (
    <article className="mx-auto max-w-3xl space-y-4 px-6 py-12">
      <h1 className="font-serif text-5xl text-pine">Vendor mall payouts, from the Square tape</h1>
      <p className="text-lg text-ink-soft">Antique malls and maker co-ops close the month by vendor, not by a single shop total. VendorBooks keeps a line for every sale, refund, and booth rent charge, then rolls a negative month into the next opening balance.</p>
      <p className="text-ink-soft">Mall plan shops can run more than one Square location. Search calls are grouped so a large floor does not trip Square&apos;s ten-location limit.</p>
      <Link href="/pricing" className="btn-primary mt-4">Compare Free, Shop, and Mall</Link>
    </article>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Consignment software for Square",
  description: "Attribute Square sales to consignors, apply commission, and prepare monthly statements without moving money.",
};

export default function Page() {
  return (
    <article className="mx-auto max-w-3xl space-y-4 px-6 py-12">
      <h1 className="font-serif text-5xl text-pine">Consignment software for Square</h1>
      <p className="text-lg text-ink-soft">Shops that sell other people&apos;s goods need a ledger, not another checkout. VendorBooks connects to Square, tags each item to a consignor, and turns completed sales and refunds into a statement.</p>
      <p className="text-ink-soft">Order discounts stay the way Square split them. Itemized returns reverse the original consignor. A custom-amount sale waits in an unassigned queue until the shop chooses who earned it.</p>
      <Link href="/signup" className="btn-primary mt-4">Start a consignment ledger</Link>
    </article>
  );
}

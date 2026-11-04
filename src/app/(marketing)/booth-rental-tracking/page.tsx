import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Booth rental tracking",
  description: "Deduct booth rent on a vendor statement, or track it separately from commission.",
};

export default function Page() {
  return (
    <article className="mx-auto max-w-3xl space-y-4 px-6 py-12">
      <h1 className="font-serif text-5xl text-pine">Booth rental tracking beside the sales</h1>
      <p className="text-lg text-ink-soft">Each vendor can carry a monthly booth rent. Deduct it on the statement, or leave it off the payout and collect rent another way. If rent is larger than the month&apos;s commission, the negative balance carries forward until the shop writes it off.</p>
      <p className="text-ink-soft">The statement shows the rent as its own line so a dealer can see why the amount to pay is what it is.</p>
      <Link href="/calculator" className="btn-primary mt-4">Try rent in the calculator</Link>
    </article>
  );
}

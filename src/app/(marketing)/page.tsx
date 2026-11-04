import Link from "next/link";
import { formatUsd } from "@/domain/money";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-6">
      <section className="grid items-center gap-12 py-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-brass">For antique malls, consignment shops, and maker co-ops</p>
          <h1 className="mt-4 font-serif text-5xl leading-tight text-pine md:text-6xl">Every Square sale, credited to the right vendor.</h1>
          <p className="mt-6 max-w-xl text-lg text-ink-soft">
            VendorBooks reads your catalog and sales, applies each vendor&apos;s commission and booth rent, and prepares the monthly statement. You still pay vendors by check, ACH, or Zelle.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="btn-primary" data-analytics="start-free">
              Start free — 5 vendors
            </Link>
            <Link href="/calculator" className="btn-ghost">
              Try the CSV calculator
            </Link>
          </div>
        </div>
        <article className="card ledger-sheet p-8">
          <p className="text-xs uppercase tracking-[0.16em] text-brass">October statement · Alice Hart</p>
          <p className="mt-4 font-serif text-4xl text-ink">{formatUsd(6000)}</p>
          <p className="text-sm text-ink-soft">Amount for the shop to pay, after a 60% commission. Tax and the tip stayed with the shop.</p>
          <dl className="mt-6 space-y-2 text-sm">
            <div className="flex justify-between"><dt>Gross sale</dt><dd>{formatUsd(10000)}</dd></div>
            <div className="flex justify-between"><dt>Sales tax, excluded</dt><dd>{formatUsd(800)}</dd></div>
            <div className="flex justify-between"><dt>Tip, excluded</dt><dd>{formatUsd(500)}</dd></div>
            <div className="flex justify-between border-t border-line pt-2 font-medium"><dt>Recorded paid by check 1042</dt><dd>Outside the app</dd></div>
          </dl>
        </article>
      </section>
      <section className="grid gap-4 py-8 md:grid-cols-3">
        {[
          ["Attribute", "Tag items with one vendor field, or use SKU prefixes, categories, and a CSV when Square's attribute slots are full."],
          ["Calculate", "Commission uses Square's own discount splits. Refunds reverse the original vendor. Booth rent can deduct or stay separate."],
          ["Record", "Approve the statement, then mark it paid with a check number or confirmation. The record is the point. The money moves at the shop."],
        ].map(([title, body]) => (
          <article key={title} className="card p-6">
            <h2 className="font-serif text-2xl text-pine">{title}</h2>
            <p className="mt-3 text-sm leading-6 text-ink-soft">{body}</p>
          </article>
        ))}
      </section>
      <section className="card my-8 flex flex-col items-start justify-between gap-4 p-8 md:flex-row md:items-center">
        <div>
          <h2 className="font-serif text-3xl text-pine">Free for a small floor. Shop and Mall when it grows.</h2>
          <p className="mt-2 text-ink-soft">Shop is $49 a month. Mall is $129. Annual billing is ten times the monthly price.</p>
        </div>
        <Link href="/pricing" className="btn-brass">
          See plans
        </Link>
      </section>
    </div>
  );
}

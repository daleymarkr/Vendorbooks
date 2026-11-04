import type { Metadata } from "next";
import Link from "next/link";
import { PLAN_PRICE_CENTS } from "@/domain/types";
import { formatUsd } from "@/domain/money";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Free for 5 vendors. Shop is $49 a month. Mall is $129. Annual billing is ten times monthly.",
};

const plans = [
  { name: "Free", price: "$0", period: "forever", vendors: "5 vendors", locations: "1 location", href: "/signup", cta: "Create a free shop", note: "Statements include a small watermark." },
  { name: "Shop", price: formatUsd(PLAN_PRICE_CENTS.shop.monthly), period: "/ month", vendors: "50 vendors", locations: "Multiple locations", href: "/signup", cta: "Start a 14-day trial", note: `Annual ${formatUsd(PLAN_PRICE_CENTS.shop.annual)} — two months included.` },
  { name: "Mall", price: formatUsd(PLAN_PRICE_CENTS.mall.monthly), period: "/ month", vendors: "Unlimited vendors", locations: "Multiple locations", href: "/signup", cta: "Start a 14-day trial", note: `Annual ${formatUsd(PLAN_PRICE_CENTS.mall.annual)}.` },
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-serif text-5xl text-pine">Simple plans, counted in vendors.</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-soft">
        Seats are active vendors, not staff logins. If you outgrow a plan, VendorBooks keeps existing records readable and pauses new vendors, extra locations, and monthly close until you archive or upgrade.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <article key={plan.name} className="card flex flex-col p-6">
            <h2 className="font-serif text-3xl text-pine">{plan.name}</h2>
            <p className="mt-4 text-3xl tabular-nums">
              {plan.price}
              <span className="text-base text-ink-soft">{plan.period}</span>
            </p>
            <ul className="mt-4 space-y-2 text-sm text-ink-soft">
              <li>{plan.vendors}</li>
              <li>{plan.locations}</li>
              <li>{plan.note}</li>
              <li>14-day trial on Shop and Mall</li>
            </ul>
            <Link href={plan.href} className="btn-primary mt-6">
              {plan.cta}
            </Link>
          </article>
        ))}
      </div>
      <p className="mt-8 max-w-3xl text-sm text-ink-soft">
        A failed subscription payment leaves the shop fully usable for 3 days, then read-only until billing is updated. VendorBooks bills the shop for the software. It never sends vendor payments.
      </p>
    </div>
  );
}

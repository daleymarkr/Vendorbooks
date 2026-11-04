import type { Metadata } from "next";
import { Calculator } from "@/components/calculator";

export const metadata: Metadata = {
  title: "Free CSV payout calculator",
  description: "Upload a sales CSV and download vendor payout amounts. No Square account required.",
};

export default function CalculatorPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-serif text-5xl text-pine">Free CSV payout calculator</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-soft">
        Paste sales, see each vendor&apos;s amount, and download a CSV. When you are ready, connect Square and VendorBooks will keep the ledger for you.
      </p>
      <div className="mt-8">
        <Calculator />
      </div>
    </div>
  );
}

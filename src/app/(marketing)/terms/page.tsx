import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms", description: "VendorBooks is calculation and recordkeeping. The shop pays vendors." };

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-4 px-6 py-12 text-ink-soft">
      <h1 className="font-serif text-5xl text-ink">Terms</h1>
      <p>VendorBooks is a calculation and recordkeeping tool for shops that sell through Square. It produces vendor statements and lets the shop record that a payout was made. The shop pays its vendors directly, outside VendorBooks.</p>
      <p>VendorBooks does not hold, receive, or move vendor money. It is not a bank, money transmitter, or payment processor for those payouts. Marking a statement paid is a note in the ledger, not a payment.</p>
      <p>You are responsible for the commission rates, booth rent, and payout rules you enter, and for paying vendors the amount you agree with them. Plan limits are enforced on the server. A subscription that goes unpaid becomes read-only after a 3-day grace period.</p>
      <p>The service is provided as available. Square, Stripe, and email delivery depend on those companies. You can stop using VendorBooks at any time; export statements before you disconnect if you need the history offline.</p>
    </article>
  );
}

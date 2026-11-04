import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy", description: "What VendorBooks stores, who processes it, and what happens when Square access is revoked." };

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-4 px-6 py-12 text-ink-soft">
      <h1 className="font-serif text-5xl text-ink">Privacy</h1>
      <p>VendorBooks stores the account email and name you give us, shop settings, vendor contact details the shop enters, and the sales, catalog, location, and payment fields we read from Square in order to calculate statements.</p>
      <p>Processors: Supabase hosts the database and sign-in, Square is the source of sales, Stripe bills the shop for this software, Resend sends statement and billing email, and Vercel hosts the app. We do not sell personal information.</p>
      <p>Square tokens are encrypted and are not readable by the shop&apos;s browser session. When Square tells us the seller revoked access, we delete the tokens, cached catalog maps, location ids, and ledger lines that came from Square. Statements the shop already approved stay as the shop&apos;s own records.</p>
      <p>You can ask for a copy or deletion of the shop by emailing the address on your account. Payment card data for the VendorBooks subscription is handled by Stripe and is not stored in our database.</p>
    </article>
  );
}

import Link from "next/link";
import { Logo } from "@/components/ui";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/">
          <Logo />
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/pricing" className="hidden text-ink-soft hover:text-ink sm:inline">
            Pricing
          </Link>
          <Link href="/calculator" className="hidden text-ink-soft hover:text-ink sm:inline">
            Calculator
          </Link>
          <Link href="/login" className="text-ink-soft hover:text-ink">
            Sign in
          </Link>
          <Link href="/signup" className="btn-primary">
            Start free
          </Link>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="mx-auto mt-20 max-w-6xl border-t border-line px-6 py-10 text-sm text-ink-soft">
        <div className="flex flex-wrap gap-4">
          <Link href="/consignment-software-for-square">Consignment software</Link>
          <Link href="/vendor-mall-payouts">Vendor mall payouts</Link>
          <Link href="/booth-rental-tracking">Booth rental</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </div>
        <p className="mt-4 max-w-2xl">
          VendorBooks calculates vendor amounts and records when a shop marks a payout paid. The shop pays vendors outside VendorBooks. VendorBooks does not hold or move money.
        </p>
      </footer>
    </div>
  );
}

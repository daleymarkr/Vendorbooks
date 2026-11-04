import Link from "next/link";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/demo/ids";
import { isDemoMode } from "@/domain/env";
import { loginAction } from "@/server/actions";
import { Logo } from "@/components/ui";
import { PendingButton } from "@/components/submit-button";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const query = await searchParams;
  const demo = isDemoMode();
  return (
    <div className="mx-auto grid min-h-screen max-w-5xl items-center gap-10 px-6 py-12 md:grid-cols-2">
      <div>
        <Link href="/"><Logo /></Link>
        <h1 className="mt-8 font-serif text-5xl text-pine">Open the ledger.</h1>
        <p className="mt-4 text-ink-soft">Sign in to the shop, or use a vendor magic link if you were invited.</p>
      </div>
      <form action={loginAction} className="card space-y-4 p-6">
        {query.error ? <p className="banner-bad">{query.error}</p> : null}
        <input type="hidden" name="next" value={query.next ?? ""} />
        <label className="block"><span className="label">Email</span><input className="field" name="email" type="email" required /></label>
        <label className="block"><span className="label">Password</span><input className="field" name="password" type="password" required /></label>
        <PendingButton>Sign in</PendingButton>
        <p className="text-sm text-ink-soft">No shop yet? <Link href="/signup" className="text-pine underline">Create one</Link></p>
        {demo ? (
          <div className="rounded-2xl bg-paper px-4 py-3 text-sm text-ink-soft">
            <p className="font-medium text-ink">Demo mall · password {DEMO_PASSWORD}</p>
            <ul className="mt-2 space-y-1">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.email}>{account.email} — {account.role}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </form>
    </div>
  );
}

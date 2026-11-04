import Link from "next/link";
import { signupAction } from "@/server/actions";
import { Logo } from "@/components/ui";
import { PendingButton } from "@/components/submit-button";

export const metadata = { title: "Create a shop" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <Link href="/"><Logo /></Link>
      <h1 className="mt-8 font-serif text-5xl text-pine">Start on the Free plan.</h1>
      <p className="mt-3 text-ink-soft">Five active vendors, one location. Upgrade later if the floor grows. You can choose Shop or Mall inside billing, with a 14-day trial.</p>
      <form action={signupAction} className="card mt-8 space-y-4 p-6">
        {query.error ? <p className="banner-bad">{query.error}</p> : null}
        <label className="block"><span className="label">Your name</span><input className="field" name="fullName" required /></label>
        <label className="block"><span className="label">Email</span><input className="field" name="email" type="email" required /></label>
        <label className="block"><span className="label">Password</span><input className="field" name="password" type="password" minLength={8} required /></label>
        <PendingButton>Create account</PendingButton>
        <p className="text-sm text-ink-soft">Already have a login? <Link className="text-pine underline" href="/login">Sign in</Link></p>
      </form>
    </div>
  );
}

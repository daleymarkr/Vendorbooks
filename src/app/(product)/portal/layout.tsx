import Link from "next/link";
import { redirect } from "next/navigation";
import { SideNav } from "@/components/nav";
import { Logo } from "@/components/ui";
import { logoutAction } from "@/server/actions";
import { requireViewer } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  if (!viewer.vendorId) redirect(viewer.shops.length ? "/app" : "/login");
  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="bg-pine text-paper md:min-h-screen">
        <div className="px-4 py-5"><Link href="/"><Logo light /></Link></div>
        <div className="px-3">
          <SideNav items={[
            { href: "/portal", label: "Sales" },
            { href: "/portal/statements", label: "Statements" },
            { href: "/portal/payouts", label: "Payout record" },
          ]} />
        </div>
      </aside>
      <div>
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <p className="text-sm text-ink-soft">Read-only portal · {viewer.user.fullName ?? viewer.user.email}</p>
          <form action={logoutAction}><button className="btn-ghost" type="submit">Sign out</button></form>
        </div>
        <div className="px-6 py-8">{children}</div>
      </div>
    </div>
  );
}

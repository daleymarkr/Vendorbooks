import Link from "next/link";
import { redirect } from "next/navigation";
import { SideNav } from "@/components/nav";
import { Logo } from "@/components/ui";
import { logoutAction } from "@/server/actions";
import { requireViewer } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  if (!viewer.isPlatformAdmin) redirect("/app");
  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="bg-ink text-paper md:min-h-screen">
        <div className="px-4 py-5"><Link href="/"><Logo light /></Link></div>
        <div className="px-3">
          <SideNav items={[
            { href: "/admin", label: "Shops" },
            { href: "/admin/webhooks", label: "Webhooks" },
            { href: "/admin/audit", label: "Audit" },
          ]} />
        </div>
      </aside>
      <div>
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <p className="text-sm">Platform admin</p>
          <form action={logoutAction}><button className="btn-ghost" type="submit">Sign out</button></form>
        </div>
        <div className="px-6 py-8">{children}</div>
      </div>
    </div>
  );
}

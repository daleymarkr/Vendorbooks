import Link from "next/link";
import { redirect } from "next/navigation";
import { SideNav } from "@/components/nav";
import { Logo } from "@/components/ui";
import { logoutAction, switchShopAction } from "@/server/actions";
import { loadShop } from "@/server/load";
import { isDemoMode } from "@/domain/env";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const bundle = await loadShop();
  if (!bundle.shop && bundle.viewer.isPlatformAdmin && !bundle.viewer.vendorId) redirect("/admin");
  if (!bundle.shop && bundle.viewer.vendorId && bundle.viewer.shops.length === 0) redirect("/portal");
  const items = bundle.shop
    ? [
        { href: "/app", label: "Dashboard" },
        { href: "/app/connect", label: "Square" },
        { href: "/app/vendors", label: "Vendors" },
        { href: "/app/catalog", label: "Catalog" },
        { href: "/app/ledger", label: "Ledger" },
        { href: "/app/unassigned", label: "Unassigned", badge: bundle.unassigned || undefined },
        { href: "/app/close", label: "Monthly close" },
        { href: "/app/year-end", label: "Year-end" },
        { href: "/app/settings", label: "Settings" },
      ]
    : [{ href: "/app/onboarding", label: "Set up shop" }];
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="bg-pine text-paper md:min-h-screen">
        <div className="flex items-center justify-between px-4 py-5">
          <Link href="/"><Logo light /></Link>
        </div>
        <div className="px-3 pb-6">
          <details className="md:hidden">
            <summary className="cursor-pointer rounded-xl px-3 py-2 text-sm">Menu</summary>
            <SideNav items={items} />
          </details>
          <div className="hidden md:block">
            <SideNav items={items} />
          </div>
        </div>
      </aside>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
          <div>
            <p className="font-serif text-xl text-pine">{bundle.shop?.name ?? "New shop"}</p>
            <p className="text-xs uppercase tracking-[0.14em] text-ink-soft">
              {bundle.access ? `${bundle.access.namedPlan} plan` : "Free plan"} · {bundle.role ?? "owner"}
              {isDemoMode() ? " · demo ledger" : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {bundle.viewer.shops.length > 1 ? (
              <form action={switchShopAction} className="flex gap-2">
                <select className="field" name="shopId" defaultValue={bundle.shop?.id}>
                  {bundle.viewer.shops.map((shop) => (
                    <option key={shop.id} value={shop.id}>{shop.name}</option>
                  ))}
                </select>
                <button className="btn-ghost" type="submit">Switch</button>
              </form>
            ) : null}
            {bundle.viewer.isPlatformAdmin ? <Link className="text-sm text-pine" href="/admin">Admin</Link> : null}
            <form action={logoutAction}><button className="btn-ghost" type="submit">Sign out</button></form>
          </div>
        </div>
        {bundle.access?.readOnly ? (
          <p className="banner-warn mx-6 mt-4">Billing needs attention. The ledger is read-only until the subscription is updated. Existing statements stay available.</p>
        ) : null}
        {bundle.access && bundle.access.vendorCap != null && bundle.vendors.filter((vendor) => !vendor.archivedAt).length > bundle.access.vendorCap ? (
          <p className="banner-warn mx-6 mt-4">This shop is over its vendor limit. Archive vendors or upgrade before adding anyone or running a monthly close.</p>
        ) : null}
        <div className="px-6 py-8">{children}</div>
      </div>
    </div>
  );
}

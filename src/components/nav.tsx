"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SideNav({ items }: { items: { href: string; label: string; badge?: number }[] }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active = item.href === "/app" || item.href === "/portal" || item.href === "/admin" ? path === item.href : path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm ${active ? "bg-paper text-pine" : "text-paper/80 hover:bg-white/10 hover:text-paper"}`}
          >
            {item.label}
            {item.badge ? <span className="rounded-full bg-brass px-2 text-xs text-paper">{item.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

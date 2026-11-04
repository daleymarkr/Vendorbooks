import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { appUrl, isDemoMode, platformAdminEmails, sessionSecret } from "@/domain/env";
import type { MemberRole, Membership, Profile, Shop } from "@/domain/types";
import { readSessionToken, writeSessionToken } from "@/domain/session-token";
import { getStore } from "@/server/store";
import { createSupabaseServer } from "@/server/supabase-auth";

const COOKIE = "vb_session";
const SHOP_COOKIE = "vb_shop";

export type Viewer = {
  user: Profile;
  memberships: Membership[];
  shops: Shop[];
  vendorId: string | null;
  isPlatformAdmin: boolean;
};

export async function getViewer(): Promise<Viewer | null> {
  const store = await getStore();
  if (isDemoMode()) {
    const userId = await readDemoUserId();
    if (!userId) return null;
    const user = await store.getUser(userId);
    if (!user) return null;
    const [memberships, shops, portal] = await Promise.all([
      store.listMembershipsForUser(userId),
      store.listShopsForUser(userId),
      store.getPortalByUser(userId),
    ]);
    return { user, memberships, shops, vendorId: portal?.vendorId ?? null, isPlatformAdmin: user.isPlatformAdmin };
  }

  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const email = data.user.email ?? "";
  const admin = platformAdminEmails().includes(email.toLowerCase());
  let profile = await store.getUser(data.user.id);
  if (!profile) {
    profile = {
      id: data.user.id,
      email,
      fullName: (data.user.user_metadata?.full_name as string) || null,
      isPlatformAdmin: admin,
      createdAt: new Date().toISOString(),
    };
    await store.upsertUser(profile);
  } else if ((admin && !profile.isPlatformAdmin) || profile.email !== email) {
    profile = { ...profile, email, isPlatformAdmin: profile.isPlatformAdmin || admin };
    await store.upsertUser(profile);
  }
  const [memberships, shops, portal] = await Promise.all([
    store.listMembershipsForUser(profile.id),
    store.listShopsForUser(profile.id),
    store.getPortalByUser(profile.id),
  ]);
  return { user: profile, memberships, shops, vendorId: portal?.vendorId ?? null, isPlatformAdmin: profile.isPlatformAdmin };
}

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

export function homeFor(viewer: Viewer): string {
  if (viewer.shops.length > 0) return "/app";
  if (viewer.vendorId) return "/portal";
  if (viewer.isPlatformAdmin) return "/admin";
  return "/app/onboarding";
}

export async function selectedShop(viewer: Viewer): Promise<{ shop: Shop; role: MemberRole } | null> {
  if (viewer.shops.length === 0) return null;
  const jar = await cookies();
  const requested = jar.get(SHOP_COOKIE)?.value;
  const shop = viewer.shops.find((row) => row.id === requested) ?? viewer.shops[0];
  const role = viewer.memberships.find((member) => member.shopId === shop.id)?.role ?? "bookkeeper";
  return { shop, role };
}

export async function setShopCookie(shopId: string): Promise<void> {
  const jar = await cookies();
  jar.set(SHOP_COOKIE, shopId, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
}

export async function setDemoSession(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, await writeSessionToken(userId, sessionSecret()), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 14 * 24 * 60 * 60,
  });
}

export async function clearDemoSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function readDemoUserId(): Promise<string | null> {
  const jar = await cookies();
  return readSessionToken(jar.get(COOKIE)?.value, sessionSecret());
}

export async function signDemoToken(userId: string): Promise<string> {
  return writeSessionToken(userId, sessionSecret(), 7 * 24 * 60 * 60 * 1000);
}

export function safeNext(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export { appUrl };

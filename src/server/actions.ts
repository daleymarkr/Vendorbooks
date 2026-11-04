"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDemoMode, platformAdminEmails } from "@/domain/env";
import { parseDollarsToCents, percentToBps } from "@/domain/money";
import { PlanError } from "@/domain/plans";
import type { MemberRole, PayoutMethod } from "@/domain/types";
import { checkDemoPassword, setDemoPassword } from "@/server/store/demo";
import { getStore } from "@/server/store";
import { createSupabaseServer } from "@/server/supabase-auth";
import {
  allocateUnassigned,
  approveStatement,
  closeShopPeriod,
  forgiveStatement,
  importAttributionCsv,
  inviteVendor,
  markStatementPaid,
  pushTags,
  repriceOpenLines,
} from "@/server/workflows";
import { clearDemoSession, homeFor, requireViewer, safeNext, setDemoSession, setShopCookie } from "@/server/session";
import { loadShop } from "@/server/load";
import { resetDemo } from "@/server/store/demo";

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function fail(path: string, error: unknown): never {
  if (isNextRedirect(error)) throw error;
  const message = error instanceof Error ? error.message : "Something went wrong.";
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}

function isNextRedirect(error: unknown): boolean {
  return typeof error === "object" && error !== null && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}

async function role(roles: MemberRole[]) {
  const bundle = await loadShop();
  if (!bundle.shop || !bundle.role || !bundle.settings || !bundle.access) redirect("/app/onboarding");
  if (!roles.includes(bundle.role)) fail("/app", new Error("Your role can't do that."));
  return bundle as typeof bundle & { shop: NonNullable<typeof bundle.shop>; role: MemberRole; settings: NonNullable<typeof bundle.settings>; access: NonNullable<typeof bundle.access> };
}

export async function loginAction(form: FormData) {
  const email = text(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNext(text(form, "next"));
  try {
    if (isDemoMode()) {
      const store = await getStore();
      const user = await store.getUserByEmail(email);
      if (!user || !(await checkDemoPassword(user.id, password))) {
        throw new Error("Those credentials don't match the demo ledger.");
      }
      await setDemoSession(user.id);
      const [memberships, shops, portal] = await Promise.all([
        store.listMembershipsForUser(user.id),
        store.listShopsForUser(user.id),
        store.getPortalByUser(user.id),
      ]);
      redirect(next || homeFor({ user, memberships, shops, vendorId: portal?.vendorId ?? null, isPlatformAdmin: user.isPlatformAdmin }));
    }
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  } catch (error) {
    fail(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`, error);
  }
  redirect(next || "/app");
}

export async function signupAction(form: FormData) {
  const email = text(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const fullName = text(form, "fullName");
  try {
    if (password.length < 8) throw new Error("Use at least 8 characters.");
    if (isDemoMode()) {
      const store = await getStore();
      if (await store.getUserByEmail(email)) throw new Error("That email already has a demo login.");
      const id = crypto.randomUUID();
      await store.upsertUser({
        id,
        email,
        fullName: fullName || null,
        isPlatformAdmin: platformAdminEmails().includes(email),
        createdAt: new Date().toISOString(),
      });
      await setDemoPassword(id, password);
      await setDemoSession(id);
      redirect("/app/onboarding");
    }
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
    if (error) throw new Error(error.message);
  } catch (error) {
    fail("/signup", error);
  }
  redirect("/app/onboarding");
}

export async function logoutAction() {
  if (isDemoMode()) await clearDemoSession();
  else {
    const supabase = await createSupabaseServer();
    await supabase.auth.signOut();
  }
  redirect("/");
}

export async function createShopAction(form: FormData) {
  const viewer = await requireViewer();
  const name = text(form, "name");
  const timezone = text(form, "timezone") || "America/New_York";
  const statementDay = Number(text(form, "statementDay") || "1");
  try {
    if (name.length < 2) throw new Error("Give the shop a name.");
    if (statementDay < 1 || statementDay > 28) throw new Error("Statement day must be from 1 to 28.");
    const store = await getStore();
    const shop = await store.createShop({ userId: viewer.user.id, name, timezone, statementDay });
    await setShopCookie(shop.id);
    await store.audit({ actorUserId: viewer.user.id, action: "shop.created", meta: { shopId: shop.id, name } });
  } catch (error) {
    fail("/app/onboarding", error);
  }
  redirect("/app");
}

export async function switchShopAction(form: FormData) {
  await setShopCookie(text(form, "shopId"));
  redirect("/app");
}

export async function saveVendorAction(form: FormData) {
  const bundle = await role(["owner", "manager"]);
  const id = text(form, "id");
  const method = text(form, "payoutMethod");
  const payoutMethod = ["check", "ach", "zelle", "other"].includes(method) ? (method as PayoutMethod) : null;
  try {
    if (bundle.access.readOnly) throw new PlanError("This shop is read-only until billing is updated.");
    const input = {
      displayName: text(form, "displayName"),
      email: text(form, "email") || null,
      phone: text(form, "phone") || null,
      commissionBps: percentToBps(text(form, "commission") || "0"),
      boothRentCents: parseDollarsToCents(text(form, "boothRent") || "0"),
      payoutMethod,
      payoutDetails: text(form, "payoutDetails") || null,
      payoutDay: text(form, "payoutDay") ? Number(text(form, "payoutDay")) : null,
    };
    if (input.displayName.length < 2) throw new Error("Vendor name is required.");
    if (id) await bundle.store.updateVendor(id, input);
    else {
      await bundle.store.createVendor({ shopId: bundle.shop.id, ...input });
    }
  } catch (error) {
    fail(id ? `/app/vendors/${id}` : "/app/vendors/new", error);
  }
  revalidatePath("/app/vendors");
  redirect("/app/vendors");
}

export async function archiveVendorAction(form: FormData) {
  const bundle = await role(["owner", "manager"]);
  try {
    if (bundle.access.readOnly) throw new PlanError("This shop is read-only until billing is updated.");
    const vendor = await bundle.store.getVendor(text(form, "id"));
    if (!vendor || vendor.shopId !== bundle.shop.id) throw new Error("Vendor not found.");
    await bundle.store.updateVendor(vendor.id, { archivedAt: vendor.archivedAt ? null : new Date().toISOString() });
  } catch (error) {
    fail("/app/vendors", error);
  }
  revalidatePath("/app/vendors");
  redirect("/app/vendors");
}

export async function inviteVendorAction(form: FormData) {
  const bundle = await role(["owner", "manager"]);
  let link = "";
  try {
    link = await inviteVendor(bundle.store, text(form, "vendorId"), bundle.viewer.user.id);
  } catch (error) {
    fail(`/app/vendors/${text(form, "vendorId")}`, error);
  }
  redirect(`/app/vendors/${text(form, "vendorId")}?notice=${encodeURIComponent("Invite ready.")}&link=${encodeURIComponent(link)}`);
}

export async function saveSettingsAction(form: FormData) {
  const bundle = await role(["owner"]);
  try {
    if (bundle.access.readOnly) throw new PlanError("This shop is read-only until billing is updated.");
    const settings = await bundle.store.updateSettings(bundle.shop.id, {
      excludeSalesTax: form.get("excludeSalesTax") === "on",
      excludeTips: form.get("excludeTips") === "on",
      feeMode: form.get("feeMode") === "pass_through" ? "pass_through" : "shop_absorbs",
      boothRentMode: form.get("boothRentMode") === "separate" ? "separate" : "deduct",
      negativeBalanceMode: form.get("negativeBalanceMode") === "forgive" ? "forgive" : "carry",
      serviceChargeMode: (["exclude", "include", "map"].includes(text(form, "serviceChargeMode"))
        ? text(form, "serviceChargeMode")
        : "exclude") as "exclude" | "include" | "map",
    });
    const names = form.getAll("chargeName").map(String);
    const targets = form.getAll("chargeTarget").map(String);
    const vendorIds = form.getAll("chargeVendor").map(String);
    settings.serviceChargeRules = names
      .map((name, index) => ({
        name: name.trim(),
        target: (targets[index] === "vendor" ? "vendor" : targets[index] === "base" ? "base" : "shop") as "shop" | "base" | "vendor",
        vendorId: vendorIds[index] || null,
      }))
      .filter((rule) => rule.name);
    await bundle.store.updateSettings(bundle.shop.id, { serviceChargeRules: settings.serviceChargeRules });
    await bundle.store.updateShop(bundle.shop.id, {
      name: text(form, "name") || bundle.shop.name,
      timezone: text(form, "timezone") || bundle.shop.timezone,
      statementDay: Number(text(form, "statementDay") || bundle.shop.statementDay),
    });
    if (form.get("reprice") === "on") await repriceOpenLines(bundle.store, bundle.shop.id, await bundle.store.getSettings(bundle.shop.id));
  } catch (error) {
    fail("/app/settings", error);
  }
  revalidatePath("/app/settings");
  redirect("/app/settings?notice=Saved.+New+sales+use+these+rules.");
}

export async function addRuleAction(form: FormData) {
  const bundle = await role(["owner", "manager"]);
  try {
    const ruleType = text(form, "ruleType");
    if (!["sku_prefix", "category", "name_pattern"].includes(ruleType)) throw new Error("Choose a rule type.");
    await bundle.store.createRule({
      shopId: bundle.shop.id,
      priority: Number(text(form, "priority") || "100"),
      ruleType: ruleType as "sku_prefix" | "category" | "name_pattern",
      pattern: text(form, "pattern"),
      vendorId: text(form, "vendorId"),
      active: true,
    });
  } catch (error) {
    fail("/app/catalog", error);
  }
  revalidatePath("/app/catalog");
  redirect("/app/catalog");
}

export async function deleteRuleAction(form: FormData) {
  const bundle = await role(["owner", "manager"]);
  await bundle.store.deleteRule(text(form, "id"));
  revalidatePath("/app/catalog");
  redirect("/app/catalog");
}

export async function importCsvAction(form: FormData) {
  const bundle = await role(["owner", "manager"]);
  const file = form.get("file");
  try {
    const csv = typeof file === "string" ? file : file instanceof File ? await file.text() : "";
    if (!csv.trim()) throw new Error("Choose a CSV file.");
    const count = await importAttributionCsv(bundle.store, bundle.shop.id, csv);
    redirect(`/app/catalog?notice=${encodeURIComponent(`Mapped ${count} catalog rows.`)}`);
  } catch (error) {
    fail("/app/catalog", error);
  }
}

export async function saveTagsAction(form: FormData) {
  const bundle = await role(["owner", "manager"]);
  const ids = form.getAll("catalogObjectId").map(String);
  const vendors = form.getAll("vendorId").map(String);
  const pairs = ids.map((catalogObjectId, index) => ({ catalogObjectId, vendorId: vendors[index] })).filter((pair) => pair.vendorId);
  try {
    const message = await pushTags(bundle.store, bundle.shop.id, pairs);
    redirect(`/app/catalog?notice=${encodeURIComponent(message)}`);
  } catch (error) {
    fail("/app/catalog", error);
  }
}

export async function allocateAction(form: FormData) {
  const bundle = await role(["owner", "manager"]);
  try {
    if (bundle.access.readOnly) throw new PlanError("This shop is read-only until billing is updated.");
    const vendorId = text(form, "vendorId");
    await allocateUnassigned(bundle.store, bundle.shop.id, text(form, "id"), vendorId || null, bundle.viewer.user.id);
  } catch (error) {
    fail("/app/unassigned", error);
  }
  revalidatePath("/app/unassigned");
  redirect("/app/unassigned?notice=Queue+updated.");
}

export async function closeAction(form: FormData) {
  const bundle = await role(["owner", "manager"]);
  const period = text(form, "period");
  try {
    const result = await closeShopPeriod(bundle.store, bundle.shop.id, period, bundle.viewer.user.id);
    redirect(`/app/close?notice=${encodeURIComponent(`Prepared ${result.count} statements for ${period}.`)}`);
  } catch (error) {
    fail(`/app/close?period=${encodeURIComponent(period)}`, error);
  }
}

export async function approveAction(form: FormData) {
  const bundle = await role(["owner", "manager"]);
  const id = text(form, "id");
  try {
    const statement = await bundle.store.getStatement(id);
    if (!statement || statement.shopId !== bundle.shop.id) throw new Error("Statement not found.");
    await approveStatement(bundle.store, id, bundle.viewer.user.id);
  } catch (error) {
    fail(`/app/statements/${id}`, error);
  }
  revalidatePath(`/app/statements/${id}`);
  redirect(`/app/statements/${id}?notice=Approved.+The+shop+can+now+record+the+payment+it+makes+outside+VendorBooks.`);
}

export async function markPaidAction(form: FormData) {
  const bundle = await role(["owner", "manager", "bookkeeper"]);
  const id = text(form, "id");
  try {
    const statement = await bundle.store.getStatement(id);
    if (!statement || statement.shopId !== bundle.shop.id) throw new Error("Statement not found.");
    await markStatementPaid(bundle.store, id, bundle.viewer.user.id, text(form, "method"), text(form, "reference"));
  } catch (error) {
    fail(`/app/statements/${id}`, error);
  }
  redirect(`/app/statements/${id}?notice=Recorded.+VendorBooks+did+not+move+the+money.`);
}

export async function forgiveAction(form: FormData) {
  const bundle = await role(["owner"]);
  const id = text(form, "id");
  try {
    await forgiveStatement(bundle.store, id, bundle.viewer.user.id);
  } catch (error) {
    fail(`/app/statements/${id}`, error);
  }
  redirect(`/app/statements/${id}?notice=Negative+balance+written+off.+Next+period+opens+at+zero.`);
}

export async function resetDemoAction() {
  if (!isDemoMode()) redirect("/app/settings");
  await resetDemo();
  redirect("/app?notice=Demo+ledger+restored.");
}

import type { PlanId, Shop } from "./types";

export type ShopAccess = {
  /** Plan used for caps. Falls back to free when a paid trial has ended. */
  plan: PlanId;
  /** Plan stored on the shop, which may still say shop/mall after expiry. */
  namedPlan: PlanId;
  readOnly: boolean;
  vendorCap: number | null;
  locationCap: number | null;
  reason: string | null;
};

export function vendorCapFor(plan: PlanId): number | null {
  if (plan === "free") return 5;
  if (plan === "shop") return 50;
  return null;
}

export function locationCapFor(plan: PlanId): number | null {
  if (plan === "free") return 1;
  return null;
}

export function resolveAccess(shop: Pick<
  Shop,
  "plan" | "trialEndsAt" | "stripeStatus" | "billingGraceUntil"
>, now: Date): ShopAccess {
  const named = shop.plan;
  const status = shop.stripeStatus;
  const trialActive =
    named !== "free" && shop.trialEndsAt != null && new Date(shop.trialEndsAt).getTime() > now.getTime();
  const graceActive =
    shop.billingGraceUntil != null && new Date(shop.billingGraceUntil).getTime() > now.getTime();
  const paid = status === "active" || status === "trialing";

  if (status === "past_due" || status === "unpaid" || status === "incomplete") {
    if (graceActive || status === "trialing") {
      return pack(named, named, false, null);
    }
    return pack(named, named, true, "payment_failed");
  }

  if (paid || trialActive) {
    return pack(named, named, false, trialActive && !paid ? "trial" : null);
  }

  if (named === "free") return pack("free", "free", false, null);
  return pack("free", named, false, "trial_ended");
}

function pack(plan: PlanId, namedPlan: PlanId, readOnly: boolean, reason: string | null): ShopAccess {
  return {
    plan,
    namedPlan,
    readOnly,
    vendorCap: vendorCapFor(plan),
    locationCap: locationCapFor(plan),
    reason,
  };
}

export function isOverVendorCap(access: ShopAccess, activeVendorCount: number): boolean {
  if (access.vendorCap == null) return false;
  return activeVendorCount > access.vendorCap;
}

export function assertCanCreateVendor(access: ShopAccess, activeVendorCount: number): void {
  if (access.readOnly) {
    throw new PlanError("This shop is read-only until billing is updated. Existing records stay available.");
  }
  if (access.vendorCap != null && activeVendorCount >= access.vendorCap) {
    const label = access.plan === "free" ? "Free" : access.plan === "shop" ? "Shop" : "Mall";
    throw new PlanError(
      `${label} includes ${access.vendorCap} active vendors. Archive a vendor or upgrade to add another.`,
    );
  }
}

export function assertCanAddLocation(access: ShopAccess, activeLocationCount: number): void {
  if (access.readOnly) {
    throw new PlanError("This shop is read-only until billing is updated. Existing locations stay available.");
  }
  if (access.locationCap != null && activeLocationCount >= access.locationCap) {
    throw new PlanError("The Free plan includes one location. Upgrade to Shop or Mall for multiple locations.");
  }
}

export function assertCanRunClose(access: ShopAccess, activeVendorCount: number): void {
  if (access.readOnly) {
    throw new PlanError("Monthly close is paused until billing is updated. You can still read existing statements.");
  }
  if (isOverVendorCap(access, activeVendorCount)) {
    throw new PlanError(
      "This shop is over its vendor limit. Archive vendors or upgrade before running a monthly close. Existing statements stay readable.",
    );
  }
}

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

/** Annual price is exactly 10× monthly (two months free). */
export function annualIsTenMonths(monthlyCents: number, annualCents: number): boolean {
  return annualCents === monthlyCents * 10;
}

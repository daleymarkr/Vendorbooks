import { allocateProRata, applyCommissionBps } from "./money";
import type { FeeMode, PayoutSettings, ServiceChargeRule } from "./types";

export function defaultSettings(shopId: string, now = new Date().toISOString()): PayoutSettings {
  return {
    shopId,
    excludeSalesTax: true,
    excludeTips: true,
    feeMode: "shop_absorbs",
    boothRentMode: "deduct",
    negativeBalanceMode: "carry",
    serviceChargeMode: "exclude",
    serviceChargeRules: [],
    roundingMode: "half_even",
    updatedAt: now,
  };
}

export type LineEconomicsInput = {
  grossCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  /** This line's share of Square processing fees. Ignored unless fee mode is pass_through. */
  feeCents: number;
  /** Service-charge cents already chosen for this line (0 when excluded). */
  serviceChargeCents?: number;
  commissionBps: number | null;
  settings: Pick<PayoutSettings, "excludeSalesTax" | "excludeTips" | "feeMode">;
};

export type LineEconomics = {
  baseCents: number;
  vendorEarnCents: number;
  feeAppliedCents: number;
};

/**
 * Commission base is merchandise after Square's apportioned discounts.
 * Tax and tips stay out unless the owner opts in. gross_sales_money from
 * Square is treated as pre-tax (worked example A: $100 gross + $8 tax → base $100).
 */
export function computeLineEconomics(input: LineEconomicsInput): LineEconomics {
  let base = input.grossCents - input.discountCents + (input.serviceChargeCents ?? 0);
  if (!input.settings.excludeSalesTax) base += input.taxCents;
  if (!input.settings.excludeTips) base += input.tipCents;
  const feeApplied = input.settings.feeMode === "pass_through" ? input.feeCents : 0;
  const commissioned = input.commissionBps == null ? 0 : applyCommissionBps(base, input.commissionBps);
  return {
    baseCents: base,
    vendorEarnCents: commissioned - feeApplied,
    feeAppliedCents: feeApplied,
  };
}

export function feeSharesForLines(bases: number[], totalFeeCents: number): number[] {
  return allocateProRata(bases.map((b) => Math.max(0, b)), totalFeeCents);
}

export function serviceChargeDisposition(
  chargeName: string,
  mode: PayoutSettings["serviceChargeMode"],
  rules: ServiceChargeRule[],
): { includeInBase: boolean; vendorId: string | null } {
  if (mode === "exclude") return { includeInBase: false, vendorId: null };
  if (mode === "include") return { includeInBase: true, vendorId: null };
  const rule = rules.find((r) => r.name.trim().toLowerCase() === chargeName.trim().toLowerCase());
  if (!rule || rule.target === "shop") return { includeInBase: false, vendorId: null };
  if (rule.target === "vendor") return { includeInBase: true, vendorId: rule.vendorId ?? null };
  return { includeInBase: true, vendorId: null };
}

export function recomputeEarn(input: {
  baseCents: number;
  commissionBps: number | null;
  feeCents: number;
  feeMode: FeeMode;
}): number {
  const commissioned = input.commissionBps == null ? 0 : applyCommissionBps(input.baseCents, input.commissionBps);
  const fee = input.feeMode === "pass_through" ? input.feeCents : 0;
  return commissioned - fee;
}

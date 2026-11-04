import { describe, expect, it } from "vitest";
import { applyCommissionBps, parseDollarsToCents, prorate } from "@/domain/money";
import { computeLineEconomics, feeSharesForLines } from "@/domain/payout";
import { PLAN_PRICE_CENTS } from "@/domain/types";
import { annualIsTenMonths } from "@/domain/plans";
import { defaultSettings } from "@/domain/payout";
import { SHOP } from "./helpers";

const settings = defaultSettings(SHOP);

describe("commission rounding", () => {
  it("rounds half cents to even", () => {
    expect(applyCommissionBps(1, 5000)).toBe(0);
    expect(applyCommissionBps(3, 5000)).toBe(2);
    expect(prorate(5, 1, 2)).toBe(2);
    expect(prorate(1, 1, 2)).toBe(0);
  });

  it("parses the spec rounding case of 33.335 dollars to half-even cents", () => {
    expect(parseDollarsToCents("33.335")).toBe(3334);
    expect(parseDollarsToCents("33.345")).toBe(3334);
    expect(parseDollarsToCents("1.005")).toBe(100);
    expect(parseDollarsToCents("1.015")).toBe(102);
    expect(parseDollarsToCents("$100.00")).toBe(10000);
  });
});

describe("worked examples", () => {
  it("A — simple sale excludes tax and tip and lets the shop absorb fees", () => {
    const result = computeLineEconomics({
      grossCents: 10000,
      discountCents: 0,
      taxCents: 800,
      tipCents: 500,
      feeCents: 290,
      commissionBps: 6000,
      settings,
    });
    expect(result.baseCents).toBe(10000);
    expect(result.vendorEarnCents).toBe(6000);
    expect(result.feeAppliedCents).toBe(0);
  });

  it("includes tax or tips only when the owner opts in", () => {
    const withTax = computeLineEconomics({
      grossCents: 10000,
      discountCents: 0,
      taxCents: 800,
      tipCents: 500,
      feeCents: 0,
      commissionBps: 6000,
      settings: { ...settings, excludeSalesTax: false },
    });
    expect(withTax.baseCents).toBe(10800);
    expect(withTax.vendorEarnCents).toBe(6480);

    const withTip = computeLineEconomics({
      grossCents: 10000,
      discountCents: 0,
      taxCents: 800,
      tipCents: 500,
      feeCents: 0,
      commissionBps: 6000,
      settings: { ...settings, excludeTips: false },
    });
    expect(withTip.baseCents).toBe(10500);
    expect(withTip.vendorEarnCents).toBe(6300);
  });

  it("B — uses Square's apportioned discounts, not a fresh split", () => {
    const alice = computeLineEconomics({
      grossCents: 8000,
      discountCents: 800,
      taxCents: 0,
      tipCents: 0,
      feeCents: 0,
      commissionBps: 6000,
      settings,
    });
    const bob = computeLineEconomics({
      grossCents: 2000,
      discountCents: 200,
      taxCents: 0,
      tipCents: 0,
      feeCents: 0,
      commissionBps: 5000,
      settings,
    });
    expect(alice).toMatchObject({ baseCents: 7200, vendorEarnCents: 4320 });
    expect(bob).toMatchObject({ baseCents: 1800, vendorEarnCents: 900 });

    const uneven = computeLineEconomics({
      grossCents: 8000,
      discountCents: 801,
      taxCents: 0,
      tipCents: 0,
      feeCents: 0,
      commissionBps: 6000,
      settings,
    });
    expect(uneven.baseCents).toBe(7199);
    expect(uneven.vendorEarnCents).toBe(4319);
  });

  it("C — subtracts a pro-rata Square fee only when pass-through is on", () => {
    expect(feeSharesForLines([10000], 320)).toEqual([320]);
    expect(feeSharesForLines([7500, 2500], 400)).toEqual([300, 100]);
    expect(feeSharesForLines([1, 1, 1], 1)).toEqual([1, 0, 0]);

    const passed = computeLineEconomics({
      grossCents: 10000,
      discountCents: 0,
      taxCents: 0,
      tipCents: 0,
      feeCents: 320,
      commissionBps: 6000,
      settings: { ...settings, feeMode: "pass_through" },
    });
    expect(passed.vendorEarnCents).toBe(5680);

    const absorbed = computeLineEconomics({
      grossCents: 10000,
      discountCents: 0,
      taxCents: 0,
      tipCents: 0,
      feeCents: 320,
      commissionBps: 6000,
      settings,
    });
    expect(absorbed.vendorEarnCents).toBe(6000);
  });
});

describe("pricing", () => {
  it("prices annual plans at ten times monthly", () => {
    expect(annualIsTenMonths(PLAN_PRICE_CENTS.shop.monthly, PLAN_PRICE_CENTS.shop.annual)).toBe(true);
    expect(annualIsTenMonths(PLAN_PRICE_CENTS.mall.monthly, PLAN_PRICE_CENTS.mall.annual)).toBe(true);
    expect(PLAN_PRICE_CENTS.shop.monthly).toBe(4900);
    expect(PLAN_PRICE_CENTS.mall.monthly).toBe(12900);
  });
});

/**
 * Integer-cent money helpers.
 * Commission uses banker's rounding (half to even) on the exact rational
 * base_cents * commission_bps / 10000, with no binary floating point.
 */

export function roundHalfEven(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Cannot round a non-finite number");
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const floor = Math.floor(abs);
  const frac = abs - floor;
  if (Math.abs(frac - 0.5) < 1e-9) {
    const even = floor % 2 === 0 ? floor : floor + 1;
    return sign * even;
  }
  return sign * Math.round(abs);
}

/** Banker's rounding of (amount * numerator) / denominator to an integer. */
export function prorate(amount: number, numerator: number, denominator: number): number {
  if (!Number.isInteger(amount) || !Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new Error("prorate expects integers");
  }
  if (denominator === 0) return 0;
  const neg = amount < 0 !== numerator < 0;
  const absAmount = Math.abs(amount);
  const absNum = Math.abs(numerator);
  const absDen = Math.abs(denominator);
  const prod = absAmount * absNum;
  const whole = Math.floor(prod / absDen);
  const rem = prod % absDen;
  let result = whole;
  if (rem * 2 > absDen) result += 1;
  else if (rem * 2 === absDen && whole % 2 !== 0) result += 1;
  return neg ? -result : result;
}

/**
 * Vendor commission in cents.
 * commission_bps is parts per 10_000 (60% = 6000).
 */
export function applyCommissionBps(baseCents: number, commissionBps: number): number {
  if (commissionBps < 0 || commissionBps > 10000) {
    throw new Error("commission_bps must be between 0 and 10000");
  }
  return prorate(baseCents, commissionBps, 10000);
}

/**
 * Parse a dollar string to integer cents with half-even rounding on the
 * third decimal. "33.335" → 3334 cents. "33.345" → 3334 cents.
 */
export function parseDollarsToCents(input: string | number): number {
  const s = String(input).trim().replace(/[$,\s]/g, "");
  if (!s) return 0;
  const neg = s.startsWith("-");
  const raw = neg ? s.slice(1) : s;
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error(`Invalid dollar amount: ${input}`);
  const [whole, frac = ""] = raw.split(".");
  const mills = (frac + "000").slice(0, 3);
  const cents = Number(whole) * 100 + Number(mills.slice(0, 2));
  const next = Number(mills[2] ?? "0");
  const trailing = frac.slice(3);
  const trailingNonZero = /[1-9]/.test(trailing);
  let result = cents;
  if (next > 5 || (next === 5 && trailingNonZero)) result += 1;
  else if (next === 5 && cents % 2 !== 0) result += 1;
  return neg ? -result : result;
}

export function formatUsd(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const body = `${dollars.toLocaleString("en-US")}.${String(rem).padStart(2, "0")}`;
  return neg ? `-$${body}` : `$${body}`;
}

export function bpsToPercentLabel(bps: number): string {
  const hundredths = bps / 100;
  const fixed = hundredths.toFixed(2);
  return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export function percentToBps(percent: string | number): number {
  const centsOfPercent = parseDollarsToCents(String(percent));
  if (centsOfPercent < 0 || centsOfPercent > 10000) {
    throw new Error("Commission percent must be between 0 and 100");
  }
  return centsOfPercent;
}

/** Largest-remainder allocation so shares sum to `total`. Weights may be zero. */
export function allocateProRata(weights: number[], total: number): number[] {
  if (weights.length === 0) return [];
  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);
  const safe = weights.map((w) => Math.max(0, Math.trunc(w)));
  const sum = safe.reduce((a, b) => a + b, 0);
  if (absTotal === 0) return weights.map(() => 0);
  if (sum === 0) return allocateProRata(safe.map(() => 1), total);

  const floors = safe.map((w) => Math.floor((w * absTotal) / sum));
  let allocated = floors.reduce((a, b) => a + b, 0);
  const remainders = safe.map((w, i) => ({ i, r: (w * absTotal) % sum }));
  remainders.sort((a, b) => b.r - a.r || a.i - b.i);
  let cursor = 0;
  while (allocated < absTotal) {
    floors[remainders[cursor % remainders.length].i] += 1;
    allocated += 1;
    cursor += 1;
  }
  return sign < 0 ? floors.map((n) => -n) : floors;
}

export function moneyAmount(money: { amount?: number; currency?: string } | undefined | null): {
  amount: number;
  currency: string;
} {
  return {
    amount: money?.amount ?? 0,
    currency: (money?.currency ?? "USD").toUpperCase(),
  };
}

export function quantityMicros(quantity: string | number | undefined): number {
  const s = String(quantity ?? "1").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return 0;
  const neg = s.startsWith("-");
  const raw = neg ? s.slice(1) : s;
  const [whole, frac = ""] = raw.split(".");
  const micros = Number(whole) * 1_000_000 + Number((frac + "000000").slice(0, 6));
  return neg ? -micros : micros;
}

export function periodYm(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp: ${iso}`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  if (!year || !month) throw new Error("Could not format period");
  return `${year}-${month}`;
}

export function addMonthsYm(ym: string, count: number): string {
  const [year, month] = ym.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + count, 1));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function stableHash(input: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

export function chunkIds<T>(ids: T[], size = 10): T[][] {
  if (size < 1) throw new Error("chunk size must be positive");
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

import { parseDollarsToCents } from "./money";
import { computeLineEconomics, defaultSettings } from "./payout";
import { toCsv } from "./statements";
import type { PayoutSettings } from "./types";

export type CalculatorInputRow = {
  vendor: string;
  grossCents: number;
  discountCents: number;
  taxCents: number;
  commissionBps: number;
  boothRentCents: number;
};

export type CalculatorVendorTotal = {
  vendor: string;
  grossCents: number;
  discountCents: number;
  baseCents: number;
  earnCents: number;
  boothRentCents: number;
  amountToPayCents: number;
};

export function parseSalesCsv(text: string): CalculatorInputRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const index = (names: string[]) => header.findIndex((cell) => names.includes(cell));
  const vendorIdx = index(["vendor", "vendor_name", "consignor"]);
  const grossIdx = index(["gross", "gross_sales", "sales", "amount"]);
  const discountIdx = index(["discount", "discounts", "line_discount"]);
  const taxIdx = index(["tax", "sales_tax"]);
  const commissionIdx = index(["commission_percent", "commission", "commission_pct", "rate"]);
  const rentIdx = index(["booth_rent", "rent"]);
  if (vendorIdx < 0 || grossIdx < 0 || commissionIdx < 0) {
    throw new Error("CSV needs vendor, gross, and commission_percent columns.");
  }
  return rows.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) => ({
    vendor: (row[vendorIdx] ?? "").trim(),
    grossCents: parseDollarsToCents(row[grossIdx] || "0"),
    discountCents: discountIdx >= 0 ? parseDollarsToCents(row[discountIdx] || "0") : 0,
    taxCents: taxIdx >= 0 ? parseDollarsToCents(row[taxIdx] || "0") : 0,
    commissionBps: parseDollarsToCents(row[commissionIdx] || "0"),
    boothRentCents: rentIdx >= 0 ? parseDollarsToCents(row[rentIdx] || "0") : 0,
  }));
}

export function calculateCsvPayouts(
  rows: CalculatorInputRow[],
  settings: Pick<PayoutSettings, "excludeSalesTax" | "excludeTips" | "feeMode"> = defaultSettings("calc"),
): CalculatorVendorTotal[] {
  const grouped = new Map<string, CalculatorVendorTotal>();
  for (const row of rows) {
    if (!row.vendor) continue;
    const economics = computeLineEconomics({
      grossCents: row.grossCents,
      discountCents: row.discountCents,
      taxCents: row.taxCents,
      tipCents: 0,
      feeCents: 0,
      commissionBps: row.commissionBps,
      settings,
    });
    const current = grouped.get(row.vendor) ?? {
      vendor: row.vendor,
      grossCents: 0,
      discountCents: 0,
      baseCents: 0,
      earnCents: 0,
      boothRentCents: 0,
      amountToPayCents: 0,
    };
    current.grossCents += row.grossCents;
    current.discountCents += row.discountCents;
    current.baseCents += economics.baseCents;
    current.earnCents += economics.vendorEarnCents;
    current.boothRentCents = Math.max(current.boothRentCents, row.boothRentCents);
    grouped.set(row.vendor, current);
  }
  return [...grouped.values()].map((row) => ({
    ...row,
    amountToPayCents: row.earnCents - row.boothRentCents,
  }));
}

export function calculatorResultCsv(rows: CalculatorVendorTotal[]): string {
  const header = ["vendor", "gross", "discounts", "base", "vendor_earn", "booth_rent", "amount_for_shop_to_pay"];
  const body = rows.map((row) => [
    row.vendor,
    dollars(row.grossCents),
    dollars(row.discountCents),
    dollars(row.baseCents),
    dollars(row.earnCents),
    dollars(row.boothRentCents),
    dollars(row.amountToPayCents),
  ]);
  return toCsv([header, ...body]);
}

function dollars(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? "-" : ""}${(abs / 100).toFixed(2)}`;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const char = src[i];
    if (quoted) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function parseAttributionCsv(text: string): { key: string; vendorName: string; keyType: "sku" | "catalog_object_id" }[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const vendorIdx = header.findIndex((cell) => ["vendor", "vendor_name"].includes(cell));
  const skuIdx = header.findIndex((cell) => cell === "sku");
  const idIdx = header.findIndex((cell) => ["catalog_object_id", "item_id", "id"].includes(cell));
  if (vendorIdx < 0 || (skuIdx < 0 && idIdx < 0)) {
    throw new Error("CSV needs vendor and either sku or catalog_object_id.");
  }
  return rows.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) => {
    if (idIdx >= 0 && (row[idIdx] ?? "").trim()) {
      return { key: row[idIdx].trim(), vendorName: (row[vendorIdx] ?? "").trim(), keyType: "catalog_object_id" as const };
    }
    return { key: (row[skuIdx] ?? "").trim(), vendorName: (row[vendorIdx] ?? "").trim(), keyType: "sku" as const };
  });
}

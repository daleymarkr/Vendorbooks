import { buildYearEndCsv } from "@/server/workflows";
import { loadShop } from "@/server/load";

export async function GET(request: Request) {
  const bundle = await loadShop();
  if (!bundle.shop) return new Response("Not found", { status: 404 });
  const year = new URL(request.url).searchParams.get("year") || String(new Date().getFullYear());
  if (!/^\d{4}$/.test(year)) return new Response("Bad year", { status: 400 });
  const [vendors, lines, statements] = await Promise.all([
    bundle.store.listVendors(bundle.shop.id, true),
    bundle.store.listLedger(bundle.shop.id),
    bundle.store.listStatements(bundle.shop.id),
  ]);
  const csv = buildYearEndCsv({
    year,
    vendors,
    lines: lines.filter((line) => line.periodYm.startsWith(year)),
    statements: statements.filter((statement) => statement.periodYm.startsWith(year)),
  });
  return new Response(csv, {
    headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="vendorbooks-${year}.csv"` },
  });
}

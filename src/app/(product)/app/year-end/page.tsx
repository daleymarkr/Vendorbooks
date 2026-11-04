import { redirect } from "next/navigation";
import { PageIntro } from "@/components/ui";
import { loadShop } from "@/server/load";

export default async function YearEndPage() {
  const bundle = await loadShop();
  if (!bundle.shop) redirect("/app/onboarding");
  const year = String(new Date().getFullYear());
  return (
    <div>
      <PageIntro title="Year-end totals" lede="A CSV of vendor gross, commission, booth rent, and amounts the shop has recorded as paid. This is not a tax form." />
      <a className="btn-primary" href={`/api/year-end?year=${year}`}>Download {year} CSV</a>
    </div>
  );
}

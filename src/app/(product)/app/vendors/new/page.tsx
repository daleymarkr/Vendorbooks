import { VendorForm } from "@/components/vendor-form";
import { loadShop } from "@/server/load";
import { redirect } from "next/navigation";

export default async function NewVendorPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const bundle = await loadShop();
  if (!bundle.shop) redirect("/app/onboarding");
  const query = await searchParams;
  return <VendorForm error={query.error} />;
}

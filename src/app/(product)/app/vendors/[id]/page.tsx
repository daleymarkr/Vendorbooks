import { notFound, redirect } from "next/navigation";
import { VendorForm } from "@/components/vendor-form";
import { loadShop } from "@/server/load";

export default async function EditVendorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string; link?: string }> }) {
  const bundle = await loadShop();
  if (!bundle.shop) redirect("/app/onboarding");
  const { id } = await params;
  const query = await searchParams;
  const vendor = bundle.vendors.find((row) => row.id === id) ?? (await bundle.store.getVendor(id));
  if (!vendor || vendor.shopId !== bundle.shop.id) notFound();
  return <VendorForm vendor={vendor} error={query.error} notice={query.notice} link={query.link} />;
}

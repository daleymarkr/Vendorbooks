import type { MetadataRoute } from "next";
import { appUrl } from "@/domain/env";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();
  return [
    "",
    "/pricing",
    "/calculator",
    "/privacy",
    "/terms",
    "/consignment-software-for-square",
    "/vendor-mall-payouts",
    "/booth-rental-tracking",
  ].map((path) => ({ url: `${base}${path}`, changeFrequency: "weekly" as const }));
}

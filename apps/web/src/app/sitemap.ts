import type { MetadataRoute } from "next";
import { PUBLIC_PATHS, siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl(process.env.NEXT_PUBLIC_SITE_URL);
  if (!base) return [];
  return PUBLIC_PATHS.map((path) => ({ url: new URL(path, base).toString() }));
}

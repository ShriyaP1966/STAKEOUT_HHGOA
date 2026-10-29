import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl(process.env.NEXT_PUBLIC_SITE_URL);
  return {
    rules: { userAgent: "*", allow: "/" },
    ...(base ? { sitemap: new URL("/sitemap.xml", base).toString() } : {}),
  };
}

import path from "node:path";
import type { NextConfig } from "next";
import { BACKEND_PROXY_PATH } from "./src/lib/backend-path";

const repoRoot = path.resolve(__dirname, "..", "..");

function backendRewrites() {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.trim().replace(/\/+$/, "");
  if (!backendUrl) return [];
  return [{ source: `${BACKEND_PROXY_PATH}/:path*`, destination: `${backendUrl}/:path*` }];
}

const nextConfig: NextConfig = {
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  experimental: { externalDir: true },
  async rewrites() {
    return backendRewrites();
  },
};

export default nextConfig;

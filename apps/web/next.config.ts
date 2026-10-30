import path from "node:path";
import type { NextConfig } from "next";
import { BACKEND_PROXY_PATH } from "./src/lib/backend-path";
import { GRAPH_PROXY_PATH } from "./src/lib/graph-path";

const repoRoot = path.resolve(__dirname, "..", "..");

function proxyRewrite(proxyPath: string, rawUrl: string | undefined) {
  const url = rawUrl?.trim().replace(/\/+$/, "");
  if (!url) return [];
  return [{ source: `${proxyPath}/:path*`, destination: `${url}/:path*` }];
}

const nextConfig: NextConfig = {
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: { "/**": ["../../deployments/**", "../../config/**"] },
  experimental: { externalDir: true },
  async rewrites() {
    return [
      ...proxyRewrite(BACKEND_PROXY_PATH, process.env.NEXT_PUBLIC_BACKEND_URL),
      ...proxyRewrite(GRAPH_PROXY_PATH, process.env.NEXT_PUBLIC_GRAPH_URL),
    ];
  },
};

export default nextConfig;

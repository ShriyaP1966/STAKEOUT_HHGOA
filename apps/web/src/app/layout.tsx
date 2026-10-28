import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ConfigError } from "@/components/ConfigError";
import { Providers } from "@/components/Providers";
import { Shell } from "@/components/Shell";
import { loadAppConfig } from "@/lib/app-config.server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stakeout",
  description: "Check the scam status of a wallet before sending funds.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  const config = loadAppConfig();
  return (
    <html lang="en">
      <body className="antialiased">
        {config.ok ? (
          <Providers config={config.value}>
            <Shell>{children}</Shell>
          </Providers>
        ) : (
          <ConfigError problems={config.problems} />
        )}
      </body>
    </html>
  );
}

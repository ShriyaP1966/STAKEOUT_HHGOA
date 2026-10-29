import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ConfigError } from "@/components/ConfigError";
import { Providers } from "@/components/Providers";
import { Shell } from "@/components/Shell";
import { loadAppConfig } from "@/lib/app-config.server";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, siteUrl } from "@/lib/site";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: siteUrl(process.env.NEXT_PUBLIC_SITE_URL),
  title: { default: `${SITE_NAME}: check a wallet before you send`, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME}: check a wallet before you send`,
    description: `${SITE_TAGLINE} ${SITE_DESCRIPTION}`,
  },
  twitter: { card: "summary", title: `${SITE_NAME}: check a wallet before you send`, description: `${SITE_TAGLINE} ${SITE_DESCRIPTION}` },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f6" },
    { media: "(prefers-color-scheme: dark)", color: "#121110" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const config = loadAppConfig();
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
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

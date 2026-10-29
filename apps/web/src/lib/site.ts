export const SITE_NAME = "Stakeout";

export const SITE_DESCRIPTION =
  "Check whether a crypto wallet is reported, flagged or part of a confirmed scam cluster before you send funds. Testnet prototype.";

export function siteUrl(raw: string | undefined): URL | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
}

export const PUBLIC_PATHS = ["/", "/wallet", "/report", "/verify", "/dashboard", "/faq", "/support", "/privacy", "/terms"] as const;

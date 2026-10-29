export const SITE_NAME = "Stakeout";

export const SITE_TAGLINE = "Stake your evidence. Stop the scam before it moves.";

export const SITE_DESCRIPTION =
  "Check whether a crypto wallet is reported, flagged or part of a confirmed scam cluster before you send funds. Testnet prototype.";

export const CONTACT_EMAIL = "stakeout202@gmail.com";

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

export const PUBLIC_PATHS = ["/", "/wallet", "/report", "/verify", "/dashboard", "/faq", "/pricing", "/support", "/privacy", "/terms"] as const;

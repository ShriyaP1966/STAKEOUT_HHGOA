export type Redactor = (text: string) => string;

/**
 * Builds a function that removes known secrets from any text before it is logged or sent.
 * For a URL, the parts that can carry a key (path, query, password) are removed too, not just the whole string.
 */
export function makeRedactor(secrets: Array<string | undefined>): Redactor {
  const needles = new Set<string>();
  for (const s of secrets) {
    if (!s) continue;
    needles.add(s);
    try {
      const u = new URL(s);
      for (const part of [u.pathname, u.search, u.password, u.username]) if (part.length > 3) needles.add(part);
      if (u.search.length > 1) for (const [, v] of u.searchParams) if (v.length > 3) needles.add(v);
    } catch {
      /* not a URL */
    }
  }
  const ordered = [...needles].sort((a, b) => b.length - a.length);
  return (text) => ordered.reduce((acc, n) => acc.split(n).join("[redacted]"), text);
}

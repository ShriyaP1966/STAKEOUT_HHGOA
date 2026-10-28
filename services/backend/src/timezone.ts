/**
 * IANA time zone handling. Validation is done in code with the platform's own time zone database.
 * Offsets such as "+05:30" are rejected on purpose: they do not follow daylight saving, which is what
 * relative words like "yesterday" need.
 */
const NAME_SHAPE = /^[A-Za-z0-9_/+-]+$/;

/**
 * Returns the platform's canonical name for the zone, or null if it is not an IANA time zone name.
 * Every spelling of one zone gives the same result (for example a wrong-case name, or an alias the database
 * has renamed), so it may differ from what the caller typed.
 */
export function parseTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length === 0 || v.length > 100 || /^[+-]/.test(v) || !NAME_SHAPE.test(v)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: v }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** The local date, time and UTC offset of an instant in a zone, as plain text for the AI prompt. */
export function describeNow(now: Date, timeZone: string): { local: string; offset: string } {
  const local = new Intl.DateTimeFormat("sv-SE", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(now).replace(/\s/g, " ");
  const label = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = label.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  return { local, offset: m ? `${m[1]}${m[2].padStart(2, "0")}:${m[3] ?? "00"}` : "+00:00" };
}

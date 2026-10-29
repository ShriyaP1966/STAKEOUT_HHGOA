export function viewerTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (typeof zone !== "string" || zone.trim() === "") {
    throw new Error("This browser did not report a time zone, so relative times in the complaint cannot be resolved.");
  }
  return zone;
}

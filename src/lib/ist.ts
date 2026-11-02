const IST_TZ = "Asia/Kolkata";
const IST_OFFSET = "+05:30";

/** Today's date (YYYY-MM-DD) in Asia/Kolkata. Between midnight and 5:30 AM IST
 * the UTC date is still yesterday, so never derive "today" from toISOString(). */
export function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** ISO instant of 00:00 IST on the given IST date (e.g. 2026-11-02T00:00:00+05:30). */
export function istDayStart(d: string): string {
  return `${d}T00:00:00${IST_OFFSET}`;
}

/** ISO instant of 23:59:59.999 IST on the given IST date. */
export function istDayEnd(d: string): string {
  return `${d}T23:59:59.999${IST_OFFSET}`;
}

/** Human display of an ISO instant in Asia/Kolkata. */
export function istDisplay(
  dt: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" },
): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleString(undefined, { ...opts, timeZone: IST_TZ });
}

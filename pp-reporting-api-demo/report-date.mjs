export function formatReportDate(value, locale) {
  if (!value) {
    return value;
  }
  const match = /^(\d{4}-\d{2}-\d{2})(?:T.+)?$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) {
    return value;
  }
  // Billing dates are calendar days in UTC, not instants to shift to local time.
  const date = new Date(`${match[1]}T00:00:00Z`);
  if (date.toISOString().slice(0, 10) !== match[1]) {
    return value;
  }
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDateKey(value: string) {
  if (!DATE_RE.test(value)) throw new Error("Invalid date");
  return value;
}

export function addDays(dateKey: string, days: number) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

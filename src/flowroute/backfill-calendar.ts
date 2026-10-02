export function calendarMonthBefore(date: string) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!match) throw new Error("The legacy usage period is invalid");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12)
    throw new Error("The legacy usage period is invalid");
  const end = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(Date.UTC(year, month - 2, 1));
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

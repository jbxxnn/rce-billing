// Product-owner decisions recorded 2026-09-22: clamp short months; 11:00 UTC.
export const BILLING_POLICY_VERSION = "monthly-last-day-1100utc-v1";
function validDate(date: Date) {
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1900 ||
    date.getUTCFullYear() > 9998
  )
    throw new Error("Invalid billing date");
}
/** The next strictly future monthly anchor. Preserve configured day between months. */
export function nextBillingAnchor(now: Date, billingDay: number): Date {
  validDate(now);
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31)
    throw new Error("Billing day must be between 1 and 31");
  for (let offset = 0; offset < 2; offset++) {
    const first = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
    );
    const lastDay = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const anchor = new Date(
      Date.UTC(
        first.getUTCFullYear(),
        first.getUTCMonth(),
        Math.min(billingDay, lastDay),
        11,
      ),
    );
    if (anchor.getTime() > now.getTime()) return anchor;
  }
  throw new Error("Unable to calculate billing anchor");
}
/** Usage is the previous calendar month, never a billing-day-to-billing-day range. */
export function usagePeriodForBillingDate(billingDate: Date) {
  validDate(billingDate);
  const end = new Date(
    Date.UTC(billingDate.getUTCFullYear(), billingDate.getUTCMonth(), 1),
  );
  const start = new Date(
    Date.UTC(billingDate.getUTCFullYear(), billingDate.getUTCMonth() - 1, 1),
  );
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

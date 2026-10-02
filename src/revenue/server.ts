import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { requireAdministrator } from "@/auth/server";
import { withDatabase } from "@/db/client";
import {
  customers,
  flowrouteUsageBackfills,
  stripeInvoiceHistory,
  usageExports,
  usageSnapshots,
} from "@/db/schema";
import { databaseSource } from "@runtime/database";

type Invoice = {
  id: string;
  status: string;
  currency: string;
  totalMinor: bigint;
  amountPaidMinor: bigint;
  amountRemainingMinor: bigint;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  dueAt: Date | null;
  paidAt: Date | null;
  invoiceCreatedAt: Date;
};

function previousCalendarMonth(periodEnd: string) {
  const end = new Date(`${periodEnd}T00:00:00.000Z`);
  if (Number.isNaN(end.getTime())) return null;
  const monthEnd = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1),
  );
  const monthStart = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1),
  );
  return {
    periodStart: monthStart.toISOString().slice(0, 10),
    periodEnd: monthEnd.toISOString().slice(0, 10),
  };
}

export function collectionStatus(invoice: Invoice | undefined, now: Date) {
  if (!invoice) return "NO HISTORY";
  if (invoice.status === "paid") return "PAID";
  if (invoice.status === "uncollectible") return "UNCOLLECTIBLE";
  if (invoice.status === "void") return "VOID";
  if (
    invoice.amountRemainingMinor > 0n &&
    invoice.dueAt !== null &&
    invoice.dueAt < now
  )
    return "OVERDUE";
  if (invoice.amountRemainingMinor > 0n) return "OPEN";
  return invoice.status.toUpperCase();
}

export async function revenueCustomerDetail(customerId: string) {
  await requireAdministrator();
  const now = new Date();
  return withDatabase(databaseSource(), async (db) => {
    const [customer] = await db
      .select({
        id: customers.id,
        name: customers.fullName,
        email: customers.email,
        billingDay: customers.billingDay,
        stripeCustomerId: customers.stripeCustomerId,
      })
      .from(customers)
      .where(eq(customers.id, customerId));
    if (!customer) return null;
    const [invoices, usage] = await Promise.all([
      db
        .select({
          id: stripeInvoiceHistory.id,
          status: stripeInvoiceHistory.status,
          collectionMethod: stripeInvoiceHistory.collectionMethod,
          currency: stripeInvoiceHistory.currency,
          totalMinor: stripeInvoiceHistory.totalMinor,
          amountPaidMinor: stripeInvoiceHistory.amountPaidMinor,
          amountDueMinor: stripeInvoiceHistory.amountDueMinor,
          amountRemainingMinor: stripeInvoiceHistory.amountRemainingMinor,
          billingPeriodStart: stripeInvoiceHistory.billingPeriodStart,
          billingPeriodEnd: stripeInvoiceHistory.billingPeriodEnd,
          dueAt: stripeInvoiceHistory.dueAt,
          paidAt: stripeInvoiceHistory.paidAt,
          invoiceCreatedAt: stripeInvoiceHistory.invoiceCreatedAt,
          syncedAt: stripeInvoiceHistory.syncedAt,
        })
        .from(stripeInvoiceHistory)
        .where(eq(stripeInvoiceHistory.customerId, customerId))
        .orderBy(desc(stripeInvoiceHistory.invoiceCreatedAt)),
      db
        .select({
          id: usageSnapshots.id,
          providerCostExact: usageSnapshots.providerCostExact,
          providerCostMinor: usageSnapshots.providerCostMinor,
          usageQuantity: usageSnapshots.usageQuantity,
          currency: usageSnapshots.currency,
          periodStart: usageSnapshots.periodStart,
          periodEnd: usageSnapshots.periodEnd,
        })
        .from(usageSnapshots)
        .where(eq(usageSnapshots.customerId, customerId))
        .orderBy(desc(usageSnapshots.periodEnd)),
    ]);
    let backfills: {
      legacyUsageSnapshotId: string;
      status: string;
      usageQuantity: string | null;
    }[] = [];
    let backfillAvailable = true;
    try {
      backfills = await db
        .select({
          legacyUsageSnapshotId: flowrouteUsageBackfills.legacyUsageSnapshotId,
          status: usageExports.status,
          usageQuantity: usageSnapshots.usageQuantity,
        })
        .from(flowrouteUsageBackfills)
        .innerJoin(
          usageExports,
          eq(flowrouteUsageBackfills.usageExportId, usageExports.id),
        )
        .leftJoin(
          usageSnapshots,
          eq(usageSnapshots.usageExportId, usageExports.id),
        )
        .where(eq(flowrouteUsageBackfills.customerId, customerId));
    } catch {
      // Keep the ledger readable while a database deployment is catching up.
      backfillAvailable = false;
    }
    const backfillsBySnapshot = new Map(
      backfills.map((backfill) => [
        backfill.legacyUsageSnapshotId,
        {
          status: backfill.status,
          usageQuantity: backfill.usageQuantity,
        },
      ]),
    );
    const totalBilledMinor = invoices.reduce(
      (total, invoice) => total + invoice.totalMinor,
      0n,
    );
    const totalPaidMinor = invoices.reduce(
      (total, invoice) => total + invoice.amountPaidMinor,
      0n,
    );
    const openBalanceMinor = invoices.reduce(
      (total, invoice) =>
        invoice.status === "void"
          ? total
          : total + invoice.amountRemainingMinor,
      0n,
    );
    const overdueBalanceMinor = invoices.reduce((total, invoice) => {
      const overdue =
        invoice.status === "uncollectible" ||
        (invoice.status === "open" &&
          invoice.dueAt !== null &&
          invoice.dueAt < now);
      return overdue ? total + invoice.amountRemainingMinor : total;
    }, 0n);
    const invoicesWithFlowroute = invoices.map((invoice) => {
      const direct = usage.find(
        (snapshot) =>
          snapshot.periodStart === invoice.billingPeriodStart &&
          snapshot.periodEnd === invoice.billingPeriodEnd,
      );
      const calendarPeriod = invoice.billingPeriodEnd
        ? previousCalendarMonth(invoice.billingPeriodEnd)
        : null;
      const calendar = calendarPeriod
        ? usage.find(
            (snapshot) =>
              snapshot.periodStart === calendarPeriod.periodStart &&
              snapshot.periodEnd === calendarPeriod.periodEnd,
          )
        : undefined;
      return {
        ...invoice,
        flowroute: direct ?? calendar ?? null,
      };
    });
    return {
      customer,
      invoices: invoicesWithFlowroute.map((invoice) => ({
        ...invoice,
        collectionStatus: collectionStatus(invoice, now),
      })),
      usage: usage.map((snapshot) => ({
        ...snapshot,
        backfill: backfillsBySnapshot.get(snapshot.id) ?? null,
      })),
      backfillAvailable,
      totals: {
        billedMinor: totalBilledMinor,
        paidMinor: totalPaidMinor,
        openBalanceMinor,
        overdueBalanceMinor,
      },
    };
  });
}

export async function revenueOverview() {
  await requireAdministrator();
  const now = new Date();
  const last30Days = new Date(now);
  last30Days.setDate(last30Days.getDate() - 30);
  return withDatabase(databaseSource(), async (db) => {
    const [customerRows, invoiceRows, usageRows] = await Promise.all([
      db
        .select({
          id: customers.id,
          name: customers.fullName,
          email: customers.email,
        })
        .from(customers)
        .orderBy(asc(customers.fullName)),
      db
        .select({
          customerId: stripeInvoiceHistory.customerId,
          id: stripeInvoiceHistory.id,
          status: stripeInvoiceHistory.status,
          currency: stripeInvoiceHistory.currency,
          totalMinor: stripeInvoiceHistory.totalMinor,
          amountPaidMinor: stripeInvoiceHistory.amountPaidMinor,
          amountRemainingMinor: stripeInvoiceHistory.amountRemainingMinor,
          billingPeriodStart: stripeInvoiceHistory.billingPeriodStart,
          billingPeriodEnd: stripeInvoiceHistory.billingPeriodEnd,
          dueAt: stripeInvoiceHistory.dueAt,
          paidAt: stripeInvoiceHistory.paidAt,
          invoiceCreatedAt: stripeInvoiceHistory.invoiceCreatedAt,
          syncedAt: stripeInvoiceHistory.syncedAt,
        })
        .from(stripeInvoiceHistory)
        .orderBy(desc(stripeInvoiceHistory.invoiceCreatedAt)),
      db
        .select({
          customerId: usageSnapshots.customerId,
          providerCostExact: usageSnapshots.providerCostExact,
          periodStart: usageSnapshots.periodStart,
          periodEnd: usageSnapshots.periodEnd,
        })
        .from(usageSnapshots)
        .orderBy(desc(usageSnapshots.periodEnd)),
    ]);

    const invoicesByCustomer = new Map<string, Invoice[]>();
    let billedLast30Days = 0n;
    let paidLast30Days = 0n;
    let outstandingMinor = 0n;
    let overdueMinor = 0n;
    let latestSyncedAt: Date | null = null;
    for (const invoice of invoiceRows) {
      const list = invoicesByCustomer.get(invoice.customerId) ?? [];
      list.push(invoice);
      invoicesByCustomer.set(invoice.customerId, list);
      if (invoice.invoiceCreatedAt >= last30Days)
        billedLast30Days += invoice.totalMinor;
      if (invoice.paidAt && invoice.paidAt >= last30Days)
        paidLast30Days += invoice.amountPaidMinor;
      if (invoice.amountRemainingMinor > 0n && invoice.status !== "void") {
        outstandingMinor += invoice.amountRemainingMinor;
        if (
          invoice.status === "uncollectible" ||
          (invoice.status === "open" && invoice.dueAt && invoice.dueAt < now)
        )
          overdueMinor += invoice.amountRemainingMinor;
      }
      if (!latestSyncedAt || invoice.syncedAt > latestSyncedAt)
        latestSyncedAt = invoice.syncedAt;
    }

    const usageByCustomer = new Map<
      string,
      {
        providerCostExact: string | null;
        periodStart: string;
        periodEnd: string;
      }[]
    >();
    for (const usage of usageRows) {
      const list = usageByCustomer.get(usage.customerId) ?? [];
      if (list.length < 2) list.push(usage);
      usageByCustomer.set(usage.customerId, list);
    }

    const customersWithRevenue = customerRows.map((customer) => {
      const invoices = invoicesByCustomer.get(customer.id) ?? [];
      const latest = invoices[0];
      const previous = invoices[1];
      const usage = usageByCustomer.get(customer.id) ?? [];
      return {
        ...customer,
        latestInvoice: latest ?? null,
        previousInvoice: previous ?? null,
        invoiceChangeMinor:
          latest && previous ? latest.totalMinor - previous.totalMinor : null,
        collectionStatus: collectionStatus(latest, now),
        latestUsage: usage[0] ?? null,
        previousUsage: usage[1] ?? null,
      };
    });

    return {
      billedLast30Days,
      paidLast30Days,
      outstandingMinor,
      overdueMinor,
      invoiceCount: invoiceRows.length,
      latestSyncedAt,
      customers: customersWithRevenue,
    };
  });
}

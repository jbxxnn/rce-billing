import Link from "next/link";
import {
  BellRing,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { requireAdministrator } from "@/auth/server";
import { stripeMode } from "@/stripe/server";

export default async function SettingsPage() {
  const administrator = await requireAdministrator();
  const mode = stripeMode();
  return (
    <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
      <div>
        <p className="text-xs font-semibold tracking-widest text-muted-foreground">
          WORKSPACE SETTINGS
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Review your access and the billing workspace configuration.
        </p>
      </div>

      <section
        id="account"
        className="scroll-mt-6 rounded-lg border border-input bg-card p-6"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UserRound className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Account</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Your identity is managed through Google Workspace.
            </p>
          </div>
        </div>
        <dl className="mt-5 divide-y divide-border rounded-md border border-input px-4">
          <div className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-5">
            <dt className="text-muted-foreground">Signed in as</dt>
            <dd className="font-medium text-foreground">
              {administrator.email}
            </dd>
          </div>
          <div className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-5">
            <dt className="text-muted-foreground">Workspace role</dt>
            <dd className="font-medium text-foreground">
              Billing administrator
            </dd>
          </div>
        </dl>
      </section>

      <section
        id="billing"
        className="scroll-mt-6 rounded-lg border border-input bg-card p-6"
      >
        <div className="flex items-start justify-between gap-5">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CreditCard className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Billing</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Flowroute usage is collected before a billing run is
                synchronized with Stripe.
              </p>
            </div>
          </div>
          <Link
            className="inline-flex shrink-0 items-center gap-2 text-sm font-medium text-primary hover:underline"
            href="/operations"
          >
            Billing runs <ExternalLink className="size-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="mt-5 flex items-center gap-3 rounded-md border border-input bg-muted/30 px-4 py-3 text-sm">
          <CheckCircle2
            className="size-5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <p>
            <span className="font-medium text-foreground">
              Stripe environment:
            </span>{" "}
            {mode === "live"
              ? "Live billing is configured."
              : mode === "test"
                ? "Stripe sandbox is configured."
                : "Stripe is not configured."}
          </p>
        </div>
      </section>

      <section
        id="notifications"
        className="scroll-mt-6 rounded-lg border border-input bg-card p-6"
      >
        <div className="flex items-start justify-between gap-5">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <BellRing className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Notifications</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                The workspace records billing and provider issues in Billing
                runs for administrator review.
              </p>
            </div>
          </div>
          <Link
            className="inline-flex shrink-0 items-center gap-2 text-sm font-medium text-primary hover:underline"
            href="/operations"
          >
            View alerts <ExternalLink className="size-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="mt-5 flex items-start gap-3 rounded-md border border-input bg-muted/30 px-4 py-3 text-sm leading-6 text-muted-foreground">
          <ShieldCheck
            className="mt-0.5 size-5 shrink-0 text-primary"
            aria-hidden="true"
          />
          Email or text-message alerts are not configured yet. Current
          operational alerts stay visible in the billing workspace.
        </div>
      </section>
    </main>
  );
}

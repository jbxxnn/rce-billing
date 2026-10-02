import {
  ArrowRight,
  BadgeCheck,
  CircleDollarSign,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import { googleAuthConfigured } from "@/config/google-auth";

export const dynamic = "force-dynamic";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const googleConfigured = googleAuthConfigured({
    APP_ORIGIN: process.env.APP_ORIGIN,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  });

  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.8fr)]">
      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:p-10 lg:px-16">
        <div className="w-full max-w-md">
          <div className="mb-12 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <CircleDollarSign className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-base font-semibold tracking-tight text-foreground">
                RCE Billing
              </p>
              <p className="text-xs text-muted-foreground">Operations workspace</p>
            </div>
          </div>

          <p className="text-xs font-semibold tracking-[0.16em] text-primary">
            ADMINISTRATOR ACCESS
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Welcome back.
          </h1>
          <p className="mt-4 max-w-sm text-base leading-7 text-muted-foreground">
            Manage customers, billing, and provider usage from one secure place.
          </p>

          <section
            className="mt-9 rounded-xl border border-input bg-card p-5 shadow-sm"
            aria-label="Administrator sign-in"
          >
            {error && (
              <div
                role="alert"
                className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive"
              >
                <p className="font-semibold">Sign-in was not completed</p>
                <p>
                  {error === "unauthorized"
                    ? "This Google account is not an authorized RCE Billing administrator."
                    : "We could not complete your Google sign-in. Please try again."}
                </p>
              </div>
            )}
            <div className="flex items-start gap-3 rounded-lg bg-muted/60 p-4">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <LockKeyhole className="size-4" aria-hidden="true" />
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Use your authorized <span className="font-medium text-foreground">re-circuit.com</span> Google Workspace account.
              </p>
            </div>

            {googleConfigured ? (
              <a
                className="mt-5 inline-flex h-11 w-full items-center justify-center gap-3 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                href="/api/auth/google"
              >
                <span className="flex size-5 items-center justify-center rounded-full bg-white font-semibold text-[11px] text-[#4285F4]" aria-hidden="true">G</span>
                Continue with Google
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            ) : (
              <p className="mt-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive">
                Google Workspace sign-in has not been configured yet.
              </p>
            )}
          </section>

          <p className="mt-5 flex items-center gap-2 text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
            Access is limited to active billing administrators.
          </p>
        </div>
      </section>

      <aside className="relative hidden overflow-hidden bg-secondary px-12 py-14 text-secondary-foreground lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -right-28 top-20 size-96 rounded-full border border-white/15" />
        <div className="pointer-events-none absolute -bottom-44 -left-24 size-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative flex h-full max-w-md flex-col">
          <div className="flex items-center gap-2 text-sm font-medium text-secondary-foreground/80">
            <span className="size-2 rounded-full bg-primary" />
            RCE LLC · Billing administration
          </div>
          <div className="my-auto">
            <p className="text-sm font-medium text-primary">One operating picture</p>
            <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-tight">
              The information you need to bill with confidence.
            </h2>
            <p className="mt-5 max-w-sm text-base leading-7 text-secondary-foreground/70">
              Keep customer records, Flowroute usage, Stripe activity, and billing reviews connected.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <ReceiptText className="size-5 text-primary" aria-hidden="true" />
              <p className="mt-5 text-sm font-semibold">Billing review</p>
              <p className="mt-1 text-sm leading-5 text-secondary-foreground/65">Review usage before Stripe invoices are finalized.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <BadgeCheck className="size-5 text-primary" aria-hidden="true" />
              <p className="mt-5 text-sm font-semibold">Controlled access</p>
              <p className="mt-1 text-sm leading-5 text-secondary-foreground/65">Google Workspace authentication keeps the workspace private.</p>
            </div>
          </div>
        </div>
      </aside>
    </main>
  );
}

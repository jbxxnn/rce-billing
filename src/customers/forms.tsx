"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { CustomerProfile } from "./validation";

const fieldClass = "space-y-2";
const labelClass = "text-sm font-medium text-foreground";
const inputClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";
const errorClass = "text-sm text-destructive";
type SubmissionResult = { id: string; revision?: number };

function useSubmission(
  endpoint: string,
  clearSecrets = false,
  onSuccess?: (result: SubmissionResult) => void,
) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setErrors({});
    const form = event.currentTarget;
    try {
      const body = new URLSearchParams();
      for (const [key, value] of new FormData(form))
        if (typeof value === "string") body.set(key, value);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      const result = await response.json();
      if (!response.ok || result.error) {
        setError(result.error ?? "Unable to save changes");
        setErrors(result.fields ?? {});
        return;
      }
      if (clearSecrets) form.reset();
      if (onSuccess) {
        onSuccess(result);
      } else {
        router.push(`/customers/${result.id}?saved=1`);
        router.refresh();
      }
    } catch {
      setError("Unable to save changes. Please try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return { submit, pending, error, errors };
}
export function CustomerForm({
  customer,
}: {
  customer?: CustomerProfile & { id: string; revision: number };
}) {
  const [createdCustomer, setCreatedCustomer] =
    useState<SubmissionResult | null>(null);
  const state = useSubmission(
    customer ? `/api/customers/${customer.id}/update` : "/api/customers",
    false,
    customer ? undefined : setCreatedCustomer,
  );
  const input = (
    name: keyof CustomerProfile,
    label: string,
    type = "text",
    required = false,
    maxLength = 160,
  ) => (
    <div className={fieldClass}>
      <label className={labelClass} htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        maxLength={type === "number" ? undefined : maxLength}
        min={type === "number" ? 1 : undefined}
        max={type === "number" ? 31 : undefined}
        defaultValue={
          customer?.[name] ??
          (name === "billingDay"
            ? 1
            : name === "billingTimezone"
              ? "UTC"
              : name === "countryCode"
                ? "US"
                : "")
        }
        aria-invalid={Boolean(state.errors[name])}
        aria-describedby={state.errors[name] ? `${name}-error` : undefined}
        className={inputClass}
      />
      {state.errors[name] && (
        <p id={`${name}-error`} className={errorClass}>
          {state.errors[name].join(". ")}
        </p>
      )}
    </div>
  );
  if (createdCustomer) {
    return (
      <CustomerSetup
        customerId={createdCustomer.id}
        revision={createdCustomer.revision ?? 1}
      />
    );
  }

  return (
    <form onSubmit={state.submit} className="mt-8 space-y-6">
      {customer && (
        <input type="hidden" name="revision" value={customer.revision} />
      )}
      <section className="rounded-lg border border-input p-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Customer details
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            The name and email used for billing records and Stripe.
          </p>
        </div>
        <div className="mt-5 grid gap-x-5 gap-y-5 md:grid-cols-2">
          {input("fullName", "Full name", "text", true)}
          {input("email", "Email address", "email", true, 254)}
          {input("phone", "Phone", "tel", false, 40)}
          {input("countryCode", "Country code", "text", true, 2)}
        </div>
      </section>

      <section className="rounded-lg border border-input p-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Billing address
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Optional now. Add it when it is needed for invoices.
          </p>
        </div>
        <div className="mt-5 grid gap-x-5 gap-y-5 md:grid-cols-2">
          {input("streetAddress", "Street address", "text", false, 250)}
          {input("city", "City", "text", false, 100)}
          {input("state", "State / region", "text", false, 100)}
          {input("postalCode", "Postal code", "text", false, 20)}
        </div>
      </section>

      <section className="rounded-lg border border-input p-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Billing schedule
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Usage is always collected for the previous full calendar month.
          </p>
        </div>
        <div className="mt-5 grid gap-x-5 gap-y-5 md:grid-cols-2">
          {input("billingDay", "Monthly billing day", "number", true)}
          {input("billingTimezone", "Billing timezone", "text", true, 100)}
        </div>
      </section>
      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {state.error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-3 border-t border-input pt-6 sm:flex-row sm:items-center sm:justify-between">
        {customer ? (
          <span className="text-sm text-muted-foreground">
            Changes apply to this customer record only.
          </span>
        ) : (
          <Link
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
            href="/customers"
          >
            Cancel
          </Link>
        )}
        <Button disabled={state.pending}>
          {state.pending
            ? "Saving…"
            : customer
              ? "Save changes"
              : "Create customer"}
        </Button>
      </div>
    </form>
  );
}
export function CredentialsForm({
  id,
  revision,
  hasStoredCredentials = false,
  onSaved,
}: {
  id: string;
  revision: number;
  hasStoredCredentials?: boolean;
  onSaved?: () => void;
}) {
  const state = useSubmission(
    `/api/customers/${id}/credentials`,
    true,
    onSaved,
  );
  return (
    <form onSubmit={state.submit} autoComplete="off">
      <input type="hidden" name="revision" value={revision} />
      <div className="grid gap-x-5 gap-y-5 md:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="accessKey">
            New Flowroute access key
          </label>
          <input
            id="accessKey"
            name="accessKey"
            type="password"
            autoComplete="new-password"
            maxLength={512}
            required
            className={inputClass}
            placeholder={hasStoredCredentials ? "************" : undefined}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="secretKey">
            New Flowroute secret key
          </label>
          <input
            id="secretKey"
            name="secretKey"
            type="password"
            autoComplete="new-password"
            maxLength={2048}
            required
            className={inputClass}
            placeholder={hasStoredCredentials ? "************" : undefined}
          />
        </div>
      </div>
      <p className="mt-5 text-sm leading-6 text-muted-foreground">
        Both keys are replaced together. Existing keys cannot be displayed.
        Connection verification will be available when the Flowroute integration
        is ready.
      </p>
      {hasStoredCredentials && (
        <p className="mt-3 text-sm font-medium text-primary">
          An encrypted key pair is saved. Enter both values only to replace it.
        </p>
      )}
      {state.error && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}
      <Button disabled={state.pending}>
        {state.pending ? "Saving…" : "Save replacement keys"}
      </Button>
    </form>
  );
}

export function BillingAdjustmentsForm({
  id,
  revision,
  values,
}: {
  id: string;
  revision: number;
  values: {
    meteredSipTrunkUsage: string;
    cloudServerHosting: string;
    extraNumbers: string;
    extraChannels: string;
  };
}) {
  const state = useSubmission(`/api/customers/${id}/billing-adjustments`);
  const effectiveFrom = new Date().toISOString().slice(0, 10);
  const field = (
    name:
      | "meteredSipTrunkUsage"
      | "cloudServerHosting"
      | "extraNumbers"
      | "extraChannels",
    label: string,
    hint: string,
  ) => (
    <div className={fieldClass}>
      <label className={labelClass} htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="number"
        min="0"
        step={
          name === "extraNumbers" || name === "extraChannels" ? "1" : "0.01"
        }
        defaultValue={values[name]}
        className={inputClass}
        aria-invalid={Boolean(state.errors[name])}
        aria-describedby={`${name}-hint${state.errors[name] ? ` ${name}-error` : ""}`}
      />
      <p
        id={`${name}-hint`}
        className="text-xs leading-5 text-muted-foreground"
      >
        {hint}
      </p>
      {state.errors[name] && (
        <p id={`${name}-error`} className={errorClass}>
          {state.errors[name].join(". ")}
        </p>
      )}
    </div>
  );
  return (
    <form onSubmit={state.submit} className="mt-5">
      <input type="hidden" name="revision" value={revision} />
      <div className="grid gap-5 md:grid-cols-2">
        <div className={fieldClass}>
          <label className={labelClass} htmlFor="effectiveFrom">
            Apply from
          </label>
          <input
            id="effectiveFrom"
            name="effectiveFrom"
            type="date"
            defaultValue={effectiveFrom}
            required
            className={inputClass}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            Changes apply to billing periods beginning on or after this date.
          </p>
        </div>
        {field(
          "extraNumbers",
          "Extra phone numbers",
          "A monthly quantity above the plan’s included phone numbers.",
        )}
        {field(
          "extraChannels",
          "Extra channels",
          "The customer’s monthly unmetered channel quantity. Leave blank to use the plan’s legacy channel quantity.",
        )}
        <div className="md:col-span-2 grid gap-5 md:grid-cols-2">
          {field(
            "meteredSipTrunkUsage",
            "Metered SIP trunk usage (USD)",
            "Used only with an Other/custom plan. It is added to that plan’s monthly Flowroute charge; the plan type named Metered uses a different formula.",
          )}
          {field(
            "cloudServerHosting",
            "Cloud server hosting (USD)",
            "Used only with an Other/custom plan and added as a separate recurring hosting charge.",
          )}
        </div>
      </div>
      <p className="mt-5 text-sm leading-6 text-muted-foreground">
        Saving replaces the customer’s current recurring adjustments and
        preserves the previous adjustment history.
      </p>
      {state.error && (
        <p role="alert" className={`mt-4 ${errorClass}`}>
          {state.error}
        </p>
      )}
      <Button className="mt-5" disabled={state.pending}>
        {state.pending ? "Saving…" : "Save billing adjustments"}
      </Button>
    </form>
  );
}

function CustomerSetup({
  customerId,
  revision,
}: {
  customerId: string;
  revision: number;
}) {
  const [credentialsSaved, setCredentialsSaved] = useState(false);
  const subscriptionUrl = `/subscriptions/new?customerId=${customerId}`;

  if (credentialsSaved) {
    return (
      <div className="mt-8 space-y-6">
        <div className="rounded-lg border border-primary/20 bg-primary/10 p-5">
          <div className="flex gap-3">
            <CircleCheck
              className="mt-0.5 size-5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-semibold text-foreground">
                Flowroute credentials saved
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                They are encrypted and ready for usage exports when the
                integration runs.
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-input p-5">
          <h2 className="text-base font-semibold text-foreground">
            Next: choose a plan
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Create a subscription draft, review it, then activate it in Stripe
            when you are ready.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Link
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
              href={`/customers/${customerId}`}
            >
              View customer overview
            </Link>
            <Link
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              href={subscriptionUrl}
            >
              Create subscription draft{" "}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="rounded-lg border border-primary/20 bg-primary/10 p-5">
        <div className="flex gap-3">
          <CircleCheck
            className="mt-0.5 size-5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div>
            <h2 className="font-semibold text-foreground">
              Customer profile created
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Add the Flowroute credentials now so this customer is ready for
              usage-based billing.
            </p>
          </div>
        </div>
      </div>
      <section className="rounded-lg border border-input p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Add Flowroute credentials
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Both keys are encrypted before they are saved. You can replace
              them later from the customer page.
            </p>
          </div>
        </div>
        <div className="mt-6">
          <CredentialsForm
            id={customerId}
            revision={revision}
            onSaved={() => setCredentialsSaved(true)}
          />
        </div>
      </section>
      <div className="flex justify-end">
        <Link
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
          href={subscriptionUrl}
        >
          Skip credentials for now
        </Link>
      </div>
    </div>
  );
}
export function CustomerControl({
  id,
  revision,
  operation,
  label,
  confirmation,
}: {
  id: string;
  revision: number;
  operation: string;
  label: string;
  confirmation: string;
}) {
  const state = useSubmission(`/api/customers/${id}/${operation}`);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form onSubmit={state.submit} className="mt-4">
      <input type="hidden" name="revision" value={revision} />
      <label className="flex items-start gap-2 text-sm leading-6 text-foreground">
        <input
          type="checkbox"
          required
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-1 size-4 rounded border-input accent-primary"
        />
        {confirmation}
      </label>
      {state.error && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}
      <Button variant="outline" disabled={!confirmed || state.pending}>
        {state.pending ? "Saving…" : label}
      </Button>
    </form>
  );
}

"use client";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { PlanInput } from "./validation";

const fieldClass = "space-y-2";
const labelClass = "text-sm font-medium text-foreground";
const inputClass = "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";
const selectClass = `${inputClass} pr-8`;
export function MutationForm({
  endpoint,
  destination,
  children,
  label,
  successPath,
}: {
  endpoint: string;
  destination: string;
  children: ReactNode;
  label: string;
  successPath?: string;
}) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const body = new URLSearchParams();
      for (const [k, v] of new FormData(event.currentTarget))
        if (typeof v === "string") body.set(k, v);
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
      if (!response.ok) {
        router.refresh();
        setError(
          [
            result.error,
            ...Object.entries(result.fields ?? {}).map(
              ([key, value]) => `${key}: ${String(value)}`,
            ),
          ].join(". "),
        );
        return;
      }
      router.push(successPath ?? `/${destination}/${result.id}?saved=1`);
      router.refresh();
    } catch {
      setError("Unable to save. Please try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit}>
      {children}
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button className="mt-5" disabled={pending}>{pending ? "Saving…" : label}</Button>
    </form>
  );
}
export function PlanForm({
  plan,
}: {
  plan?: PlanInput & { id: string; revision: number };
}) {
  const [planType, setPlanType] = useState(plan?.planType ?? "FIXED");
  const value = (name: keyof PlanInput, fallback = "0") =>
    String(plan?.[name] ?? fallback);
  const field = (
    name: keyof PlanInput,
    label: string,
    options: { type?: string; required?: boolean } = {},
  ) => (
    <div className={fieldClass}>
      <label className={labelClass} htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type={options.type ?? "text"}
        required={options.required}
        defaultValue={value(
          name,
          name === "name" || name === "description" ? "" : "0",
        )}
        maxLength={name === "description" ? 2000 : name === "name" ? 160 : 32}
        className={inputClass}
      />
    </div>
  );
  const hidden = (name: keyof PlanInput) => (
    <input key={name} type="hidden" name={name} value={value(name)} />
  );
  return (
    <MutationForm
      endpoint={plan ? `/api/plans/${plan.id}/update` : "/api/plans"}
      destination="plans"
      label={plan ? "Save new price version" : "Create plan"}
    >
      {plan && <input type="hidden" name="revision" value={plan.revision} />}
      <div className="grid gap-5 md:grid-cols-2">
        {field("name", "Plan name", { required: true })}
        {field("baseAmount", "Monthly base amount (USD)", {
          type: "number",
          required: true,
        })}
        <div className="md:col-span-2">
          {field("description", "Description")}
        </div>
        <div className={fieldClass}>
          <label className={labelClass} htmlFor="planType">Plan type</label>
          <select
            id="planType"
            name="planType"
            value={planType}
            onChange={(event) => setPlanType(event.target.value as PlanInput["planType"])}
            className={selectClass}
          >
            {[
              ["FIXED", "Fixed monthly"],
              ["METERED", "Metered"],
              ["UNMETERED", "Unmetered"],
              ["OTHER", "Other / custom"],
            ].map(([type, label]) => (
              <option key={type} value={type}>{label}</option>
            ))}
          </select>
        </div>
      </div>
      {planType === "METERED" && (
        <section className="mt-6 rounded-lg border border-input bg-muted/30 p-5">
          <h2 className="text-lg font-semibold tracking-tight">Metered plan settings</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Configure included minutes and additional phone-number pricing.</p>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            {field("includedMinutes", "Included minutes", { type: "number", required: true })}
            {field("additionalMinuteAmount", "Additional minute amount (USD)", { type: "number", required: true })}
            {field("includedNumbers", "Included phone numbers", { type: "number", required: true })}
            {field("numberAmount", "Additional phone amount (USD)", { type: "number", required: true })}
          </div>
        </section>
      )}
      {planType === "UNMETERED" && (
        <section className="mt-6 rounded-lg border border-input bg-muted/30 p-5">
          <h2 className="text-lg font-semibold tracking-tight">Unmetered plan settings</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Configure included channels and additional phone-number pricing.</p>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            {field("includedChannels", "Included channels", { type: "number", required: true })}
            {field("channelAmount", "Additional channel amount (USD)", { type: "number", required: true })}
            {field("includedNumbers", "Included phone numbers", { type: "number", required: true })}
            {field("numberAmount", "Additional phone amount (USD)", { type: "number", required: true })}
          </div>
        </section>
      )}
      {(planType === "FIXED" || planType === "OTHER") && (
        <p className="mt-5 text-sm leading-6 text-muted-foreground">This plan uses its monthly base amount. Customer-specific adjustments are added during billing when applicable.</p>
      )}
      {planType !== "METERED" && hidden("includedMinutes")}
      {planType !== "METERED" && hidden("additionalMinuteAmount")}
      {planType !== "METERED" && planType !== "UNMETERED" && hidden("includedNumbers")}
      {planType !== "METERED" && planType !== "UNMETERED" && hidden("numberAmount")}
      {planType !== "UNMETERED" && hidden("includedChannels")}
      {planType !== "UNMETERED" && hidden("channelAmount")}
      <p className="mt-5 text-sm leading-6 text-muted-foreground">
        Saving creates a price version. Existing subscriptions keep their
        assigned version.
      </p>
    </MutationForm>
  );
}
export function PlanAvailability({
  id,
  revision,
  active,
}: {
  id: string;
  revision: number;
  active: boolean;
}) {
  return (
    <MutationForm
      endpoint={`/api/plans/${id}/availability`}
      destination="plans"
      label={active ? "Deactivate plan" : "Activate plan"}
    >
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="active" value={String(!active)} />
      <p>
        {active
          ? "Deactivation removes this plan from new subscription choices. Existing subscriptions remain unchanged."
          : "Activation makes the current price available for new drafts."}
      </p>
    </MutationForm>
  );
}
export type PriceOption = {
  priceVersionId: string | null;
  name: string;
  version: number | null;
};
export function DraftForm({
  customerId,
  creationKey,
  options,
  draft,
}: {
  customerId: string;
  creationKey?: string;
  options: PriceOption[];
  draft?: {
    id: string;
    revision: number;
    priceVersionId: string;
    collectionMethod: string | null;
  };
}) {
  const selectedPrice = options.find(
    (option) => option.priceVersionId === draft?.priceVersionId,
  );
  return (
    <MutationForm
      endpoint={
        draft ? `/api/subscriptions/${draft.id}/update` : "/api/subscriptions"
      }
      destination="subscriptions"
      label={draft ? "Save draft" : "Create draft"}
    >
      {draft ? (
        <input type="hidden" name="revision" value={draft.revision} />
      ) : (
        <>
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="creationKey" value={creationKey} />
        </>
      )}
      <div className="mt-6 space-y-5">
        <section className="rounded-lg border border-input p-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">Choose a plan</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">A price version is saved with the draft, so future plan changes cannot alter this subscription.</p>
          </div>
          <label className={`${labelClass} mt-5 block`} htmlFor="planPriceVersionId">Available plan</label>
          <select
            id="planPriceVersionId"
            name="planPriceVersionId"
            required
            defaultValue={
              options.some((p) => p.priceVersionId === draft?.priceVersionId)
                ? draft?.priceVersionId
                : ""
            }
            className={`${selectClass} mt-2`}
          >
            <option value="">Select a plan</option>
            {options
              .filter((p) => p.priceVersionId)
              .map((p) => (
                <option key={p.priceVersionId} value={p.priceVersionId!}>
                  {p.name} · version {p.version}
                </option>
              ))}
          </select>
          {selectedPrice && <p className="mt-3 text-sm text-muted-foreground">Current selection: {selectedPrice.name} · version {selectedPrice.version}</p>}
        </section>

        <section className="rounded-lg border border-input p-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">Choose how to collect payment</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">This can be reviewed before anything is created in Stripe.</p>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="cursor-pointer rounded-md border border-input p-4 transition-colors has-checked:border-primary has-checked:bg-primary/5">
              <input className="sr-only" type="radio" name="collectionMethod" value="send_invoice" required defaultChecked={draft?.collectionMethod === "send_invoice"} />
              <span className="block text-sm font-semibold text-foreground">Send an invoice</span>
              <span className="mt-1 block text-sm leading-5 text-muted-foreground">Stripe emails an invoice and tracks payment by its due date.</span>
            </label>
            <label className="cursor-pointer rounded-md border border-input p-4 transition-colors has-checked:border-primary has-checked:bg-primary/5">
              <input className="sr-only" type="radio" name="collectionMethod" value="charge_automatically" required defaultChecked={draft?.collectionMethod === "charge_automatically"} />
              <span className="block text-sm font-semibold text-foreground">Charge automatically</span>
              <span className="mt-1 block text-sm leading-5 text-muted-foreground">Stripe attempts payment automatically for each billing period.</span>
            </label>
          </div>
        </section>
      </div>
      <p className="mt-5 text-sm leading-6 text-muted-foreground">Saving creates a draft only. You will explicitly activate it in the configured Stripe environment from the next screen.</p>
    </MutationForm>
  );
}
export function DiscardDraft({
  id,
  revision,
}: {
  id: string;
  revision: number;
}) {
  return (
    <MutationForm
      endpoint={`/api/subscriptions/${id}/discard`}
      destination="subscriptions"
      label="Discard draft"
    >
      <input type="hidden" name="revision" value={revision} />
      <label className="flex items-start gap-2 text-sm leading-6 text-foreground">
        <input className="mt-1 size-4 rounded border-input accent-primary" type="checkbox" required />
        Discard this unactivated draft and retain its history.
      </label>
    </MutationForm>
  );
}

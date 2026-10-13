"use client";
import { MutationForm, type PriceOption } from "../plans/forms";

const labelClass = "text-sm font-medium text-foreground";
const controlClass =
  "mt-2 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";
const confirmationClass =
  "mt-5 flex items-start gap-2 text-sm leading-6 text-foreground";
function Identity({
  revision,
  requestKey,
}: {
  revision: number;
  requestKey: string;
}) {
  return (
    <>
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="requestKey" value={requestKey} />
    </>
  );
}
export function ActivateStripe({
  id,
  revision,
  requestKey,
  sendInvoice,
  mode,
}: {
  id: string;
  revision: number;
  requestKey: string;
  sendInvoice: boolean;
  mode: "test" | "live";
}) {
  return (
    <MutationForm
      endpoint={`/api/subscriptions/${id}/activate`}
      destination="subscriptions"
      label={`Activate in Stripe ${mode} mode`}
    >
      <Identity revision={revision} requestKey={requestKey} />
      {sendInvoice && (
        <>
          <label className={labelClass} htmlFor="daysUntilDue">
            Days until emailed invoices are due
          </label>
          <input
            id="daysUntilDue"
            name="daysUntilDue"
            type="number"
            min={1}
            max={365}
            required
            className={controlClass}
          />
        </>
      )}
      <p className="mt-5 text-sm leading-6 text-muted-foreground">
        Stripe will calculate the first partial month using its standard
        proration behavior.
      </p>
      <label className={confirmationClass}>
        <input
          className="mt-1 size-4 rounded border-input accent-primary"
          type="checkbox"
          required
        />
        Create this {mode === "live" ? "live" : "test"} subscription in Stripe.
      </label>
    </MutationForm>
  );
}
export function ChangeStripePlan({
  id,
  revision,
  requestKey,
  options,
}: {
  id: string;
  revision: number;
  requestKey: string;
  options: PriceOption[];
}) {
  return (
    <MutationForm
      endpoint={`/api/subscriptions/${id}/change-plan`}
      destination="subscriptions"
      label="Apply prorated test plan change"
    >
      <Identity revision={revision} requestKey={requestKey} />
      <label className={labelClass} htmlFor="stripePrice">
        New plan price
      </label>
      <select
        id="stripePrice"
        name="planPriceVersionId"
        required
        defaultValue=""
        className={controlClass}
      >
        <option value="">Select a different price</option>
        {options
          .filter((p) => p.priceVersionId)
          .map((p) => (
            <option key={p.priceVersionId} value={p.priceVersionId!}>
              {p.name} · v{p.version}
            </option>
          ))}
      </select>
      <label className={confirmationClass}>
        <input
          className="mt-1 size-4 rounded border-input accent-primary"
          type="checkbox"
          required
        />
        Apply this plan now with Stripe proration.
      </label>
    </MutationForm>
  );
}
export function ChangeToAutomaticCollection({
  id,
  revision,
  requestKey,
}: {
  id: string;
  revision: number;
  requestKey: string;
}) {
  return (
    <MutationForm
      endpoint={`/api/subscriptions/${id}/change-collection-method`}
      destination="subscriptions"
      label="Use automatic charging"
    >
      <Identity revision={revision} requestKey={requestKey} />
      <input
        type="hidden"
        name="collectionMethod"
        value="charge_automatically"
      />
      <label className={confirmationClass}>
        <input
          className="mt-1 size-4 rounded border-input accent-primary"
          type="checkbox"
          required
        />
        Use the customer&apos;s saved Stripe payment method for future invoices.
      </label>
    </MutationForm>
  );
}
export function CancelStripe({
  id,
  revision,
  requestKey,
}: {
  id: string;
  revision: number;
  requestKey: string;
}) {
  return (
    <MutationForm
      endpoint={`/api/subscriptions/${id}/cancel-at-period-end`}
      destination="subscriptions"
      label="Schedule test cancellation"
    >
      <Identity revision={revision} requestKey={requestKey} />
      <label className={confirmationClass}>
        <input
          className="mt-1 size-4 rounded border-input accent-primary"
          type="checkbox"
          required
        />
        End the subscription at its current period end. Service remains active
        until then.
      </label>
    </MutationForm>
  );
}
export function RetryStripe({
  id,
  workflowId,
}: {
  id: string;
  workflowId: string;
}) {
  return (
    <MutationForm
      endpoint={`/api/subscriptions/${id}/retry-stripe`}
      destination="subscriptions"
      label="Retry saved Stripe operation"
    >
      <input type="hidden" name="workflowId" value={workflowId} />
      <p className="mt-5 text-sm leading-6 text-muted-foreground">
        A retry uses the saved request to avoid creating duplicate provider
        objects.
      </p>
    </MutationForm>
  );
}
export function DeleteUnstartedDraft({
  id,
  workflowId,
}: {
  id: string;
  workflowId: string;
}) {
  return (
    <MutationForm
      endpoint={`/api/subscriptions/${id}/delete-unstarted-draft`}
      destination="subscriptions"
      successPath="/subscriptions?deleted=1"
      label="Delete unfinished draft"
    >
      <input type="hidden" name="workflowId" value={workflowId} />
      <label className={confirmationClass}>
        <input
          className="mt-1 size-4 rounded border-input accent-primary"
          type="checkbox"
          required
        />
        Delete this unactivated draft. Its audit record will be retained.
      </label>
    </MutationForm>
  );
}

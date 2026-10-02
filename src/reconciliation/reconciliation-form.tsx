"use client";

import { useState, type FormEvent } from "react";
import { Calculator, CheckCircle2, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

type Result = {
  planType: string;
  roundedUsage: string;
  calculatedAmount: string;
  legacyAmount: string | null;
  differenceAmount: string | null;
  matches: boolean | null;
  lines: Array<{ description: string; amount: string }>;
};

const inputClass = "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";
const fieldClass = "space-y-2";

function Field({ name, label, hint, defaultValue = "0.00", step = "0.01" }: { name: string; label: string; hint?: string; defaultValue?: string; step?: string }) {
  return <div className={fieldClass}><label className="text-sm font-medium" htmlFor={name}>{label}</label><input className={inputClass} id={name} name={name} type="number" min="0" step={step} defaultValue={defaultValue} required />{hint && <p className="text-xs leading-5 text-muted-foreground">{hint}</p>}</div>;
}

export function ReconciliationForm() {
  const [planType, setPlanType] = useState("OTHER");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setResult(null);
    try {
      const body = new URLSearchParams();
      for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === "string") body.set(key, value);
      const response = await fetch("/api/reconciliation/calculate", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error ?? "Unable to calculate this period");
      setResult(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to calculate this period");
    } finally {
      setPending(false);
    }
  }
  const other = planType === "OTHER";
  const metered = planType === "METERED";
  const unmetered = planType === "UNMETERED";
  return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
    <form className="rounded-lg border border-input bg-card p-6" onSubmit={submit}>
      <div className="flex items-start gap-3"><Calculator className="mt-0.5 size-5 text-primary" /><div><h2 className="text-lg font-semibold">Historical inputs</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Enter the values that were true for the month being checked. This never saves or changes the customer record.</p></div></div>
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div className={fieldClass}><label className="text-sm font-medium" htmlFor="planType">Legacy plan type</label><select className={inputClass} id="planType" name="planType" value={planType} onChange={(event) => setPlanType(event.target.value)}><option value="OTHER">Other / custom</option><option value="METERED">Metered</option><option value="UNMETERED">Unmetered</option><option value="FIXED">Fixed</option></select><p className="text-xs leading-5 text-muted-foreground">Choose the customer’s plan type at that time, not the name of an adjustment field.</p></div>
        <Field name="flowrouteTotalCost" label="Exact Flowroute total (USD)" defaultValue="0" hint="Use the stored Flowroute total without rounding it yourself." />
        <Field name="planPrice" label="Plan price (USD)" />
        {other && <Field name="meteredSipTrunkUsage" label="Metered SIP trunk usage (USD)" defaultValue="0.00" />}
        {other && <Field name="cloudServerHosting" label="Cloud server hosting (USD)" defaultValue="0.00" />}
        {(metered || unmetered) && <Field name="extraNumbers" label="Extra phone numbers" defaultValue="0" step="1" />}
        {(metered || unmetered) && <Field name="includedNumbers" label="Included phone numbers" defaultValue="0" step="1" />}
        {(metered || unmetered) && <Field name="extraNumberCost" label="Extra phone-number cost (USD)" defaultValue="0.00" />}
        {unmetered && <Field name="extraChannels" label="Customer channel quantity" defaultValue="0" step="1" />}
        {unmetered && <Field name="channelCost" label="Channel cost (USD)" defaultValue="0.00" />}
        <div className={fieldClass}><label className="text-sm font-medium" htmlFor="legacyInvoiceTotal">Legacy Stripe invoice total (optional)</label><input className={inputClass} id="legacyInvoiceTotal" name="legacyInvoiceTotal" type="number" min="0" step="0.01" placeholder="For example, 402.50" /><p className="text-xs leading-5 text-muted-foreground">Enter this only when you want an automatic match check.</p></div>
      </div>
      {/* Keep unused formula fields present so validation receives explicit zero values. */}
      {!other && <><input name="meteredSipTrunkUsage" type="hidden" value="0.00" readOnly /><input name="cloudServerHosting" type="hidden" value="0.00" readOnly /></>}
      {!(metered || unmetered) && <><input name="extraNumbers" type="hidden" value="0" readOnly /><input name="includedNumbers" type="hidden" value="0" readOnly /><input name="extraNumberCost" type="hidden" value="0.00" readOnly /></>}
      {!unmetered && <><input name="extraChannels" type="hidden" value="0" readOnly /><input name="channelCost" type="hidden" value="0.00" readOnly /></>}
      <Button className="mt-6" disabled={pending}>{pending ? "Calculating…" : "Calculate and compare"}</Button>
      {error && <p className="mt-4 text-sm text-destructive" role="alert">{error}</p>}
    </form>
    <aside className="rounded-lg border border-input bg-card p-6">
      <h2 className="text-lg font-semibold">Comparison result</h2>
      {!result ? <p className="mt-3 text-sm leading-6 text-muted-foreground">Enter a historical month and calculate it. The result will stay here for review, but it is never saved or sent to Stripe.</p> : <div className="mt-5 space-y-5"><div className="rounded-md border border-input bg-muted/30 p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">New calculation</p><p className="mt-2 text-3xl font-semibold">${result.calculatedAmount}</p><p className="mt-2 text-sm text-muted-foreground">Rounded Flowroute usage: {result.roundedUsage}</p></div>{result.legacyAmount !== null && <div className={`rounded-md border p-4 ${result.matches ? "border-primary/20 bg-primary/10" : "border-destructive/20 bg-destructive/10"}`}><div className="flex items-center gap-2">{result.matches ? <CheckCircle2 className="size-5 text-primary" /> : <CircleAlert className="size-5 text-destructive" />}<p className="font-semibold">{result.matches ? "Matches legacy invoice" : "Does not match"}</p></div><p className="mt-2 text-sm">Legacy total: ${result.legacyAmount}</p>{!result.matches && <p className="mt-1 text-sm">Difference: ${result.differenceAmount}</p>}</div>}<div><p className="text-sm font-semibold">Calculated lines</p><div className="mt-2 divide-y divide-input overflow-hidden rounded-md border border-input">{result.lines.map((line) => <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm" key={line.description}><span>{line.description}</span><span className="font-medium">${line.amount}</span></div>)}</div></div></div>}
    </aside>
  </div>;
}

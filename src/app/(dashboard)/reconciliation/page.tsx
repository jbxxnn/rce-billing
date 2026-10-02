import { ReconciliationForm } from "@/reconciliation/reconciliation-form";

export default function ReconciliationPage() {
  return <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6"><div><span className="text-xs font-semibold tracking-widest text-muted-foreground">MIGRATION REVIEW</span><h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Historical reconciliation</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Check a legacy billing period before migration. This calculator is read-only: it does not alter customer settings, create a billing run, or send an invoice.</p></div><ReconciliationForm /></main>;
}

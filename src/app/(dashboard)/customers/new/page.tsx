import Link from "next/link";
import { ArrowLeft, CircleCheck } from "lucide-react";
import { requireAdministrator } from "@/auth/server";
import { CustomerForm } from "@/customers/forms";
export default async function NewCustomer() {
  await requireAdministrator();
  return (
    <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Link
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          href="/customers"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Customers
        </Link>
        <span className="text-xs font-semibold tracking-widest text-muted-foreground">
          NEW CUSTOMER
        </span>
      </div>
      <div className="grid overflow-hidden rounded-xl border border-input bg-card lg:grid-cols-[minmax(0,0.92fr)_minmax(360px,0.68fr)]">
        <section className="p-6 md:p-8">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Add a customer
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Start with their billing profile. You can securely add Flowroute
            credentials after the customer is saved.
          </p>
          <CustomerForm />
        </section>
        <aside className="flex flex-col border-t border-input bg-muted/40 p-6 md:p-8 lg:border-t-0 lg:border-l">
          <span className="text-xs font-semibold tracking-widest text-muted-foreground">
            WHAT HAPPENS NEXT
          </span>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
            Set up billing in four steps
          </h2>
          <ol className="mt-6 space-y-4">
            {[
              ["1", "Save the customer", "Their record starts as a draft."],
              [
                "2",
                "Add Flowroute credentials",
                "These are encrypted before they are stored.",
              ],
              [
                "3",
                "Choose a plan",
                "Create a subscription draft for the customer.",
              ],
              [
                "4",
                "Activate in Stripe",
                "Confirm the subscription in the configured Stripe environment.",
              ],
            ].map(([step, title, description]) => (
              <li className="flex gap-3" key={step}>
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {step}
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {title}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-auto flex gap-2 pt-8 text-sm leading-6 text-muted-foreground">
            <CircleCheck
              className="size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            Saving this form does not create a charge or a Stripe subscription.
          </p>
        </aside>
      </div>
    </main>
  );
}

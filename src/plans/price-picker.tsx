import Link from "next/link";
import { ChangeStripePlan } from "../stripe/forms";
import { withPlans } from "./server";
import { DraftForm } from "./forms";
export async function PricePicker({
  customerId,
  draft,
  live = false,
}: {
  live?: boolean;
  customerId: string;
  draft?: {
    id: string;
    revision: number;
    priceVersionId: string;
    collectionMethod: string | null;
  };
}) {
  const prices = await withPlans((r) =>
    r.listPlans({
      activeOnly: true,
    }),
  );
  return (
    <>
      {prices.items.length ? (
        live && draft ? (
          <ChangeStripePlan
            id={draft.id}
            revision={draft.revision}
            requestKey={crypto.randomUUID()}
            options={prices.items}
          />
        ) : (
          <DraftForm
            key={String(draft?.revision ?? 0)}
            customerId={customerId}
            creationKey={crypto.randomUUID()}
            options={prices.items}
            draft={draft}
          />
        )
      ) : (
        <p className="rounded-lg border border-dashed border-input px-5 py-8 text-sm text-muted-foreground">
          No active plans are available.{" "}
          <Link
            className="font-medium text-primary hover:underline"
            href="/plans/new"
          >
            Create a plan
          </Link>{" "}
          to continue.
        </p>
      )}
    </>
  );
}

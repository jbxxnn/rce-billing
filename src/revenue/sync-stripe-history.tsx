"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SyncStripeHistory({ customerId }: { customerId?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function sync() {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const body = new URLSearchParams();
      if (customerId) body.set("customerId", customerId);
      const response = await fetch("/api/revenue/sync", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to sync Stripe history");
      setMessage(
        `${result.invoices} invoice${result.invoices === 1 ? "" : "s"} synced.`,
      );
      router.refresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to sync Stripe history",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" variant="outline" onClick={sync} disabled={pending}>
        <RefreshCw className={pending ? "animate-spin" : ""} />
        {pending ? "Syncing Stripe…" : customerId ? "Sync Stripe history" : "Sync Stripe history"}
      </Button>
      {message ? (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}

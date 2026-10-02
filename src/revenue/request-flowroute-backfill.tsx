"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RequestFlowrouteBackfill({
  customerId,
  usageSnapshotId,
  status,
}: {
  customerId: string;
  usageSnapshotId: string;
  status?: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function request() {
    if (pending || status) return;
    setPending(true);
    setMessage("");
    try {
      const body = new URLSearchParams({ customerId, usageSnapshotId });
      const response = await fetch("/api/revenue/flowroute-backfill", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Unable to request Flowroute usage");
      setMessage(
        result.status === "COMPLETED"
          ? "Usage is ready."
          : "Requested. Flowroute will process this in the background.",
      );
      router.refresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Unable to request Flowroute usage",
      );
    } finally {
      setPending(false);
    }
  }

  if (status)
    return (
      <span className="text-xs text-muted-foreground">
        {status === "COMPLETED" ? "Retrieved" : "Retrieval requested"}
      </span>
    );

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={request}
        disabled={pending}
      >
        <RefreshCw className={pending ? "animate-spin" : ""} />
        {pending ? "Requesting…" : "Retrieve from Flowroute"}
      </Button>
      {message ? (
        <p
          role="status"
          className="max-w-48 text-xs leading-4 text-muted-foreground"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReplayFlowrouteJob({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function replay() {
    if (pending || !window.confirm("Replay this failed Flowroute export?")) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/operations/flowroute-replay", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ jobId }),
      });
      const result = await response.json();
      if (!response.ok || result.error)
        throw new Error(result.error ?? "Unable to replay the job");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to replay the job");
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <button className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50" type="button" onClick={replay} disabled={pending}>
        {pending ? "Replaying…" : "Replay"}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}

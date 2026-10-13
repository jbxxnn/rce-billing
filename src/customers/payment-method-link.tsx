"use client";

import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PaymentMethodLink({ customerId }: { customerId: string }) {
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function createLink() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/customers/${customerId}/payment-method`,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "",
        },
      );
      const result = await response.json();
      if (!response.ok || !result.url)
        throw new Error(result.error ?? "Unable to create the Stripe link");
      setUrl(result.url);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to create the Stripe link",
      );
    } finally {
      setPending(false);
    }
  }
  async function copy() {
    await navigator.clipboard.writeText(url);
  }
  return (
    <div className="mt-5 space-y-3">
      <Button type="button" onClick={createLink} disabled={pending}>
        {pending ? "Creating link…" : "Create Stripe payment link"}
      </Button>
      {url && (
        <div className="rounded-md border border-input bg-muted/30 p-3">
          <p className="text-sm text-muted-foreground">
            Send this secure Stripe link to the customer. It lets them add or
            update their payment method.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={copy}>
              <Copy /> Copy link
            </Button>
            <a
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="size-4" /> Open Stripe link
            </a>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

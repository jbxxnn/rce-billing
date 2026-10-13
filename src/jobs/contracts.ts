export type FlowrouteJobMessage = {
  version: 1;
  jobId: string;
};

export type BillingSyncJobMessage = {
  version: 1;
  kind: "BILLING_SYNC";
  jobId: string;
};

function jsonBody(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function parseQueueMessageBody(value: unknown): unknown {
  if (typeof value === "string") return jsonBody(value);
  if (value instanceof ArrayBuffer)
    return jsonBody(new TextDecoder().decode(value));
  if (ArrayBuffer.isView(value))
    return jsonBody(
      new TextDecoder().decode(
        value.buffer.slice(
          value.byteOffset,
          value.byteOffset + value.byteLength,
        ),
      ),
    );
  return value;
}

export function parseFlowrouteJobMessage(
  value: unknown,
): FlowrouteJobMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (
    message.version !== 1 ||
    typeof message.jobId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      message.jobId,
    )
  )
    return null;
  return { version: 1, jobId: message.jobId };
}

export function parseBillingSyncJobMessage(
  value: unknown,
): BillingSyncJobMessage | null {
  const base = parseFlowrouteJobMessage(value);
  if (!base || (value as Record<string, unknown>).kind !== "BILLING_SYNC")
    return null;
  return { ...base, kind: "BILLING_SYNC" };
}

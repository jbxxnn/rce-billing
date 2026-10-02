import {
  FlowrouteError,
  type FlowrouteCredentials,
  type FlowrouteExport,
  type FlowrouteProvider,
} from "./contracts";

const API_BASE = "https://api.flowroute.com/v2";
const JSON_API = "application/vnd.api+json";

function basic(credentials: FlowrouteCredentials) {
  return `Basic ${btoa(`${credentials.accessKey}:${credentials.secretKey}`)}`;
}

function flowrouteDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new FlowrouteError("INVALID_REQUEST", "Invalid CDR export period");
  return `${value} 00:00:00`;
}

function decimal(value: unknown, field: string) {
  if (typeof value === "number") value = String(value);
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d{0,17})(\.\d{1,12})?$/.test(value)
  )
    throw new FlowrouteError(
      "UNKNOWN_PROVIDER_ERROR",
      `Flowroute returned an invalid ${field}`,
    );
  return value;
}

function providerId(value: unknown) {
  const id =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : value;
  if (typeof id !== "string" || !/^\d{1,32}$/.test(id))
    throw new FlowrouteError(
      "UNKNOWN_PROVIDER_ERROR",
      "Flowroute export response is malformed",
    );
  return id;
}

function providerStatus(value: unknown) {
  if (typeof value !== "string") return null;
  switch (value.trim().toLowerCase()) {
    case "completed":
      return "completed" as const;
    case "failed":
    case "error":
      return "failed" as const;
    case "processing":
    case "requested":
    case "queued":
    case "pending":
    case "created":
      return "processing" as const;
    default:
      return null;
  }
}

function exportFromPayload(payload: unknown): FlowrouteExport {
  if (!payload || typeof payload !== "object")
    throw new FlowrouteError(
      "UNKNOWN_PROVIDER_ERROR",
      "Flowroute returned an invalid export response",
    );
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object")
    throw new FlowrouteError(
      "UNKNOWN_PROVIDER_ERROR",
      "Flowroute export response has no data object",
    );
  const id = providerId((data as { id?: unknown }).id);
  const attributes = (data as { attributes?: unknown }).attributes;
  if (
    !attributes ||
    typeof attributes !== "object" ||
    Array.isArray(attributes)
  )
    throw new FlowrouteError(
      "UNKNOWN_PROVIDER_ERROR",
      "Flowroute export response is malformed",
    );
  const value = attributes as Record<string, unknown>;
  const statusValue = value.status;
  const status = providerStatus(statusValue);
  if (!status)
    throw new FlowrouteError(
      "UNKNOWN_PROVIDER_ERROR",
      "Flowroute export has an unknown status",
    );
  const raw: Record<string, unknown> = {
    id,
    status: statusValue,
    requestedAt: value.requested_at ?? null,
    createdAt: value.created_at ?? null,
    expiresAt: value.expires_at ?? null,
    totalCost: value.total_cost ?? null,
    billedMinutes: value.billed_minutes ?? null,
    numCalls: value.num_calls ?? null,
    filterParameters: value.filter_parameters ?? null,
  };
  return {
    id,
    status,
    ...(status === "completed" && value.total_cost !== null
      ? { totalCost: decimal(value.total_cost, "total cost") }
      : {}),
    ...(status === "completed" && value.billed_minutes !== null
      ? { billedMinutes: decimal(value.billed_minutes, "billed minutes") }
      : {}),
    raw,
  };
}

async function request(
  fetcher: typeof fetch,
  credentials: FlowrouteCredentials,
  path: string,
  init: RequestInit,
) {
  let response: Response;
  try {
    response = await fetcher(`${API_BASE}${path}`, {
      ...init,
      headers: {
        accept: JSON_API,
        authorization: basic(credentials),
        "content-type": JSON_API,
        ...init.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new FlowrouteError(
      "TEMPORARY_PROVIDER_ERROR",
      "Flowroute could not be reached",
    );
  }
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    if (response.status === 401 || response.status === 403)
      throw new FlowrouteError(
        "AUTHENTICATION_FAILED",
        "Flowroute rejected the stored credentials",
      );
    if (response.status === 429)
      throw new FlowrouteError(
        "RATE_LIMITED",
        "Flowroute rate limited the request",
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    if (response.status >= 500)
      throw new FlowrouteError(
        "TEMPORARY_PROVIDER_ERROR",
        "Flowroute is temporarily unavailable",
      );
    throw new FlowrouteError(
      "INVALID_REQUEST",
      "Flowroute rejected the export request",
    );
  }
  try {
    return exportFromPayload(await response.json());
  } catch (error) {
    if (error instanceof FlowrouteError) throw error;
    throw new FlowrouteError(
      "UNKNOWN_PROVIDER_ERROR",
      "Flowroute returned invalid JSON",
    );
  }
}

export function flowrouteProvider(
  fetcher: typeof fetch = fetch,
): FlowrouteProvider {
  return {
    createCdrExport(credentials, period) {
      return request(fetcher, credentials, "/cdrs/exports", {
        method: "POST",
        body: JSON.stringify({
          data: {
            type: "cdrexport",
            attributes: {
              filter_parameters: {
                start_call_start_time: flowrouteDate(period.periodStart),
                start_call_end_time: flowrouteDate(period.periodEnd),
              },
            },
          },
        }),
      });
    },
    getCdrExport(credentials, exportId) {
      if (!/^\d{1,32}$/.test(exportId))
        return Promise.reject(
          new FlowrouteError("INVALID_REQUEST", "Invalid Flowroute export ID"),
        );
      return request(fetcher, credentials, `/cdrs/exports/${exportId}`, {
        method: "GET",
      });
    },
  };
}

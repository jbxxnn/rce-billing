export type FlowrouteCredentials = {
  accessKey: string;
  secretKey: string;
};

export type FlowrouteErrorCode =
  | "AUTHENTICATION_FAILED"
  | "RATE_LIMITED"
  | "TEMPORARY_PROVIDER_ERROR"
  | "INVALID_REQUEST"
  | "EXPORT_FAILED"
  | "UNKNOWN_PROVIDER_ERROR";

export class FlowrouteError extends Error {
  constructor(
    public readonly code: FlowrouteErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export type FlowrouteExport = {
  id: string;
  status: "processing" | "completed" | "failed";
  totalCost?: string;
  billedMinutes?: string;
  raw: Record<string, unknown>;
};

export interface FlowrouteProvider {
  createCdrExport(
    credentials: FlowrouteCredentials,
    period: { periodStart: string; periodEnd: string },
  ): Promise<FlowrouteExport>;
  getCdrExport(
    credentials: FlowrouteCredentials,
    exportId: string,
  ): Promise<FlowrouteExport>;
}

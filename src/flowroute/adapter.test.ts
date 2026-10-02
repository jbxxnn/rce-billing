import { afterEach, describe, expect, it, vi } from "vitest";
import { flowrouteProvider } from "./adapter";
import { FlowrouteError } from "./contracts";

const credentials = {
  accessKey: "access-fixture",
  secretKey: "secret-fixture",
};
const processing = {
  data: {
    type: "cdrexport",
    id: "9001",
    attributes: {
      status: "processing",
      download_url: "https://temporary.example",
    },
  },
};

afterEach(() => vi.restoreAllMocks());

describe("Flowroute CDR adapter", () => {
  it("creates a UTC calendar-month export without callback or credential leakage", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(processing), {
          status: 202,
          headers: { "content-type": "application/vnd.api+json" },
        }),
    );
    const result = await flowrouteProvider(fetcher).createCdrExport(
      credentials,
      {
        periodStart: "2026-08-01",
        periodEnd: "2026-09-01",
      },
    );
    expect(result).toMatchObject({ id: "9001", status: "processing" });
    expect(result.raw).not.toHaveProperty("download_url");
    const [url, init] = fetcher.mock.calls[0]! as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.flowroute.com/v2/cdrs/exports");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.data).toEqual({
      type: "cdrexport",
      attributes: {
        filter_parameters: {
          start_call_start_time: "2026-08-01 00:00:00",
          start_call_end_time: "2026-09-01 00:00:00",
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain("callback_url");
    expect(new Headers(init.headers).get("authorization")).toBe(
      `Basic ${btoa("access-fixture:secret-fixture")}`,
    );
  });

  it("reads final totals and normalizes provider failures", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              id: "9001",
              attributes: {
                status: "completed",
                total_cost: "12.345678901234",
                billed_minutes: 17,
              },
            },
          }),
          { status: 200 },
        ),
    );
    await expect(
      flowrouteProvider(fetcher).getCdrExport(credentials, "9001"),
    ).resolves.toMatchObject({
      status: "completed",
      totalCost: "12.345678901234",
      billedMinutes: "17",
    });
    await expect(
      flowrouteProvider(fetcher).getCdrExport(credentials, "x"),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const failures: [number, string][] = [
      [401, "AUTHENTICATION_FAILED"],
      [429, "RATE_LIMITED"],
      [503, "TEMPORARY_PROVIDER_ERROR"],
      [422, "INVALID_REQUEST"],
    ];
    for (const [status, code] of failures) {
      const failed = flowrouteProvider(
        async () => new Response("{}", { status }),
      );
      await expect(
        failed.getCdrExport(credentials, "9001"),
      ).rejects.toMatchObject({
        code,
      });
    }
  });

  it("accepts numeric export IDs and provider pending status aliases", async () => {
    const provider = flowrouteProvider(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              id: 9001,
              attributes: { status: "QUEUED" },
            },
          }),
          { status: 202 },
        ),
    );
    await expect(
      provider.createCdrExport(credentials, {
        periodStart: "2026-08-01",
        periodEnd: "2026-09-01",
      }),
    ).resolves.toMatchObject({ id: "9001", status: "processing" });
  });

  it("rejects malformed totals and network errors without surfacing response details", async () => {
    const malformed = flowrouteProvider(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              id: "9001",
              attributes: { status: "completed", total_cost: "1e4" },
            },
          }),
        ),
    );
    await expect(
      malformed.getCdrExport(credentials, "9001"),
    ).rejects.toBeInstanceOf(FlowrouteError);
    const offline = flowrouteProvider(async () => {
      throw new Error("socket reset");
    });
    await expect(
      offline.getCdrExport(credentials, "9001"),
    ).rejects.toMatchObject({
      code: "TEMPORARY_PROVIDER_ERROR",
    });
  });
});

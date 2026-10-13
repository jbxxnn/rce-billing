import { describe, expect, it } from "vitest";
import { parseFlowrouteJobMessage, parseQueueMessageBody } from "./contracts";

describe("Flowroute queue messages", () => {
  it("parses JSON strings from Cloudflare's HTTP queue API", () => {
    const payload = {
      version: 1,
      jobId: "48ad6c51-a25c-46df-9a09-b4b3a33177a9",
    };
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    expect(parseQueueMessageBody(JSON.stringify(payload))).toEqual(payload);
    expect(parseQueueMessageBody(encoded)).toEqual(payload);
    expect(parseQueueMessageBody(encoded.buffer)).toEqual(payload);
    expect(parseQueueMessageBody("not json")).toBeNull();
  });

  it("accepts only the versioned UUID message contract", () => {
    expect(
      parseFlowrouteJobMessage({
        version: 1,
        jobId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      }),
    ).toEqual({
      version: 1,
      jobId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    });
    expect(parseFlowrouteJobMessage({ version: 2, jobId: "x" })).toBeNull();
    expect(parseFlowrouteJobMessage({ version: 1, jobId: "x" })).toBeNull();
  });
});

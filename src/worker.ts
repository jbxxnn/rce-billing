import handler from "vinext/server/app-router-entry";
import {
  authorizationServerMetadata,
  authorizeMcp,
  completeGoogleAuthorization,
  exchangeMcpToken,
  handleRemoteMcp,
  protectedResourceMetadata,
} from "./mcp/remote";
import { withDatabase } from "./db/client";
import { flowrouteProvider } from "./flowroute/adapter";
import {
  discoverFlowrouteWork,
  dispatchableFlowrouteJobs,
  flowrouteJobMessage,
  markFlowrouteJobEnqueued,
  processFlowrouteJob,
} from "./jobs/flowroute";
import { FlowrouteWorkflowError } from "./flowroute/service";
import {
  parseFlowrouteJobMessage,
  parseBillingSyncJobMessage,
  parseQueueMessageBody,
  type FlowrouteJobMessage,
} from "./jobs/contracts";
import {
  billingSyncJobMessage,
  dispatchableBillingSyncJobs,
  markBillingSyncJobEnqueued,
  processBillingSyncJob,
} from "./jobs/billing-sync";

type QueueBinding = {
  send(
    body: FlowrouteJobMessage,
    options?: { delaySeconds?: number },
  ): Promise<unknown>;
};
type Environment = {
  HYPERDRIVE?: { connectionString: string };
  FLOWROUTE_JOBS?: QueueBinding;
  STRIPE_BILLING_JOBS?: QueueBinding;
  APP_ORIGIN?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
};
type QueueMessage = {
  body: unknown;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};
type QueueBatch = { messages: QueueMessage[] };

function queueBodyKind(value: unknown) {
  if (value instanceof ArrayBuffer) return "ArrayBuffer";
  if (ArrayBuffer.isView(value)) return "ArrayBufferView";
  if (value === null) return "null";
  return typeof value;
}

function database(env: Environment) {
  if (!env.HYPERDRIVE?.connectionString)
    throw new Error("Hyperdrive is not configured");
  return env.HYPERDRIVE;
}

async function dispatch(env: Environment, now = new Date()) {
  const queue = env.FLOWROUTE_JOBS;
  if (!queue) throw new Error("Flowroute queue is not configured");
  return withDatabase(database(env), async (db) => {
    const discovery = await discoverFlowrouteWork(db, now);
    const jobs = await dispatchableFlowrouteJobs(db, now);
    let enqueued = 0;
    for (const job of jobs) {
      await queue.send(flowrouteJobMessage(job.id));
      await markFlowrouteJobEnqueued(db, job.id, now);
      enqueued += 1;
    }
    return { ...discovery, enqueued };
  });
}
async function dispatchStripe(env: Environment, now = new Date()) {
  const queue = env.STRIPE_BILLING_JOBS;
  if (!queue) throw new Error("Stripe billing queue is not configured");
  return withDatabase(database(env), async (db) => {
    const jobs = await dispatchableBillingSyncJobs(db, now);
    for (const job of jobs) {
      await queue.send(billingSyncJobMessage(job.id));
      await markBillingSyncJobEnqueued(db, job.id, now);
    }
    return { enqueued: jobs.length };
  });
}

const worker = {
  async fetch(request: Request, env: Environment, ctx: unknown): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/.well-known/oauth-protected-resource")
      return protectedResourceMetadata(env, request);
    if (path === "/.well-known/oauth-authorization-server")
      return authorizationServerMetadata(env, request);
    if (path === "/mcp/oauth/authorize") return authorizeMcp(env, request);
    if (path === "/mcp/oauth/google/callback")
      return completeGoogleAuthorization(env, request);
    if (path === "/mcp/oauth/token") return exchangeMcpToken(env, request);
    if (path === "/mcp") return handleRemoteMcp(env, request);
    return handler.fetch(request, env as { ASSETS?: never }, ctx as never);
  },
  async scheduled(_controller: unknown, env: Environment): Promise<void> {
    await dispatch(env);
    await dispatchStripe(env);
  },
  async queue(batch: QueueBatch, env: Environment): Promise<void> {
    for (const message of batch.messages) {
      const body = parseQueueMessageBody(message.body);
      const payload = parseFlowrouteJobMessage(body);
      const billingPayload = parseBillingSyncJobMessage(body);
      if (billingPayload) {
        try {
          await withDatabase(database(env), (db) =>
            processBillingSyncJob(db, billingPayload.jobId),
          );
          message.ack();
        } catch {
          message.retry({ delaySeconds: 60 });
        }
        continue;
      }
      if (!payload) {
        // Invalid messages can never be made valid by redelivery.
        console.warn("Ignoring invalid Flowroute Queue message", {
          bodyKind: queueBodyKind(message.body),
        });
        message.ack();
        continue;
      }
      try {
        await withDatabase(database(env), (db) =>
          processFlowrouteJob(db, flowrouteProvider(), payload.jobId),
        );
        // Database state schedules the next attempt. Queue delivery itself is
        // intentionally acknowledged to avoid two competing retry policies.
        message.ack();
      } catch (error) {
        // Keep unexpected infrastructure failures observable through Queue's
        // configured retry and dead-letter policy; the outbox lease also lets
        // the next cron invocation recover the job.
        console.warn("Retrying Flowroute Queue job", {
          reason:
            error instanceof FlowrouteWorkflowError
              ? error.code
              : "UNEXPECTED_ERROR",
        });
        message.retry({ delaySeconds: 60 });
      }
    }
  },
};

export default worker;

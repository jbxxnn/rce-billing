import { withDatabase } from "../../src/db/client";
import { replayFlowrouteJob } from "../../src/jobs/flowroute";

const jobId = process.argv[2];
try {
  if (!process.env.DATABASE_URL || !jobId)
    throw new Error("Database and background job ID are required");
  await withDatabase(
    { connectionString: process.env.DATABASE_URL },
    async (db) => {
      const result = await replayFlowrouteJob(db, jobId);
      console.log(`${result.id}: ${result.status}`);
    },
  );
} catch {
  console.error(
    "Flowroute job was not replayed. Only a reviewed, non-completed job can be reset.",
  );
  process.exitCode = 1;
}

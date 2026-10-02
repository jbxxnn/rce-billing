import { eq } from "drizzle-orm";
import { withDatabase } from "../../src/db/client";
import { backgroundJobs } from "../../src/db/schema";
import { flowrouteProvider } from "../../src/flowroute/adapter";
import { flowrouteExportService } from "../../src/flowroute/service";
import { processFlowrouteJob } from "../../src/jobs/flowroute";

const exportId = process.argv[2];
try {
  if (!process.env.DATABASE_URL || !exportId)
    throw new Error("Database and usage export ID are required");
  await withDatabase(
    { connectionString: process.env.DATABASE_URL },
    async (db) => {
      const provider = flowrouteProvider();
      const result = await flowrouteExportService(
        db,
        provider,
      ).process(exportId);
      if (result.status === "COMPLETED") {
        const jobs = await db
          .select({ id: backgroundJobs.id })
          .from(backgroundJobs)
          .where(eq(backgroundJobs.usageExportId, exportId));
        for (const job of jobs)
          await processFlowrouteJob(db, provider, job.id);
      }
      console.log(`${result.id}: ${result.status}`);
    },
  );
} catch {
  console.error(
    "Flowroute export processing did not complete. Inspect the stored export status; no credentials or provider response were logged.",
  );
  process.exitCode = 1;
}

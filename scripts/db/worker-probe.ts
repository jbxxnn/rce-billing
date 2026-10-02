import { AuthenticationService } from "../../src/auth/service";
import { authenticationRepository } from "../../src/db/repositories/authentication";
// Local integration-test Worker only; never deployed by application configuration.
import { withDatabase } from "../../src/db/client";
import { createCatalogRepository } from "../../src/db/repositories";
const worker = {
  async fetch(
    _request: Request,
    env: { HYPERDRIVE: { connectionString: string } },
  ) {
    if (_request.method === "POST") {
      const input = (await _request.json()) as {
        email: string;
        password: string;
      };
      const authenticated = await withDatabase(env.HYPERDRIVE, async (db) =>
        Boolean(
          await new AuthenticationService(authenticationRepository(db)).login(
            input.email,
            input.password,
          ),
        ),
      );
      return Response.json({ authenticated });
    }
    const plans = await withDatabase(env.HYPERDRIVE, (db) =>
      createCatalogRepository(db).listActivePlans(),
    );
    return Response.json({ status: "ok", activePlanCount: plans.length });
  },
};

export default worker;

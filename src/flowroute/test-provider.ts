import {
  FlowrouteError,
  type FlowrouteCredentials,
  type FlowrouteExport,
  type FlowrouteProvider,
} from "./contracts";

/** Stateful fixture for contract tests. Application code never imports this file. */
export class TestFlowroute implements FlowrouteProvider {
  created = 0;
  checked = 0;
  next: FlowrouteExport = {
    id: "9001",
    status: "processing",
    raw: { id: "9001", status: "processing" },
  };
  failure: FlowrouteError | null = null;
  credentials: FlowrouteCredentials[] = [];

  async createCdrExport(credentials: FlowrouteCredentials) {
    this.created += 1;
    this.credentials.push({ ...credentials });
    if (this.failure) throw this.failure;
    return structuredClone(this.next);
  }

  async getCdrExport(credentials: FlowrouteCredentials) {
    this.checked += 1;
    this.credentials.push({ ...credentials });
    if (this.failure) throw this.failure;
    return structuredClone(this.next);
  }
}

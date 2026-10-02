declare module "cloudflare:workers" {
  export const env: {
    HYPERDRIVE?: { connectionString: string };
    FLOWROUTE_JOBS?: Queue;
  };
}

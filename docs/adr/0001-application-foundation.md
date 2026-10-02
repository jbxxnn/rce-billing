# ADR 0001: Application foundation

Date: 2026-09-22
Status: Accepted for development; production compatibility remains a gate.

## Decision

Use Next.js 16 App Router with strict TypeScript. Preserve standard `next dev` and `next build` and build the Workers target with vinext, Vite, and the Cloudflare Vite plugin. Keep the application at the repository root and leave the legacy PHP directory unchanged and untracked.

Cloudflare's [current Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/) recommends vinext. The [official vinext repository](https://github.com/cloudflare/vinext) documents the App Router RSC environment configuration. Both were checked on 2026-09-22. The beta dependency is pinned in the lockfile and must be revalidated as integrations are added.

## Consequences

CI checks both build paths and runs the static compatibility checker. This verifies only the current small application surface, not future database, authentication, queue, or billing integrations. No deployment or financial mutations are part of Phase 0.

Use Node.js 24 LTS in CI and the documented development environment. Preserve immutable price and calculation records in later phases. Section 23's confirmed business decisions take precedence over earlier suggestions in the plan. Schema constraints and invoice-finalization controls must enforce those decisions rather than treating the proposed schema as complete.

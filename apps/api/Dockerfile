# syntax=docker/dockerfile:1.7
# Trackarr API — Nitro standalone, distroless runtime.
#
# The runtime image carries:
#   - the Nitro bundle (.output/server/) — drizzle-orm, postgres-js, ioredis,
#     etc. are all inlined by Nitro at build time (no node_modules needed for
#     the server itself)
#   - a minimal /app/db-tools tree containing just drizzle-kit and what it
#     needs to apply schema changes at boot via `drizzle-kit push --force`
#   - a Node-based entrypoint (.mjs) that runs the schema push then loads
#     the Nitro server in-process (no shell, signals reach Nitro directly)
#
# The previous runtime image carried the full monorepo node_modules + pnpm +
# corepack + the api's build deps just to expose a single CLI invocation;
# this trims it down to what's actually needed at boot.
#
# Base is gcr.io/distroless/nodejs24-debian13:nonroot — no /bin/sh, no apt,
# runs as uid 65532, signed by Google.

# -----------------------------------------------------------------------------
# Install dependencies for the API build (cached on package.json + lockfile)
# -----------------------------------------------------------------------------
FROM node:24-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --filter "@trackarr/api..." --frozen-lockfile

# -----------------------------------------------------------------------------
# Build Nitro (produces apps/api/.output, fully self-contained)
# -----------------------------------------------------------------------------
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api ./apps/api
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared
RUN pnpm --filter @trackarr/api build

# -----------------------------------------------------------------------------
# Build a minimal db-tools tree with only what's needed for boot-time
# `drizzle-kit push --force` against schema.ts. Hoisted into /db-tools so it
# stays isolated from the Nitro bundle's own (inlined) node_modules.
# -----------------------------------------------------------------------------
FROM node:24-alpine AS db-tools
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /db-tools
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/db ./packages/db
RUN pnpm install --filter @trackarr/db --frozen-lockfile

# Strip what drizzle-kit doesn't need at runtime:
# - other-platform esbuild binaries (we only run on linux x64/arm64)
# - typescript: drizzle-kit uses esbuild-kit, not tsc, to load schema.ts
# - source maps and TypeScript declaration files
RUN find node_modules \
    \( -name '*.d.ts' -o -name '*.map' -o -name 'CHANGELOG*' \
       -o -name 'README*' -o -name 'LICENSE*' \) -delete 2>/dev/null || true \
 && rm -rf node_modules/.pnpm/typescript@* node_modules/typescript \
 && rm -rf node_modules/.cache \
 && find node_modules -path '*esbuild-*-32/bin*' -delete 2>/dev/null || true

# -----------------------------------------------------------------------------
# Final runtime — distroless nonroot
# Entrypoint of this base image is `/nodejs/bin/node`; CMD is just the script.
# -----------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runner
WORKDIR /app

COPY --from=builder --chown=nonroot:nonroot /app/apps/api/.output ./.output
COPY --from=db-tools --chown=nonroot:nonroot /db-tools ./db-tools
COPY --chown=nonroot:nonroot apps/api/scripts/entrypoint.mjs ./entrypoint.mjs
COPY --chown=nonroot:nonroot apps/api/scripts/healthcheck.mjs ./healthcheck.mjs

USER nonroot
EXPOSE 4000
# Memory tuning:
#   --max-old-space-size=512   cap the V8 old-generation heap at 512 MB.
#                              Without this, Node 24 derives the cap from the
#                              host's RAM (often 2+ GB on dev machines), which
#                              defers GC and lets RSS balloon under load.
#   --max-semi-space-size=8    smaller young-generation chunks → more frequent
#                              minor GCs, lower transient peak.
#   MALLOC_ARENA_MAX=2         glibc malloc on distroless pre-allocates one
#                              memory arena per CPU; capping at 2 saves
#                              ~30-60 MB of RSS on multi-core hosts.
# Override NODE_OPTIONS at runtime to scale up for heavy traffic.
ENV NODE_ENV=production \
    NITRO_PORT=4000 \
    NITRO_HOST=0.0.0.0 \
    NODE_OPTIONS="--max-old-space-size=512 --max-semi-space-size=8" \
    MALLOC_ARENA_MAX=2
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["/nodejs/bin/node", "/app/healthcheck.mjs"]

CMD ["entrypoint.mjs"]

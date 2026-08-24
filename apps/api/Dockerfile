# syntax=docker/dockerfile:1.7
# Trackarr API — Nitro standalone, distroless runtime.
#
# The runtime image carries:
#   - the Nitro bundle (.output/server/) — drizzle-orm, postgres-js, ioredis,
#     etc. are all inlined by Nitro at build time (no node_modules needed for
#     the server itself)
#   - a minimal /app/db-tools tree containing just drizzle-kit and what it
#     needs for schema work (drizzle-orm + postgres, used by migrate.mjs)
#   - a Node-based entrypoint (.mjs) that runs the schema push, aborts the
#     boot if it did not apply, then loads
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
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
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
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api ./apps/api
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared
# `packages/shared/tsconfig.json` extends this file. Harmless before the
# release parser moved into the package, because nothing pulled its
# sources through the bundler; now the web build transforms them and
# resolves the tsconfig chain, which dies without the base.
COPY tsconfig.base.json ./
RUN pnpm --filter @trackarr/api build

# -----------------------------------------------------------------------------
# Build a minimal db-tools tree with only what's needed for boot-time
# `drizzle-kit push --force` against schema.ts. Hoisted into /db-tools so it
# stays isolated from the Nitro bundle's own (inlined) node_modules.
# -----------------------------------------------------------------------------
FROM node:24-alpine AS db-tools
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
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

# An empty directory for the runtime stage to copy in as the uploads mount
# point. It has to be minted in a stage that HAS a shell — the distroless
# runtime has none, so `RUN mkdir` is not available there. See the runtime
# stage for why the directory must exist in the image at all.
RUN mkdir -p /seed/uploads

# -----------------------------------------------------------------------------
# Final runtime — distroless nonroot
# Entrypoint of this base image is `/nodejs/bin/node`; CMD is just the script.
# -----------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runner
WORKDIR /app

COPY --from=builder --chown=nonroot:nonroot /app/apps/api/.output ./.output
COPY --from=db-tools --chown=nonroot:nonroot /db-tools ./db-tools

# The uploads mount point, present in the IMAGE and owned by the runtime user.
#
# This is load-bearing, and the reason is not obvious. Docker seeds a brand-new
# named volume from whatever the image has at the mount point — contents AND
# ownership. When the path is absent from the image, as it was, the volume is
# created root:root 0755 instead, and the API runs as uid 65532. So on a fresh
# `docker compose up` the very first branding upload died with
#
#   EACCES: permission denied, open '/app/data/uploads/logo-<hex>.png'
#
# while an older deployment kept working, because its volume had been seeded
# back when the image still ran as root. Creating the directory here makes the
# volume inherit 65532:65532 and the write succeed with no manual chown.
#
# Existing volumes are NOT retro-fixed by this — Docker only seeds a volume
# that is empty. Those already work; one created empty by an affected version
# needs a one-off `chown 65532:65532` (see doc/guide/troubleshooting.md).
COPY --from=db-tools --chown=nonroot:nonroot /seed/uploads ./data/uploads
COPY --chown=nonroot:nonroot apps/api/scripts/entrypoint.mjs ./entrypoint.mjs
COPY --chown=nonroot:nonroot apps/api/scripts/migrationOutcome.mjs ./migrationOutcome.mjs
# Beside the db tree so `postgres` / `drizzle-orm` resolve for it.
COPY --chown=nonroot:nonroot apps/api/scripts/migrate.mjs /app/db-tools/packages/db/migrate.mjs
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
    MALLOC_ARENA_MAX=2 \
    NITRO_ENV_PREFIX=NUXT_ \
    TRACKARR_RUNTIME=docker
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["/nodejs/bin/node", "/app/healthcheck.mjs"]

CMD ["entrypoint.mjs"]

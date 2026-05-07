# syntax=docker/dockerfile:1.7
# Trackarr web — Nuxt SSR, distroless runtime.
#
# The Nitro server bundle in `.output/server/` is fully self-contained
# (Nuxt inlines its node_modules at build time), so the runtime image
# carries only that bundle and a small Node-based healthcheck.
#
# Base is gcr.io/distroless/nodejs24-debian13:nonroot — no /bin/sh, no apt,
# no package manager, runs as uid 65532, signed by Google.

# -----------------------------------------------------------------------------
# Install dependencies (cached on package.json + lockfile)
# -----------------------------------------------------------------------------
FROM node:24-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --filter "@trackarr/web..." --frozen-lockfile

# -----------------------------------------------------------------------------
# Build the Nuxt app (produces apps/web/.output)
# -----------------------------------------------------------------------------
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared
RUN pnpm --filter @trackarr/web build

# -----------------------------------------------------------------------------
# Final runtime — distroless nonroot
# Entrypoint of this base image is `/nodejs/bin/node`; CMD is just the script.
# -----------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runner
WORKDIR /app

COPY --from=builder --chown=nonroot:nonroot /app/apps/web/.output ./.output
COPY --chown=nonroot:nonroot apps/web/scripts/healthcheck.mjs ./healthcheck.mjs

USER nonroot
EXPOSE 3000
ENV NODE_ENV=production \
    NUXT_HOST=0.0.0.0 \
    NUXT_PORT=3000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["/nodejs/bin/node", "/app/healthcheck.mjs"]

CMD [".output/server/index.mjs"]

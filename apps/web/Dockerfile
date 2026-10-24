# syntax=docker/dockerfile:1.7
# Trackarr web — Nuxt SSR, distroless runtime.
#
# The Nitro server bundle in `.output/server/` is fully self-contained
# (Nuxt inlines its node_modules at build time), so the runtime image
# carries only that bundle and a small Node-based healthcheck.
#
# Base is gcr.io/distroless/nodejs26-debian13:nonroot — no /bin/sh, no apt,
# no package manager, runs as uid 65532, signed by Google.

# -----------------------------------------------------------------------------
# Install dependencies (cached on package.json + lockfile)
# -----------------------------------------------------------------------------
FROM node:26-alpine AS deps
# npm rather than corepack: Node 25 stopped shipping corepack, so the
# node:26 images have none. The version must match `packageManager` in the
# root package.json — pnpm 12 records it in pnpm-lock.yaml and a frozen
# install refuses a lockfile whose pin it does not match. `--allow-scripts`
# names the one install script we let run: pnpm's own, which only hard-links
# its native binary over the bins. npm 11.20 runs unlisted scripts with a
# warning today and is moving to blocking them.
RUN npm install --global --allow-scripts=pnpm pnpm@12.15.0
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --filter "@trackarr/web..." --frozen-lockfile

# -----------------------------------------------------------------------------
# Build the Nuxt app (produces apps/web/.output)
# -----------------------------------------------------------------------------
FROM node:26-alpine AS builder
RUN npm install --global --allow-scripts=pnpm pnpm@12.15.0
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared
# `packages/shared/tsconfig.json` extends this file. Harmless before the
# release parser moved into the package, because nothing pulled its
# sources through the bundler; now the web build transforms them and
# resolves the tsconfig chain, which dies without the base.
COPY tsconfig.base.json ./
# `--mount=type=cache` on the font cache, and it is not a speed optimisation.
# `@nuxt/fonts` fetches each family's metadata from Google at build time, and a
# machine that rebuilds this image repeatedly gets tarpitted: measured here as
# `ETIMEDOUT` on every request while an ordinary container reached the same URL
# in 0.2 s. The cache means a rebuild refetches nothing, which turns the failure
# mode from "the build breaks" into "the first build of the day is the only one
# that needs Google".
#
# The target is the WEB package's node_modules, not the workspace root's: the
# module resolves its cache against Nuxt's `rootDir` (apps/web) — @nuxt/fonts
# 1.x says so, and 0.14 got the same path from the working directory pnpm
# runs the script in. Until 2026-10 this mounted `/app/node_modules/.cache/nuxt`,
# which nothing writes to, so the cache this comment promises never existed:
# measured, the faces land in apps/web/node_modules/.cache/nuxt/fonts (3 MB).
#
# It does not help a cold CI runner. If a release pipeline cannot tolerate a
# retry, switch the families to `provider: 'local'` — see apps/web/nuxt.config.ts.
RUN --mount=type=cache,target=/app/apps/web/node_modules/.cache/nuxt/fonts,sharing=locked \
    pnpm --filter @trackarr/web build

# -----------------------------------------------------------------------------
# Final runtime — distroless nonroot
# Entrypoint of this base image is `/nodejs/bin/node`; CMD is just the script.
# -----------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs26-debian13:nonroot AS runner
WORKDIR /app

COPY --from=builder --chown=nonroot:nonroot /app/apps/web/.output ./.output
COPY --chown=nonroot:nonroot apps/web/scripts/healthcheck.mjs ./healthcheck.mjs

USER nonroot
EXPOSE 3000
# Memory tuning (see apps/api/Dockerfile for rationale).
# Web SSR retains compiled Vue templates / component state; without an
# explicit V8 heap cap, sustained traffic grows RSS into the hundreds of
# MB before V8 bothers to GC. 384 MB is plenty for SSR.
#
# `--no-experimental-webstorage` matters more here than in the API: this
# process renders pages for every visitor, and Node 25+ would hand that
# render a `sessionStorage` shared by all of them. Same flag, same reason
# — see apps/api/Dockerfile.
ENV NODE_ENV=production \
    NUXT_HOST=0.0.0.0 \
    NUXT_PORT=3000 \
    NODE_OPTIONS="--max-old-space-size=384 --max-semi-space-size=8 --no-experimental-webstorage" \
    MALLOC_ARENA_MAX=2 \
    TRACKARR_RUNTIME=docker
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["/nodejs/bin/node", "/app/healthcheck.mjs"]

CMD [".output/server/index.mjs"]

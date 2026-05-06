# Trackarr API (Nitro standalone)
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app

# -----------------------------------------------------------------------------
# Install dependencies (cached on package.json changes)
# -----------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/backend/package.json ./packages/backend/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --filter "@trackarr/api..." --frozen-lockfile

# -----------------------------------------------------------------------------
# Build Nitro
# -----------------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api ./apps/api
COPY packages/db ./packages/db
COPY packages/backend ./packages/backend
COPY packages/shared ./packages/shared
RUN pnpm --filter @trackarr/api build

# -----------------------------------------------------------------------------
# Migration helper image:
# We need drizzle-kit at runtime to push the schema, plus the source of
# packages/db (the drizzle config and schema file).
# -----------------------------------------------------------------------------
FROM base AS migrator
COPY --from=builder /app/node_modules ./node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/db ./packages/db

# -----------------------------------------------------------------------------
# Final runtime image
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nitro

COPY --from=builder --chown=nitro:nodejs /app/apps/api/.output ./.output
COPY --from=migrator --chown=nitro:nodejs /app/node_modules ./node_modules
COPY --from=migrator --chown=nitro:nodejs /app/packages/db ./packages/db
COPY --from=migrator --chown=nitro:nodejs /app/package.json ./package.json
COPY --from=migrator --chown=nitro:nodejs /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --chown=nitro:nodejs apps/api/scripts/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nitro

EXPOSE 4000
ENV NODE_ENV=production NITRO_PORT=4000 NITRO_HOST=0.0.0.0

ENTRYPOINT ["./entrypoint.sh"]

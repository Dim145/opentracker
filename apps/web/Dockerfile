# Trackarr web (Nuxt SSR frontend)
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app

# -----------------------------------------------------------------------------
# Install dependencies (cached on package.json changes)
# -----------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --filter "@trackarr/web..." --frozen-lockfile

# -----------------------------------------------------------------------------
# Build the Nuxt app
# -----------------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared
RUN pnpm --filter @trackarr/web build

# -----------------------------------------------------------------------------
# Final runtime image
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nuxtjs

COPY --from=builder --chown=nuxtjs:nodejs /app/apps/web/.output ./.output

USER nuxtjs

EXPOSE 3000
ENV NODE_ENV=production NUXT_HOST=0.0.0.0 NUXT_PORT=3000

CMD ["node", ".output/server/index.mjs"]

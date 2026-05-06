# Trackarr tracker (BitTorrent HTTP tracker, standalone)
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/tracker/package.json ./apps/tracker/
COPY packages/db/package.json ./packages/db/
RUN pnpm install --filter "@trackarr/tracker..." --frozen-lockfile && \
    # bittorrent-tracker imports @thaunknown/simple-peer/lite.js which our
    # overrides replace with empty-npm-package. The empty package doesn't
    # ship a lite.js so we create one — this matches the behavior of the
    # legacy postinstall script in the monolith. -L follows pnpm symlinks.
    # Note: avoid `{}` in the inline shell — find substitutes it everywhere.
    find -L node_modules -type d -name simple-peer -exec sh -c 'echo "export default null;" > "$1/lite.js"' _ {} \;

FROM base AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 tracker

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=tracker:nodejs package.json pnpm-workspace.yaml ./
COPY --chown=tracker:nodejs apps/tracker ./apps/tracker
COPY --chown=tracker:nodejs packages/db ./packages/db

USER tracker

EXPOSE 8080
ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@trackarr/tracker", "run", "start"]

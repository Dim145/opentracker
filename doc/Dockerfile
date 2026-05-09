# syntax=docker/dockerfile:1.7
#
# Trackarr documentation — VitePress static build, distroless nginx
# runtime. Final image lands around 12 MB.
#
# Why distroless:
#   - no shell, no package manager, no busybox — the image surface
#     is the static binary `nginx`, libssl, libpcre and the conf
#     files we copy in. Nothing else for an attacker to chain off.
#   - runs as non-root (uid 65532) by default
#   - signed by Chainguard; the build is reproducible
#
# Build:
#   docker build -t trackarr-docs:latest -f doc/Dockerfile doc
#
# Build with a different base path (e.g. served at the root of a
# vhost instead of `/opentracker/`):
#   docker build --build-arg VITEPRESS_BASE=/ -t trackarr-docs:latest -f doc/Dockerfile doc
#
# Run:
#   docker run --rm -p 8080:8080 trackarr-docs:latest
#   open http://localhost:8080/opentracker/   (or /, depending on the build arg)

# -----------------------------------------------------------------------------
# Stage 1 — install dependencies. Cached on package-lock.json + package.json
# alone so source-only edits don't bust the deps layer.
# -----------------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# -----------------------------------------------------------------------------
# Stage 2 — build the static bundle.
#   - VITEPRESS_BASE controls the URL prefix bundled into the HTML
#     (passed through to vitepress via process.env, see config.ts).
#   - Output lives at .vitepress/dist/.
# -----------------------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG VITEPRESS_BASE=/
ENV VITEPRESS_BASE=${VITEPRESS_BASE}
ENV NODE_ENV=production

RUN npm run build

# -----------------------------------------------------------------------------
# Stage 3 — runtime. Chainguard's distroless nginx is a hardened,
# fully-distroless image:
#   - no shell, no package manager
#   - runs as `nginx` (non-root) on uid 65532
#   - listens on 8080 by default (no need for cap_net_bind_service)
#   - signed image — `cosign verify` will check the provenance
# -----------------------------------------------------------------------------
FROM cgr.dev/chainguard/nginx:latest AS runner

# Configuration first so the image fails fast on a config typo
# during the `nginx -t` healthcheck below.
COPY docker/nginx.conf /etc/nginx/nginx.conf

# The static bundle. nginx defaults to /usr/share/nginx/html.
COPY --from=builder --chown=nginx:nginx /app/.vitepress/dist/ /usr/share/nginx/html/

# Document the listening port. Caddy / k8s service / docker-compose
# all map to whatever they want; the container itself listens here.
EXPOSE 8080

# nginx best-practice: SIGQUIT triggers a graceful drain (existing
# in-flight requests finish). docker stop then takes 10 s by default
# before SIGKILL — plenty for a static asset response.
STOPSIGNAL SIGQUIT

# Healthcheck — `nginx -t` validates the config without making a
# network round-trip, so it works even when there's no client traffic.
# The dedicated /healthz route in nginx.conf covers HTTP-level probes
# (k8s readinessProbe / docker-compose's healthcheck httpGet, etc.).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/usr/sbin/nginx", "-t"]

# The Chainguard image's default ENTRYPOINT runs `nginx -g 'daemon off;'`
# from the right user. No overrides needed.

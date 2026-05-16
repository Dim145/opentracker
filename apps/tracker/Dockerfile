# Trackarr tracker (Go) — runs from `scratch`, the empty base image.
#
# scratch has no shell, no libc, no certs, nothing. The Go binary is built
# CGO-free and statically linked so it doesn't need any of that.
#
# We don't ship CA certificates or tzdata because:
#   - the tracker only talks to Postgres + Redis on the internal Docker
#     network, never any HTTPS endpoint (no need for ca-certificates.crt);
#   - all timestamps use time.Now().UTC() (no need for /usr/share/zoneinfo).
#
# We also skip /etc/passwd: USER takes a numeric uid:gid, so the kernel
# applies it without ever needing to look up a username.

FROM golang:1.25-alpine AS builder
WORKDIR /src

# Cache deps independently of source changes.
COPY apps/tracker/go.mod apps/tracker/go.sum ./
RUN go mod download

COPY apps/tracker/ ./

# CGO_ENABLED=0 + -extldflags=-static guarantees a fully static ELF.
# -s -w strips DWARF + symbol tables (~30% smaller).
# -trimpath drops the build host's filesystem paths from the binary.
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w -extldflags=-static" \
    -trimpath \
    -o /out/tracker \
    ./cmd/tracker

# -----------------------------------------------------------------------------
# Final image: literally just the binary.
# -----------------------------------------------------------------------------
FROM scratch

COPY --from=builder /out/tracker /tracker

# Numeric uid:gid — no /etc/passwd needed. 65532 is the conventional
# "nonroot" id used by distroless, kept here for consistency with other
# secure images in the stack.
USER 65532:65532

EXPOSE 8080
EXPOSE 6969/udp
ENV TRACKER_HTTP_PORT=8080
ENV TRACKER_UDP_PORT=6969
ENV TRACKER_UDP_ENABLED=true

# Healthcheck — the `healthcheck` subcommand is built into the
# tracker binary itself, since the scratch image has no shell or
# curl. It probes http://127.0.0.1:${TRACKER_HTTP_PORT}/health and
# exits 0/1; the /health handler already returns 503 when Postgres
# or Redis are unreachable, so a status-code check is enough.
#
# start-period gives the binary time to finish its initial DB
# connection + the once-per-launch warm-up before the first probe
# can fail the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/tracker", "healthcheck"]

ENTRYPOINT ["/tracker"]

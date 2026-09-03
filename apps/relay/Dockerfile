# Trackarr messaging relay (Go) — runs from `scratch`, like the tracker.
#
# scratch has no shell, no libc, no certs. The binary is CGO-free and
# statically linked, so it needs none of them.
#
# No CA bundle: the relay speaks to Valkey on the internal network and to
# nobody over HTTPS. No tzdata: every timestamp it handles is Unix seconds.
# No /etc/passwd: USER takes a numeric uid:gid, which the kernel applies
# without a name lookup.

FROM golang:1.26-alpine AS builder
WORKDIR /src

COPY apps/relay/go.mod apps/relay/go.sum ./
RUN go mod download

COPY apps/relay/ ./

RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w -extldflags=-static" \
    -trimpath \
    -o /out/relay \
    ./cmd/relay

FROM scratch AS runner
COPY --from=builder /out/relay /relay
USER 65532:65532
EXPOSE 4100
# La sonde, sous forme de sous-commande du binaire lui-même.
#
# `scratch` n'a ni shell ni curl : c'est pourquoi ce service était le seul de la
# pile sans `HEALTHCHECK`, alors qu'il expose `/healthz` et que le chart Helm le
# sonde déjà. Le tracker résout la même contrainte de la même façon.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/relay", "healthcheck"]
ENTRYPOINT ["/relay"]

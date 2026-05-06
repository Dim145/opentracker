# Trackarr tracker (Go) — produces a tiny static binary on a distroless base.

FROM golang:1.23-alpine AS builder
WORKDIR /src

# Cache deps independently of source changes.
COPY apps/tracker/go.mod apps/tracker/go.sum ./
RUN go mod download

COPY apps/tracker/ ./

# CGO_ENABLED=0 + a static link so the binary can run on distroless/scratch.
# -s -w strips DWARF and symbol tables (~30% smaller).
# -trimpath drops the build host's path from the binary.
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w" \
    -trimpath \
    -o /out/tracker \
    ./cmd/tracker

# Runtime image: distroless static. ~2 MB base, runs as nonroot (uid 65532).
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /out/tracker /tracker

EXPOSE 8080
ENV TRACKER_HTTP_PORT=8080

ENTRYPOINT ["/tracker"]

// Command tracker runs the BitTorrent HTTP tracker.
//
// Wiring is intentionally simple: load config, open Postgres, open Redis,
// then serve /announce, /scrape, /health on TRACKER_HTTP_PORT.
//
// `tracker healthcheck` is a self-contained subcommand that probes
// http://127.0.0.1:${TRACKER_HTTP_PORT}/health and exits 0/1. The
// Docker image is `FROM scratch` (no shell, no curl) so the binary
// has to do this itself; bundling the probe into the same binary
// keeps the image down to one file.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/florianjs/trackarr/apps/tracker/internal/config"
	"github.com/florianjs/trackarr/apps/tracker/internal/db"
	"github.com/florianjs/trackarr/apps/tracker/internal/peers"
	"github.com/florianjs/trackarr/apps/tracker/internal/server"
	"github.com/florianjs/trackarr/apps/tracker/internal/udp"
)

func main() {
	// Healthcheck subcommand — invoked by the Docker HEALTHCHECK
	// directive. Hits the local /health endpoint and exits non-zero
	// if Postgres or Redis are down, or the server isn't listening.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(runHealthcheck())
	}
	// Wrap the text handler with our passkey-masking middleware so
	// any 32+-char hex run in messages or attribute values is
	// redacted before reaching stdout — defense-in-depth against pgx
	// errors stringifying their parameters and against future code
	// accidentally logging req.Passkey.
	base := slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	logger := slog.New(server.NewPasskeyMaskingHandler(base))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		logger.Error("config load", "err", err)
		os.Exit(1)
	}
	if cfg.Debug {
		debugBase := slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug})
		slog.SetDefault(slog.New(server.NewPasskeyMaskingHandler(debugBase)))
	}

	server.SetTrustProxy(os.Getenv("TRUST_PROXY") == "true")
	// Off by default — only honor CF-Connecting-IP behind a real Cloudflare
	// edge with ingress locked to Cloudflare's ranges (finding H2).
	server.SetTrustCFConnectingIP(os.Getenv("TRUST_CF_CONNECTING_IP") == "true")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Postgres
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("open postgres", "err", err)
		os.Exit(1)
	}
	defer pool.Close()
	logger.Info("postgres connected")

	// Redis
	rclient, err := peers.NewClientFromURL(cfg.RedisURL, cfg.RedisPassword)
	if err != nil {
		logger.Error("redis client", "err", err)
		os.Exit(1)
	}
	pingCtx, pingCancel := context.WithTimeout(ctx, 5*time.Second)
	if err := rclient.Ping(pingCtx).Err(); err != nil {
		pingCancel()
		logger.Error("redis ping", "err", err)
		os.Exit(1)
	}
	pingCancel()
	defer rclient.Close()
	logger.Info("redis connected")

	store := peers.New(rclient, cfg.RedisKeyPrefix, cfg.PeerTTL)
	database := db.New(pool)
	srv := server.New(ctx, database, rclient, store, cfg.RedisKeyPrefix, cfg.IPHashSecret, cfg.Debug, cfg.FederationSwarm)
	defer srv.Stop()

	addr := ":" + strconv.Itoa(cfg.HTTPPort)
	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
		// Cap headers + URL at 16 KB. Default in net/http is 1 MB —
		// way more than an announce ever needs (a typical request
		// header is < 2 KB, even with 64 info_hash params on
		// /scrape) and lets an attacker burn server allocator on
		// query-parsing into a `map[string][]string`.
		MaxHeaderBytes: 16 << 10,
	}

	// Start serving in a goroutine so we can wait for signals in main.
	go func() {
		logger.Info("tracker listening", "addr", addr)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("http server", "err", err)
			cancel()
		}
	}()

	// UDP frontend (BEP 15). Same business logic as HTTP — the UDP
	// server adapts BEP 15 binary packets into the wire-agnostic
	// `ProcessAnnounce` and lifts the passkey out of the BEP 41
	// URL_DATA option. Opt-in via `TRACKER_UDP_ENABLED` so HTTPS-only
	// deployments can keep the UDP listener off.
	var udpSrv *udp.Server
	if cfg.UDPEnabled {
		udpAddr := ":" + strconv.Itoa(cfg.UDPPort)
		var err error
		udpSrv, err = udp.New(udpAddr, cfg.IPHashSecret, srv, store)
		if err != nil {
			logger.Error("udp listen", "err", err)
			os.Exit(1)
		}
		go func() {
			logger.Info("tracker udp listening", "addr", udpAddr)
			if err := udpSrv.Serve(ctx); err != nil {
				logger.Error("udp server", "err", err)
				cancel()
			}
		}()
	} else {
		logger.Info("tracker udp disabled")
	}

	// Graceful shutdown on SIGTERM/SIGINT.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	select {
	case s := <-sig:
		logger.Info("shutting down", "signal", s.String())
	case <-ctx.Done():
		logger.Info("shutting down (context cancelled)")
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		logger.Error("http shutdown", "err", err)
	}
	// UDP has no in-flight connections to drain; closing the socket
	// makes the read loop exit on the next deadline tick.
	if udpSrv != nil {
		_ = udpSrv.Close()
	}
}

// runHealthcheck probes the local /health endpoint and returns
// the process exit code for the HEALTHCHECK directive.
//
// 0 = healthy (HTTP 200), 1 = anything else (network error,
// non-200 status, timeout). The /health handler already returns
// 503 when Postgres or Redis are down, so a single status-code
// check is enough.
//
// Reads the same env var the server uses for its listen port so a
// compose override of `TRACKER_HTTP_PORT` is honoured by the
// healthcheck without an extra knob.
func runHealthcheck() int {
	port := os.Getenv("TRACKER_HTTP_PORT")
	if port == "" {
		port = "8080"
	}
	url := "http://127.0.0.1:" + port + "/health"

	client := &http.Client{Timeout: 4 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

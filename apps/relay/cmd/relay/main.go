// Trackarr messaging relay.
//
// It fans out. That is the whole job, and the restraint is the design: the
// relay never writes, never decides, and holds no rule. Permissions, rate
// limits, moderation and every schema constraint live in the API, which is
// why this service can be read in one sitting and why it does not carry a
// second copy of a thousand lines of security logic.
//
// It exists because the fan-out competes for a thread of execution with
// whatever else is running there. At ten thousand people online — twenty
// thousand streams, and thousands of writes a second when the room is
// busy — that neighbour should not be the API serving uploads and
// announces.
//
// If this process is down, the site keeps working: private messages still
// send and read, they simply stop arriving live. That is deliberate. A
// relay that takes messaging with it when it falls would be worse than no
// relay.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/florianjs/trackarr/apps/relay/internal/config"
	"github.com/florianjs/trackarr/apps/relay/internal/hub"
	"github.com/florianjs/trackarr/apps/relay/internal/registry"
	"github.com/florianjs/trackarr/apps/relay/internal/sse"
)

/*
 * `relay healthcheck` — la même forme que `tracker healthcheck`.
 *
 * L'image tourne depuis `scratch` : ni shell, ni curl, ni wget. Un
 * `HEALTHCHECK` Docker n'avait donc aucun outil à invoquer, et le service
 * était le SEUL de la pile sans sonde côté conteneur — alors que le processus
 * expose `/healthz` et que le chart Helm, lui, le sonde. Un relais bloqué
 * n'était jamais redémarré pendant que Caddy continuait d'y router
 * `/messaging/events`.
 */
func runHealthcheck() int {
	addr := os.Getenv("RELAY_ADDR")
	if addr == "" {
		addr = ":4100"
	}
	// `RELAY_ADDR` peut valoir `:4100` ou `0.0.0.0:4100` ; on sonde toujours la
	// boucle locale, donc seul le port compte.
	port := addr[strings.LastIndex(addr, ":")+1:]
	client := &http.Client{Timeout: 4 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/healthz")
	if err != nil {
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(runHealthcheck())
	}

	static, err := config.LoadStatic()
	if err != nil {
		log.Fatalf("[relay] %v", err)
	}

	opts, err := redis.ParseURL(static.ValkeyURL)
	if err != nil {
		log.Fatalf("[relay] REDIS_URL: %v", err)
	}
	// A password given separately wins over anything embedded in the URL:
	// deployments set REDIS_PASSWORD, and the URL stays free of secrets.
	if static.ValkeyPass != "" {
		opts.Password = static.ValkeyPass
	}
	rdb := redis.NewClient(opts)
	defer rdb.Close()

	ctx, stop := signal.NotifyContext(context.Background(),
		os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("[relay] valkey unreachable: %v", err)
	}

	live := config.NewLive()
	h := hub.New(rdb, live)
	reg := registry.New(rdb, live, static, h.Count)

	go func() {
		if err := h.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("[relay] subscriber stopped: %v", err)
		}
	}()
	go reg.Heartbeat(ctx)
	go reg.Watch(ctx)

	mux := http.NewServeMux()
	events := &sse.Handler{
		Hub:         h,
		Live:        live,
		Secret:      static.TokenSecret,
		AllowOrigin: static.AllowOrigin,
		Heartbeat:   30 * time.Second,
	}
	mux.Handle("/events", events)
	// The same handler on the public path. Serving it here rather than
	// rewriting at the edge is what keeps one URL across Caddy, an Ingress
	// and a direct connection: every rewrite rule is controller-specific,
	// and getting one wrong fails as a 404 on a stream nobody watches.
	mux.Handle("/messaging/events", events)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := rdb.Ping(r.Context()).Err(); err != nil {
			http.Error(w, "valkey unreachable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	// Connections held, in the Prometheus text format the chart's
	// ServiceMonitor already scrapes.
	//
	// This is the metric the autoscaler needs, and the reason it is here
	// rather than left to CPU: ten thousand idle SSE connections cost
	// almost no CPU while filling the node completely. An HPA on CPU would
	// never fire, and the node would start refusing.
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		cfg := live.Get()
		_, _ = w.Write([]byte(
			"# HELP relay_connections Open SSE connections on this node.\n" +
				"# TYPE relay_connections gauge\n" +
				"relay_connections " + itoa(h.Count()) + "\n" +
				"# HELP relay_max_connections Ceiling this node was told to apply.\n" +
				"# TYPE relay_max_connections gauge\n" +
				"relay_max_connections " + itoa(int64(cfg.MaxConnections)) + "\n" +
				// > 0.1% of connections/min is the threshold the scaling
				// guide says to alert on: readers being cut is silent
				// otherwise, and it looks exactly like a flaky network.
				"# HELP relay_dropped_total Readers closed for falling behind.\n" +
				"# TYPE relay_dropped_total counter\n" +
				"relay_dropped_total " + itoa(h.Dropped()) + "\n" +
				// The trend that says whether a second surface — a room
				// dock, say — is affordable on this fleet.
				"# HELP relay_frames_total Frames written to readers.\n" +
				"# TYPE relay_frames_total counter\n" +
				"relay_frames_total " + itoa(h.Frames()) + "\n" +
				// Non-zero means the fleet is too small for its ceiling,
				// which is a different fault from readers being dropped.
				"# HELP relay_refused_total Connections refused at the ceiling.\n" +
				"# TYPE relay_refused_total counter\n" +
				"relay_refused_total " + itoa(h.Refused()) + "\n"))
	})

	srv := &http.Server{
		Addr:              static.Addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		// No WriteTimeout: these responses are meant to stay open. The
		// heartbeat is what detects a reader that went away.
	}

	go func() {
		log.Printf("[relay] node=%s listening on %s", static.NodeID, static.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("[relay] listen: %v", err)
		}
	}()

	<-ctx.Done()
	log.Printf("[relay] draining")
	// Give open streams a moment to end on their own. A relay that cuts
	// twenty thousand connections at once during a rolling update creates
	// exactly the reconnect storm the jittered client backoff exists to
	// avoid — no reason to cause one from this side.
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdown)
}

func itoa(v int64) string {
	if v == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	neg := v < 0
	if neg {
		v = -v
	}
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

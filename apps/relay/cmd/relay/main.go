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
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/florianjs/trackarr/apps/relay/internal/config"
	"github.com/florianjs/trackarr/apps/relay/internal/hub"
	"github.com/florianjs/trackarr/apps/relay/internal/registry"
	"github.com/florianjs/trackarr/apps/relay/internal/sse"
)

func main() {
	static, err := config.LoadStatic()
	if err != nil {
		log.Fatalf("[relay] %v", err)
	}

	opts, err := redis.ParseURL(static.ValkeyURL)
	if err != nil {
		log.Fatalf("[relay] REDIS_URL: %v", err)
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
	mux.Handle("/events", &sse.Handler{
		Hub:         h,
		Live:        live,
		Secret:      static.TokenSecret,
		AllowOrigin: static.AllowOrigin,
		Heartbeat:   30 * time.Second,
	})
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
				"relay_max_connections " + itoa(int64(cfg.MaxConnections)) + "\n"))
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

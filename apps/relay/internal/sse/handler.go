// Package sse turns a verified token into a stream of frames.
package sse

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/florianjs/trackarr/apps/relay/internal/config"
	"github.com/florianjs/trackarr/apps/relay/internal/hub"
	"github.com/florianjs/trackarr/apps/relay/internal/token"
)

// UserChannel is the one channel a member listens on.
//
// Per user, not per conversation: at this membership size the number of
// open conversations dwarfs the number of connected people, and a
// subscription per conversation would make the registry follow the wrong
// quantity. A message to a DM publishes to both participants' channels.
func UserChannel(userID string) string { return "messaging:user:" + userID }

type Handler struct {
	Hub    *hub.Hub
	Live   *config.Live
	Secret []byte
	// The browser opens this stream from the site's origin, which is not
	// the relay's. Without a matching CORS header it opens nothing at all.
	// An explicit origin rather than `*`, because the request carries a
	// bearer and a wildcard would let any page on the internet ask for one
	// on the reader's behalf.
	AllowOrigin string
	// Heartbeat keeps the connection warm through idle timeouts and, more
	// usefully, is how a node notices a reader that vanished without a
	// FIN — the write fails and the connection is reaped.
	Heartbeat time.Duration
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.AllowOrigin != "" {
		w.Header().Set("Access-Control-Allow-Origin", h.AllowOrigin)
		w.Header().Set("Vary", "Origin")
	}

	// The token rides in the query string because `EventSource` cannot set
	// a header. That is a real trade and worth naming: a URL ends up in
	// proxy logs. It is bounded by a short expiry rather than pretended
	// away — see the API side, which mints them minutes-long, not
	// hours-long.
	claims, err := token.Verify(r.URL.Query().Get("token"), h.Secret, time.Now())
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	ctx := r.Context()
	conn, admitted := h.Hub.Add(ctx, UserChannel(claims.UserID))
	if !admitted {
		// The node is full. 503 with Retry-After rather than a silent
		// hang, so the client backs off and lands on another node instead
		// of hammering this one.
		w.Header().Set("Retry-After", "2")
		http.Error(w, "node at capacity", http.StatusServiceUnavailable)
		return
	}
	defer h.Hub.Remove(conn)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	// Nginx and friends buffer text/event-stream by default, which turns a
	// live stream into a stream that arrives all at once, much later.
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	window := time.Duration(h.Live.Get().CoalesceWindowMs) * time.Millisecond
	batches := hub.Coalesce(ctx, conn.Out(), window)

	beat := time.NewTicker(h.Heartbeat)
	defer beat.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-conn.Done():
			return
		case batch, ok := <-batches:
			if !ok {
				return
			}
			// One frame per batch. The payload is always an array, even
			// for a single message, so the client has one shape to parse
			// rather than two.
			raw := make([]json.RawMessage, 0, len(batch))
			for _, m := range batch {
				raw = append(raw, json.RawMessage(m))
			}
			encoded, err := json.Marshal(raw)
			if err != nil {
				continue
			}
			if _, err := fmt.Fprintf(w, "data: %s\n\n", encoded); err != nil {
				return
			}
			flusher.Flush()
		case <-beat.C:
			// A comment line: valid SSE, ignored by EventSource, and the
			// cheapest thing that proves the socket is still there.
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

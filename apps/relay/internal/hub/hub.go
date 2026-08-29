// Package hub is the fan-out: one Valkey subscriber for the process, a
// registry of open connections, and the two behaviours that decide whether
// this holds up under load — bounded queues and coalescing.
package hub

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/florianjs/trackarr/apps/relay/internal/config"
)

// Conn is one open SSE stream.
//
// `out` is buffered and bounded, and that bound is the whole backpressure
// story: when a client stops draining, the queue fills and the connection
// is closed rather than fed. At twenty thousand connections a few hundred
// slow clients are enough to grow a process past anything it was sized
// for, and the alternative — letting the kernel buffer accumulate — turns
// a slow phone into an outage for everybody on that node.
//
// Closing is safe because it is repairable: the browser reconnects and
// asks the API for what it missed. A dropped client is an invisible
// incident; a fed one is a leak.
type Conn struct {
	Channel string
	out     chan []byte
	done    chan struct{}
	closeMu sync.Once
	dropped atomic.Bool
}

func (c *Conn) Out() <-chan []byte  { return c.out }
func (c *Conn) Done() <-chan struct{} { return c.done }
func (c *Conn) Dropped() bool       { return c.dropped.Load() }

func (c *Conn) close(dropped bool) {
	c.closeMu.Do(func() {
		if dropped {
			c.dropped.Store(true)
		}
		close(c.done)
	})
}

type Hub struct {
	rdb  *redis.Client
	live *config.Live

	mu    sync.RWMutex
	conns map[string]map[*Conn]struct{} // channel -> connections
	sub   *redis.PubSub

	count atomic.Int64
}

func New(rdb *redis.Client, live *config.Live) *Hub {
	return &Hub{
		rdb:   rdb,
		live:  live,
		conns: make(map[string]map[*Conn]struct{}),
	}
}

func (h *Hub) Count() int64 { return h.count.Load() }

// Run owns the single subscriber for this process.
//
// One connection to Valkey multiplexes every channel, so a publish costs
// O(nodes) rather than O(readers) — the fan-out to readers happens here,
// in this process, which is exactly why this process is not the API.
func (h *Hub) Run(ctx context.Context) error {
	h.sub = h.rdb.Subscribe(ctx)
	defer h.sub.Close()

	ch := h.sub.Channel(redis.WithChannelSize(1024))
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg, ok := <-ch:
			if !ok {
				return nil
			}
			h.dispatch(msg.Channel, []byte(msg.Payload))
		}
	}
}

func (h *Hub) dispatch(channel string, payload []byte) {
	h.mu.RLock()
	set := h.conns[channel]
	targets := make([]*Conn, 0, len(set))
	for c := range set {
		targets = append(targets, c)
	}
	h.mu.RUnlock()

	for _, c := range targets {
		select {
		case c.out <- payload:
		default:
			// The queue is full: this reader is not keeping up. Cut it
			// loose rather than block the dispatch loop — one slow client
			// must never delay everybody else on this node.
			c.close(true)
			h.Remove(c)
		}
	}
}

// Add registers a connection, subscribing to its channel if this node had
// no reader for it yet. Returns false when the node is at its ceiling.
func (h *Hub) Add(ctx context.Context, channel string) (*Conn, bool) {
	cfg := h.live.Get()
	if h.count.Load() >= int64(cfg.MaxConnections) {
		return nil, false
	}

	c := &Conn{
		Channel: channel,
		out:     make(chan []byte, cfg.QueueDepth),
		done:    make(chan struct{}),
	}

	h.mu.Lock()
	set, existed := h.conns[channel]
	if !existed {
		set = make(map[*Conn]struct{})
		h.conns[channel] = set
	}
	set[c] = struct{}{}
	h.mu.Unlock()

	if !existed {
		if err := h.sub.Subscribe(ctx, channel); err != nil {
			h.Remove(c)
			return nil, false
		}
	}
	h.count.Add(1)
	return c, true
}

// Remove unregisters a connection and unsubscribes the channel once the
// last reader for it is gone. Idempotent: dispatch may have removed a
// dropped connection before the handler notices.
func (h *Hub) Remove(c *Conn) {
	h.mu.Lock()
	set, ok := h.conns[c.Channel]
	if !ok {
		h.mu.Unlock()
		return
	}
	if _, present := set[c]; !present {
		h.mu.Unlock()
		return
	}
	delete(set, c)
	empty := len(set) == 0
	if empty {
		delete(h.conns, c.Channel)
	}
	h.mu.Unlock()

	h.count.Add(-1)
	c.close(false)
	if empty && h.sub != nil {
		_ = h.sub.Unsubscribe(context.Background(), c.Channel)
	}
}

// Coalesce batches whatever arrives inside one window into a single frame.
//
// At three messages a second in a room with fifteen hundred readers that
// is four and a half thousand writes a second, and ten times that at the
// peak. Batching does not reduce the bytes; it reduces the syscalls, which
// is the part that competes with everything else the process is doing.
//
// The first message of a quiet stretch goes out immediately — the window
// only ever groups a burst, so a one-to-one conversation never pays 150ms
// for a batching it does not need.
func Coalesce(ctx context.Context, in <-chan []byte, window time.Duration) <-chan [][]byte {
	out := make(chan [][]byte)
	go func() {
		defer close(out)
		for {
			var first []byte
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-in:
				if !ok {
					return
				}
				first = msg
			}

			batch := [][]byte{first}
			if window > 0 {
				timer := time.NewTimer(window)
			gather:
				for {
					select {
					case <-ctx.Done():
						timer.Stop()
						return
					case msg, ok := <-in:
						if !ok {
							timer.Stop()
							break gather
						}
						batch = append(batch, msg)
					case <-timer.C:
						break gather
					}
				}
			}

			select {
			case <-ctx.Done():
				return
			case out <- batch:
			}
		}
	}()
	return out
}

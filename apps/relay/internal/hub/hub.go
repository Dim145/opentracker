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
	// Every channel this connection listens on: always the member's own,
	// plus the room when the token allows it. A slice rather than one
	// string because the room is shared — the alternative is a second
	// connection per reader, and the browser caps those.
	Channels []string
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

	// Counters for the two numbers the scaling guide says to watch, and
	// that no other component can see: how many readers this node cut for
	// falling behind, and how many frames it wrote. Monotonic, so the
	// scrape only ever has to rate() them.
	dropped  atomic.Int64
	frames   atomic.Int64
	refused  atomic.Int64
}

func New(rdb *redis.Client, live *config.Live) *Hub {
	return &Hub{
		rdb:   rdb,
		live:  live,
		conns: make(map[string]map[*Conn]struct{}),
	}
}

func (h *Hub) Count() int64   { return h.count.Load() }
func (h *Hub) Dropped() int64 { return h.dropped.Load() }
func (h *Hub) Frames() int64  { return h.frames.Load() }
func (h *Hub) Refused() int64 { return h.refused.Load() }

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
			h.frames.Add(1)
		default:
			// The queue is full: this reader is not keeping up. Cut it
			// loose rather than block the dispatch loop — one slow client
			// must never delay everybody else on this node.
			h.dropped.Add(1)
			c.close(true)
			h.Remove(c)
		}
	}
}

// Add registers a connection on every channel it listens to, subscribing
// to any this node had no reader for yet. Returns false at the ceiling.
func (h *Hub) Add(ctx context.Context, channels ...string) (*Conn, bool) {
	cfg := h.live.Get()
	if h.count.Load() >= int64(cfg.MaxConnections) {
		h.refused.Add(1)
		return nil, false
	}

	c := &Conn{
		Channels: channels,
		out:      make(chan []byte, cfg.QueueDepth),
		done:     make(chan struct{}),
	}

	var fresh []string
	h.mu.Lock()
	for _, channel := range channels {
		set, existed := h.conns[channel]
		if !existed {
			set = make(map[*Conn]struct{})
			h.conns[channel] = set
			fresh = append(fresh, channel)
		}
		set[c] = struct{}{}
	}
	h.mu.Unlock()

	if len(fresh) > 0 {
		if err := h.sub.Subscribe(ctx, fresh...); err != nil {
			h.Remove(c)
			return nil, false
		}
	}
	h.count.Add(1)
	return c, true
}

// Remove unregisters a connection from every channel it held, and
// unsubscribes those whose last reader has gone. Idempotent: dispatch may
// have removed a dropped connection before the handler notices.
func (h *Hub) Remove(c *Conn) {
	var emptied []string
	present := false

	h.mu.Lock()
	for _, channel := range c.Channels {
		set, ok := h.conns[channel]
		if !ok {
			continue
		}
		if _, in := set[c]; !in {
			continue
		}
		present = true
		delete(set, c)
		if len(set) == 0 {
			delete(h.conns, channel)
			emptied = append(emptied, channel)
		}
	}
	h.mu.Unlock()

	if !present {
		return
	}

	h.count.Add(-1)
	c.close(false)
	if len(emptied) > 0 && h.sub != nil {
		_ = h.sub.Unsubscribe(context.Background(), emptied...)
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

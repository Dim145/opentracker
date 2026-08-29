package hub

import (
	"testing"

	"github.com/florianjs/trackarr/apps/relay/internal/config"
)

// A hub with no Valkey behind it. dispatch and Remove never touch the
// subscription unless a channel empties, and Remove guards that on nil, so
// the fan-out path is testable without a server.
func newTestHub(queueDepth int) *Hub {
	live := &config.Live{}
	d := config.Defaults()
	d.QueueDepth = queueDepth
	live.Set(d)
	return &Hub{
		live:  live,
		conns: make(map[string]map[*Conn]struct{}),
	}
}

func (h *Hub) addTestConn(channel string, depth int) *Conn {
	c := &Conn{
		Channels: []string{channel},
		out:      make(chan []byte, depth),
		done:     make(chan struct{}),
	}
	h.mu.Lock()
	h.conns[channel] = map[*Conn]struct{}{c: {}}
	h.mu.Unlock()
	h.count.Add(1)
	return c
}

// The behaviour the whole design rests on: a reader that stops draining is
// closed, not fed. Getting this backwards is invisible until one slow phone
// is holding a node's memory.
func TestDispatchDropsAReaderThatFillsItsQueue(t *testing.T) {
	h := newTestHub(1)
	c := h.addTestConn("messaging:user:u1", 1)

	h.dispatch("messaging:user:u1", []byte("first"))
	if got := h.Frames(); got != 1 {
		t.Fatalf("frames after one write = %d, want 1", got)
	}
	if c.Dropped() {
		t.Fatal("reader dropped while its queue still had room")
	}

	// Nothing has drained, so the queue is full.
	h.dispatch("messaging:user:u1", []byte("second"))

	if !c.Dropped() {
		t.Error("reader was fed past its queue instead of being closed")
	}
	if got := h.Dropped(); got != 1 {
		t.Errorf("dropped counter = %d, want 1", got)
	}
	if got := h.Frames(); got != 1 {
		t.Errorf("frames = %d, want 1 — the refused write must not count", got)
	}
	select {
	case <-c.Done():
	default:
		t.Error("done channel still open on a dropped reader")
	}
	if got := h.Count(); got != 0 {
		t.Errorf("count = %d, want 0 — a dropped reader must be unregistered", got)
	}
}

// The ceiling refuses; it never evicts. A node told to hold fewer than it
// already has keeps its readers and turns new ones away.
func TestAddRefusesAtTheCeilingWithoutEvicting(t *testing.T) {
	h := newTestHub(4)
	h.addTestConn("messaging:user:u1", 4)

	d := config.Defaults()
	d.MaxConnections = 1
	h.live.Set(d)

	if _, ok := h.Add(t.Context(), "messaging:user:u2"); ok {
		t.Error("accepted a connection at the ceiling")
	}
	if got := h.Refused(); got != 1 {
		t.Errorf("refused counter = %d, want 1", got)
	}
	if got := h.Count(); got != 1 {
		t.Errorf("count = %d, want 1 — the existing reader must survive", got)
	}
}

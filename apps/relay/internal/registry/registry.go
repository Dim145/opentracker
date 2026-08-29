// Package registry is how a variable-sized fleet configures itself.
//
// The requirement is one node on a small instance and eight or more on a
// large one, in Docker on a single machine as much as on Kubernetes across
// several. So the count cannot be a constant, and it cannot be an
// environment variable somebody has to keep in step on every node.
//
// The API still decides — it alone knows the connection target, the admin
// settings and the retention. What is inverted here is the direction of
// the connection: rather than the API reaching each node, each node writes
// a key with a TTL and the API publishes on a channel every node hears.
//
// Three practical consequences, and they are the reason for the shape:
//
//   - no inbound connectivity to the nodes is required, so this behaves
//     identically behind a single-machine Docker and inside a cluster;
//   - a dead node needs no health probe. Its key expires. There is no list
//     to clean and no ghost skewing the count;
//   - service discovery disappears. The API never needs to know WHERE the
//     nodes are, only how many.
package registry

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/florianjs/trackarr/apps/relay/internal/config"
)

const (
	KeyPrefix     = "messaging:node:"
	ConfigChannel = "messaging:config"
)

type Registry struct {
	rdb   *redis.Client
	live  *config.Live
	id    string
	ttl   time.Duration
	every time.Duration
	load  func() int64
}

func New(rdb *redis.Client, live *config.Live, s config.Static, load func() int64) *Registry {
	return &Registry{
		rdb:   rdb,
		live:  live,
		id:    s.NodeID,
		ttl:   s.RegisterTTL,
		every: s.RefreshEvery,
		load:  load,
	}
}

type heartbeat struct {
	Node        string `json:"node"`
	Connections int64  `json:"connections"`
	At          int64  `json:"at"`
}

// Heartbeat keeps this node's key alive.
//
// The refresh is driven from the same loop that reports the live
// connection count, so a node that has stopped serving stops claiming to
// exist. A heartbeat on an independent timer is worse than none: a wedged
// node that keeps refreshing skews the count DOWNWARD for everybody, since
// the API divides the target by a fleet size that includes a node serving
// nobody.
func (r *Registry) Heartbeat(ctx context.Context) {
	tick := time.NewTicker(r.every)
	defer tick.Stop()

	write := func() {
		payload, _ := json.Marshal(heartbeat{
			Node:        r.id,
			Connections: r.load(),
			At:          time.Now().Unix(),
		})
		_ = r.rdb.Set(ctx, KeyPrefix+r.id, payload, r.ttl).Err()
	}

	write()
	for {
		select {
		case <-ctx.Done():
			// Leave deliberately rather than wait for the TTL: a clean
			// shutdown should shrink the fleet at once so the survivors'
			// ceiling is recomputed upward before the reconnects land.
			_ = r.rdb.Del(context.WithoutCancel(ctx), KeyPrefix+r.id).Err()
			return
		case <-tick.C:
			write()
		}
	}
}

// Watch applies configuration published by the API.
//
// Nothing here refuses to serve when the channel is quiet: the node keeps
// whatever it last knew, and its built-in defaults before that.
func (r *Registry) Watch(ctx context.Context) {
	sub := r.rdb.Subscribe(ctx, ConfigChannel)
	defer sub.Close()

	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			var d config.Dynamic
			if err := json.Unmarshal([]byte(msg.Payload), &d); err != nil {
				continue
			}
			r.live.Set(d)
		}
	}
}

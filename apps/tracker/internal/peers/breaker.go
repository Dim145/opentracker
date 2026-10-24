package peers

import (
	"context"
	"errors"
	"net"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// ErrRedisUnavailable is what every command returns, without reaching Redis,
// while the breaker is open.
var ErrRedisUnavailable = errors.New("redis unavailable: circuit open")

const (
	// breakerCooldown is how long the breaker stays open before one command is
	// let through to probe.
	breakerCooldown = time.Second
	// breakerThreshold is how many timeouts in a row, with no reply from the
	// server in between, open it.
	breakerThreshold = 3
)

// breaker fails Redis commands at once while Redis cannot be reached.
//
// Finding out that Redis is down is what made an outage slow, more than the
// outage itself. Against a host that does not resolve or refuses connections,
// go-redis dials five times a hundred milliseconds apart and retries the
// command three times on top: two seconds per command. Against one that
// accepts connections and never answers, each command waits out its read
// timeout. An announce issues half a dozen commands, so the degraded mode
// (answer without a swarm rather than refuse) took one to five seconds per
// announce, and one that spent its whole deadline on Redis failed anyway on the
// Postgres query that came after.
//
// What opens it: a connection refused or a host that does not resolve, at
// once — go-redis has already made some twenty attempts before it reports one —
// or `breakerThreshold` timeouts in a row. Any reply from the server resets the count, whatever it says:
// redis.Nil, WRONGTYPE and a wrong password all prove Redis is up. So a latency
// spike, where timeouts come between successes, does not turn into a second of
// degraded announces, while a Redis that accepts connections and never answers
// still opens it. A caller that gave up (context.Canceled), or whose deadline
// had passed before the command even started, says nothing about Redis and is
// not counted.
//
// Open, a command fails without touching the connection pool. After
// `breakerCooldown`, one command at a time goes through as a probe; a reply
// closes the breaker, a failure keeps it open for another cooldown.
type breaker struct {
	cooldown  time.Duration
	threshold int32
	timeouts  atomic.Int32
	openUntil atomic.Int64 // unix nanoseconds; 0 when closed
	probing   atomic.Bool
}

func newBreaker() *breaker {
	return &breaker{cooldown: breakerCooldown, threshold: breakerThreshold}
}

// admit reports whether a command may go to Redis, and whether it is the probe.
func (b *breaker) admit(now time.Time) (ok, probe bool) {
	until := b.openUntil.Load()
	if until == 0 {
		return true, false
	}
	if now.UnixNano() < until {
		return false, false
	}
	if b.probing.CompareAndSwap(false, true) {
		return true, true
	}
	return false, false
}

func (b *breaker) record(err error, probe bool) {
	switch classify(err) {
	case replied:
		b.timeouts.Store(0)
		if b.openUntil.Load() != 0 {
			b.openUntil.Store(0)
		}
	case unreachable:
		b.open()
	case timedOut:
		if b.timeouts.Add(1) >= b.threshold || probe {
			b.open()
		}
	}
}

func (b *breaker) open() {
	b.openUntil.Store(time.Now().Add(b.cooldown).UnixNano())
}

// admittedKey marks the context of a command the breaker let through.
type admittedKey struct{}

// do runs one command, or one pipeline, through the breaker.
//
// A command go-redis issues while serving one already admitted belongs to it:
// the handshake of a connection it opens — HELLO, AUTH, CLIENT SETINFO — runs
// through the same hooks, with the same context. Refusing it kept the probe,
// the one command allowed through an open breaker, from ever connecting: the
// breaker never closed again. Counting it would count one failure twice.
func (b *breaker) do(ctx context.Context, run func(context.Context) error, refuse func()) error {
	if ctx.Value(admittedKey{}) != nil {
		return run(ctx)
	}
	ok, probe := b.admit(time.Now())
	if !ok {
		refuse()
		return ErrRedisUnavailable
	}
	if probe {
		defer b.probing.Store(false)
	}
	inner := context.WithValue(ctx, admittedKey{}, struct{}{})
	if ctx.Err() != nil {
		return run(inner)
	}
	err := run(inner)
	b.record(err, probe)
	return err
}

type outcome int

const (
	inconclusive outcome = iota
	replied
	unreachable
	timedOut
)

func classify(err error) outcome {
	if err == nil {
		return replied
	}
	var rerr redis.Error // a reply from the server, redis.Nil included
	if errors.As(err, &rerr) {
		return replied
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, ErrRedisUnavailable) {
		return inconclusive
	}
	// A deadline that fell while the command was under way, whoever set it. A
	// connection attempt that timed out lands here too: it may only mean the
	// caller had little time left. go-redis also reports the caller's deadline
	// as such when it falls in a pause between two attempts, even when the
	// attempt before it was refused.
	var op *net.OpError
	isOp := errors.As(err, &op)
	if errors.Is(err, context.DeadlineExceeded) || (isOp && op.Timeout()) {
		return timedOut
	}
	// Refused, unresolvable, unroutable: Redis is not there.
	if isOp && op.Op == "dial" {
		return unreachable
	}
	return inconclusive
}

func (b *breaker) DialHook(next redis.DialHook) redis.DialHook { return next }

func (b *breaker) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		return b.do(ctx,
			func(ctx context.Context) error { return next(ctx, cmd) },
			func() { cmd.SetErr(ErrRedisUnavailable) })
	}
}

func (b *breaker) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		return b.do(ctx,
			func(ctx context.Context) error { return next(ctx, cmds) },
			func() {
				for _, cmd := range cmds {
					cmd.SetErr(ErrRedisUnavailable)
				}
			})
	}
}

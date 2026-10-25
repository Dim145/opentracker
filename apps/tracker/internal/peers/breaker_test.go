package peers

import (
	"context"
	"errors"
	"net"
	"os"
	"syscall"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

var (
	errRefused = &net.OpError{Op: "dial", Net: "tcp",
		Err: os.NewSyscallError("connect", syscall.ECONNREFUSED)}
	errReadTimeout = &net.OpError{Op: "read", Net: "tcp", Err: os.ErrDeadlineExceeded}
)

func TestClassify(t *testing.T) {
	mr := miniredis.RunT(t)
	c := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer c.Close()
	ctx := context.Background()
	if err := c.HSet(ctx, "h", "f", "v").Err(); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name string
		err  error
		want outcome
	}{
		{"success", nil, replied},
		{"redis.Nil", c.Get(ctx, "missing").Err(), replied},
		{"WRONGTYPE", c.Get(ctx, "h").Err(), replied},
		{"connection refused", errRefused, unreachable},
		{"no such host", &net.OpError{Op: "dial", Net: "tcp",
			Err: &net.DNSError{Err: "no such host", Name: "redis", IsNotFound: true}}, unreachable},
		{"dial timeout", &net.OpError{Op: "dial", Net: "tcp", Err: os.ErrDeadlineExceeded}, timedOut},
		{"read timeout", errReadTimeout, timedOut},
		{"caller deadline", context.DeadlineExceeded, timedOut},
		{"caller gave up", context.Canceled, inconclusive},
		{"connection reset", &net.OpError{Op: "read", Net: "tcp",
			Err: os.NewSyscallError("read", syscall.ECONNRESET)}, inconclusive},
		{"breaker open", ErrRedisUnavailable, inconclusive},
	} {
		if got := classify(tc.err); got != tc.want {
			t.Errorf("%s (%v): got %d, want %d", tc.name, tc.err, got, tc.want)
		}
	}
}

// call runs one fake command through the breaker and reports whether it
// reached "Redis".
func call(b *breaker, ctx context.Context, result error) (reached bool, err error) {
	err = b.do(ctx, func(context.Context) error { reached = true; return result }, func() {})
	return reached, err
}

func TestBreaker_TimeoutsOpenItOnlyInARow(t *testing.T) {
	b := &breaker{cooldown: time.Hour, threshold: 3}
	ctx := context.Background()
	call(b, ctx, errReadTimeout)
	call(b, ctx, errReadTimeout)
	call(b, ctx, nil) // a reply in between: a latency spike, not an outage
	call(b, ctx, errReadTimeout)
	call(b, ctx, errReadTimeout)
	if reached, _ := call(b, ctx, errReadTimeout); !reached {
		t.Fatal("two timeouts after a reply opened the breaker")
	}
	if reached, err := call(b, ctx, nil); reached || !errors.Is(err, ErrRedisUnavailable) {
		t.Fatalf("three timeouts in a row: reached=%v err=%v, want refused", reached, err)
	}
}

func TestBreaker_RefusedOpensItAtOnceAndAProbeClosesIt(t *testing.T) {
	const cooldown = 30 * time.Millisecond
	b := &breaker{cooldown: cooldown, threshold: 3}
	ctx := context.Background()

	call(b, ctx, errRefused)
	if reached, err := call(b, ctx, nil); reached || !errors.Is(err, ErrRedisUnavailable) {
		t.Fatalf("after a refused connection: reached=%v err=%v, want refused", reached, err)
	}

	// After the cooldown, one probe at a time.
	time.Sleep(cooldown + 10*time.Millisecond)
	release := make(chan error)
	probeDone := make(chan error)
	go func() {
		probeDone <- b.do(ctx, func(context.Context) error { return <-release }, func() {})
	}()
	deadline := time.Now().Add(time.Second)
	for !b.probing.Load() {
		if time.Now().After(deadline) {
			t.Fatal("the probe never started")
		}
		time.Sleep(time.Millisecond)
	}
	if reached, _ := call(b, ctx, nil); reached {
		t.Fatal("a second command went through while the probe was in flight")
	}
	release <- errRefused
	<-probeDone
	if reached, _ := call(b, ctx, nil); reached {
		t.Fatal("a failed probe did not keep the breaker open")
	}

	time.Sleep(cooldown + 10*time.Millisecond)
	if reached, err := call(b, ctx, redis.Nil); !reached || !errors.Is(err, redis.Nil) {
		t.Fatalf("probe: reached=%v err=%v", reached, err)
	}
	for i := 0; i < 3; i++ {
		if reached, _ := call(b, ctx, nil); !reached {
			t.Fatalf("command %d refused after a probe got a reply", i)
		}
	}
}

// go-redis opens the probe's connection with a handshake that runs through the
// same hooks: refused, it kept every probe from connecting, and the breaker,
// once open, never closed again.
func TestBreaker_LetsThroughWhatAnAdmittedCommandIssues(t *testing.T) {
	const cooldown = 10 * time.Millisecond
	b := &breaker{cooldown: cooldown, threshold: 3}
	ctx := context.Background()
	call(b, ctx, errRefused)
	time.Sleep(cooldown + 5*time.Millisecond)

	nested := false
	err := b.do(ctx, func(inner context.Context) error {
		// the probe, opening its connection
		return b.do(inner, func(context.Context) error { nested = true; return nil }, func() {})
	}, func() {})
	if err != nil || !nested {
		t.Fatalf("the probe's handshake: nested=%v err=%v", nested, err)
	}
	if reached, _ := call(b, ctx, nil); !reached {
		t.Fatal("the breaker did not close after the probe connected")
	}
}

func TestBreaker_IgnoresTheCallersOwnContext(t *testing.T) {
	b := &breaker{cooldown: time.Hour, threshold: 3}
	expired, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	for i := 0; i < 10; i++ {
		// A deadline already gone before the command started: Postgres ate the
		// announce's budget, Redis did nothing wrong.
		call(b, expired, context.DeadlineExceeded)
		call(b, context.Background(), context.Canceled)
	}
	if reached, _ := call(b, context.Background(), nil); !reached {
		t.Fatal("the callers' own contexts opened the breaker")
	}
}

// The client the tracker builds: once Redis is gone, the first command finds
// out the slow way and every one after it fails at once, pipelines included;
// once it is back, the first probe after the cooldown closes the breaker.
func TestNewClientFromURL_FailsFastWhileRedisIsGone(t *testing.T) {
	mr := miniredis.RunT(t)
	c, err := NewClientFromURL("redis://"+mr.Addr(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	ctx := context.Background()
	if err := c.Set(ctx, "k", "v", 0).Err(); err != nil {
		t.Fatal(err)
	}

	mr.Close()
	if err := c.Get(ctx, "k").Err(); err == nil {
		t.Fatal("GET succeeded against a closed server")
	}
	start := time.Now()
	for i := 0; i < 50; i++ {
		if err := c.Get(ctx, "k").Err(); !errors.Is(err, ErrRedisUnavailable) {
			t.Fatalf("GET %d: %v, want ErrRedisUnavailable", i, err)
		}
	}
	_, err = c.Pipelined(ctx, func(p redis.Pipeliner) error {
		p.Get(ctx, "k")
		p.Incr(ctx, "n")
		return nil
	})
	if !errors.Is(err, ErrRedisUnavailable) {
		t.Fatalf("pipeline: %v, want ErrRedisUnavailable", err)
	}
	if d := time.Since(start); d > 200*time.Millisecond {
		t.Fatalf("fifty-one refused commands took %v", d)
	}

	if err := mr.Restart(); err != nil {
		t.Fatal(err)
	}
	time.Sleep(breakerCooldown + 100*time.Millisecond)
	if v, err := c.Get(ctx, "k").Result(); err != nil || v != "v" {
		t.Fatalf("after the restart: %q, %v", v, err)
	}
}

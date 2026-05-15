package server

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
)

// newTestLogger returns a logger that writes JSON into a buffer
// behind the passkey-masking handler. Tests assert against the
// captured bytes.
func newTestLogger() (*slog.Logger, *bytes.Buffer) {
	var buf bytes.Buffer
	inner := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	h := NewPasskeyMaskingHandler(inner)
	return slog.New(h), &buf
}

// ----------------------------------------------------------------------------
// redactString
// ----------------------------------------------------------------------------

func TestRedactString_MasksLongHexRun(t *testing.T) {
	in := "passkey=abcdef0123456789abcdef0123456789 logged"
	out := redactString(in)
	if strings.Contains(out, "abcdef0123456789") {
		t.Fatalf("hex run leaked: %q", out)
	}
	if !strings.Contains(out, "***passkey***") {
		t.Fatalf("expected mask placeholder: %q", out)
	}
}

func TestRedactString_PreservesNonHex(t *testing.T) {
	in := "regular log message, no secret"
	if got := redactString(in); got != in {
		t.Fatalf("non-hex string mutated: %q -> %q", in, got)
	}
}

func TestRedactString_PreservesShortHex(t *testing.T) {
	// 31 hex chars — below the 32-char floor.
	in := "id=abcdef0123456789abcdef012345678"
	if got := redactString(in); got != in {
		t.Fatalf("short hex unexpectedly masked: %q", got)
	}
}

func TestRedactString_EmptyStays(t *testing.T) {
	if got := redactString(""); got != "" {
		t.Fatalf("empty string mutated: %q", got)
	}
}

// ----------------------------------------------------------------------------
// Handler — full record path
// ----------------------------------------------------------------------------

func TestHandler_MasksPasskeyInMessage(t *testing.T) {
	logger, buf := newTestLogger()
	logger.Info("user announced with passkey=abcdef0123456789abcdef0123456789")
	out := buf.String()
	if strings.Contains(out, "abcdef0123456789abcdef0123456789") {
		t.Fatalf("passkey leaked into message: %s", out)
	}
}

func TestHandler_MasksPasskeyInAttrs(t *testing.T) {
	logger, buf := newTestLogger()
	logger.Info("announce", "url_data", "/announce/abcdef0123456789abcdef0123456789")
	out := buf.String()
	if strings.Contains(out, "abcdef0123456789abcdef0123456789") {
		t.Fatalf("passkey leaked: %s", out)
	}
	if !strings.Contains(out, "***passkey***") {
		t.Fatalf("mask not applied: %s", out)
	}
}

// info_hash, peer_id, ip_hash are whitelisted because they're
// debugging-essential and not credentials.
func TestHandler_AllowsWhitelistedAttrs(t *testing.T) {
	logger, buf := newTestLogger()
	hash := "abcdef0123456789abcdef0123456789abcdef01" // 40 hex
	logger.Info("test", "info_hash", hash)
	if !strings.Contains(buf.String(), hash) {
		t.Fatalf("whitelisted info_hash got masked: %s", buf.String())
	}
}

// Errors stringify into structured slog values; the masker must
// still descend into them.
func TestHandler_MasksErrorValues(t *testing.T) {
	logger, buf := newTestLogger()
	logger.Info("call failed",
		"err", errors.New("query failed: passkey=abcdef0123456789abcdef0123456789"))
	if strings.Contains(buf.String(), "abcdef0123456789abcdef0123456789") {
		t.Fatalf("error value leaked passkey: %s", buf.String())
	}
}

func TestHandler_GroupAttrsAreMasked(t *testing.T) {
	logger, buf := newTestLogger()
	g := slog.Group("auth",
		slog.String("attempt", "passkey=abcdef0123456789abcdef0123456789"),
	)
	logger.Info("login attempt", g)
	if strings.Contains(buf.String(), "abcdef0123456789abcdef0123456789") {
		t.Fatalf("group attr leaked passkey: %s", buf.String())
	}
}

// WithAttrs / WithGroup return new handlers that should still mask.
func TestHandler_WithAttrsStillMasks(t *testing.T) {
	logger, buf := newTestLogger()
	scoped := logger.With("requestId", "rid")
	scoped.Info("done", "tag", "passkey=abcdef0123456789abcdef0123456789")
	if strings.Contains(buf.String(), "abcdef0123456789abcdef0123456789") {
		t.Fatalf("scoped logger leaked passkey: %s", buf.String())
	}
}

func TestHandler_WithGroupStillMasks(t *testing.T) {
	logger, buf := newTestLogger()
	scoped := logger.WithGroup("grp")
	scoped.Info("inside", "v", "passkey=abcdef0123456789abcdef0123456789")
	if strings.Contains(buf.String(), "abcdef0123456789abcdef0123456789") {
		t.Fatalf("grouped logger leaked passkey: %s", buf.String())
	}
}

// Enabled delegates to the inner handler.
func TestHandler_EnabledDelegates(t *testing.T) {
	logger, _ := newTestLogger()
	h := logger.Handler()
	if !h.Enabled(context.Background(), slog.LevelInfo) {
		t.Fatal("expected Info to be enabled by default")
	}
}

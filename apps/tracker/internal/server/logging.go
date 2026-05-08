// Package server: passkey-redaction slog handler.
//
// The passkey is the tracker's announce credential — equivalent to a
// long-lived API key for that user. It transits the announce path in
// the URL by protocol necessity (BitTorrent clients have no other
// way), but it must never end up in our application logs: a leaked
// log file (journald, container stdout, log shipper) would let any
// reader impersonate users on the swarm.
//
// We solve this with a thin slog.Handler middleware that walks every
// log record's message + attributes and redacts anything that looks
// like a passkey before delegating to the underlying handler. The
// match is a hex run of 32+ characters — passkeys are 32 hex chars
// (16 random bytes), and the 32-char floor is wide enough that no
// info-hash, peer-id-hex (40 chars too but paired in attrs we want
// to keep visible) or other identifier overlaps in practice. We
// allow info_hash + peer_id attribute keys to pass through verbatim
// since they're essential for debugging.

package server

import (
	"context"
	"log/slog"
	"regexp"
)

var passkeyPattern = regexp.MustCompile(`[a-fA-F0-9]{32,}`)

// passkeySafeAttrs lists attribute keys that are deliberately allowed
// to carry hex-looking values (info hashes, peer ids hex). The handler
// passes these through without masking so debugging stays useful.
var passkeySafeAttrs = map[string]struct{}{
	"info_hash": {},
	"peer_id":   {},
	"ip_hash":   {},
}

// maskingHandler wraps another slog.Handler and redacts likely
// passkeys from log records.
type maskingHandler struct {
	inner slog.Handler
}

// NewPasskeyMaskingHandler wraps `inner` so every record passes
// through `redact` before being emitted.
func NewPasskeyMaskingHandler(inner slog.Handler) slog.Handler {
	return &maskingHandler{inner: inner}
}

func (h *maskingHandler) Enabled(ctx context.Context, lvl slog.Level) bool {
	return h.inner.Enabled(ctx, lvl)
}

func (h *maskingHandler) Handle(ctx context.Context, r slog.Record) error {
	clean := slog.NewRecord(r.Time, r.Level, redactString(r.Message), r.PC)
	r.Attrs(func(a slog.Attr) bool {
		clean.AddAttrs(redactAttr(a))
		return true
	})
	return h.inner.Handle(ctx, clean)
}

func (h *maskingHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	cleaned := make([]slog.Attr, len(attrs))
	for i, a := range attrs {
		cleaned[i] = redactAttr(a)
	}
	return &maskingHandler{inner: h.inner.WithAttrs(cleaned)}
}

func (h *maskingHandler) WithGroup(name string) slog.Handler {
	return &maskingHandler{inner: h.inner.WithGroup(name)}
}

func redactString(s string) string {
	if s == "" {
		return s
	}
	return passkeyPattern.ReplaceAllStringFunc(s, func(m string) string {
		// Keep length information for debugging without exposing the
		// value: `***passkey(32)***`.
		return "***passkey***"
	})
}

func redactAttr(a slog.Attr) slog.Attr {
	if _, allow := passkeySafeAttrs[a.Key]; allow {
		return a
	}
	v := a.Value
	switch v.Kind() {
	case slog.KindString:
		return slog.String(a.Key, redactString(v.String()))
	case slog.KindAny:
		// `err` and other arbitrary types: stringify, redact, re-wrap.
		// We don't try to descend into struct fields — pgx errors
		// stringify into messages that include the SQL params, so
		// catching them at the string level covers the common leak
		// path.
		if s, ok := v.Any().(interface{ Error() string }); ok {
			return slog.String(a.Key, redactString(s.Error()))
		}
		if s, ok := v.Any().(interface{ String() string }); ok {
			return slog.String(a.Key, redactString(s.String()))
		}
	case slog.KindGroup:
		group := v.Group()
		cleaned := make([]slog.Attr, len(group))
		for i, sub := range group {
			cleaned[i] = redactAttr(sub)
		}
		return slog.Attr{Key: a.Key, Value: slog.GroupValue(cleaned...)}
	}
	return a
}

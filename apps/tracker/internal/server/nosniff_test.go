package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Every response of the tracker's own mux carries nosniff, the bencoded
// failures included, whatever sits (or does not) in front of it.
func TestNoSniff_SetOnEveryResponse(t *testing.T) {
	h := noSniff(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("d14:failure reason15:Invalid passkeye"))
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/announce", nil))
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}
	if got := rec.Header().Get("Content-Type"); got != "text/plain; charset=utf-8" {
		t.Fatalf("the handler's own Content-Type was lost: %q", got)
	}
}

// And Routes() is what puts it there. A scrape without a passkey is refused
// before the database or Redis is touched, and with a plain Write: a 404 would
// prove nothing, http.Error setting nosniff on its own.
func TestRoutes_WrapsTheMuxInNoSniff(t *testing.T) {
	rec := httptest.NewRecorder()
	(&Server{}).Routes().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/scrape", nil))
	if body := rec.Body.String(); !strings.Contains(body, "failure reason") {
		t.Fatalf("body = %q, want a bencoded failure", body)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}
}

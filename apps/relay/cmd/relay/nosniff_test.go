package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Le relais pose nosniff lui-même, sans compter sur ce qui le précède.
func TestNoSniff_SetOnEveryResponse(t *testing.T) {
	h := noSniff(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/messaging/events", nil))
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}
	if got := rec.Header().Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("le Content-Type du handler a été perdu : %q", got)
	}
}

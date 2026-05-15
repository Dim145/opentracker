package server

import (
	"net/http/httptest"
	"testing"
)

// TestClientIP_PrefersCFConnectingIP — Cloudflare's authoritative
// header trumps everything else when TRUST_PROXY is on. Without
// this, a CF Argo Tunnel / Spectrum deployment ends up writing the
// tunnel's `2400:cb00:…` IPv6 into the swarm instead of the peer's
// real address.
func TestClientIP_PrefersCFConnectingIP(t *testing.T) {
	SetTrustProxy(true)
	defer SetTrustProxy(false)

	s := &Server{}
	r := httptest.NewRequest("GET", "/announce", nil)
	r.Header.Set("CF-Connecting-IP", "203.0.113.42")
	r.Header.Set("X-Forwarded-For", "10.0.0.1, 2400:cb00:1::1")
	r.Header.Set("X-Real-IP", "192.0.2.99")
	r.RemoteAddr = "172.18.0.5:54321"

	got := s.clientIP(r)
	if got != "203.0.113.42" {
		t.Fatalf("clientIP: got %q, want 203.0.113.42 (CF-Connecting-IP)", got)
	}
}

func TestClientIP_FallsBackToXFFRightmost(t *testing.T) {
	SetTrustProxy(true)
	defer SetTrustProxy(false)

	s := &Server{}
	r := httptest.NewRequest("GET", "/announce", nil)
	r.Header.Set("X-Forwarded-For", "10.0.0.1, 203.0.113.42")
	r.RemoteAddr = "172.18.0.5:54321"

	got := s.clientIP(r)
	if got != "203.0.113.42" {
		t.Fatalf("clientIP: got %q, want 203.0.113.42 (XFF rightmost)", got)
	}
}

func TestClientIP_FallsBackToXRealIP(t *testing.T) {
	SetTrustProxy(true)
	defer SetTrustProxy(false)

	s := &Server{}
	r := httptest.NewRequest("GET", "/announce", nil)
	r.Header.Set("X-Real-IP", "203.0.113.42")
	r.RemoteAddr = "172.18.0.5:54321"

	got := s.clientIP(r)
	if got != "203.0.113.42" {
		t.Fatalf("clientIP: got %q, want 203.0.113.42 (X-Real-IP)", got)
	}
}

func TestClientIP_FallsBackToRemoteAddr(t *testing.T) {
	SetTrustProxy(true)
	defer SetTrustProxy(false)

	s := &Server{}
	r := httptest.NewRequest("GET", "/announce", nil)
	r.RemoteAddr = "203.0.113.42:54321"

	got := s.clientIP(r)
	if got != "203.0.113.42" {
		t.Fatalf("clientIP: got %q, want 203.0.113.42 (RemoteAddr)", got)
	}
}

func TestClientIP_IgnoresProxyHeadersWhenTrustProxyOff(t *testing.T) {
	SetTrustProxy(false)

	s := &Server{}
	r := httptest.NewRequest("GET", "/announce", nil)
	r.Header.Set("CF-Connecting-IP", "1.2.3.4")
	r.Header.Set("X-Forwarded-For", "1.2.3.4")
	r.RemoteAddr = "203.0.113.42:54321"

	got := s.clientIP(r)
	if got != "203.0.113.42" {
		t.Fatalf("clientIP: got %q, want 203.0.113.42 (RemoteAddr — proxy headers ignored)", got)
	}
}

func TestClientIP_RejectsMalformedCFHeader(t *testing.T) {
	SetTrustProxy(true)
	defer SetTrustProxy(false)

	s := &Server{}
	r := httptest.NewRequest("GET", "/announce", nil)
	r.Header.Set("CF-Connecting-IP", "not-an-ip")
	r.Header.Set("X-Forwarded-For", "203.0.113.42")
	r.RemoteAddr = "172.18.0.5:54321"

	got := s.clientIP(r)
	if got != "203.0.113.42" {
		t.Fatalf("clientIP: got %q, want 203.0.113.42 (CF malformed → fall through to XFF)", got)
	}
}

func TestClientIP_IPv6InCFConnectingIP(t *testing.T) {
	SetTrustProxy(true)
	defer SetTrustProxy(false)

	s := &Server{}
	r := httptest.NewRequest("GET", "/announce", nil)
	r.Header.Set("CF-Connecting-IP", "2001:db8::1")
	r.RemoteAddr = "172.18.0.5:54321"

	got := s.clientIP(r)
	if got != "2001:db8::1" {
		t.Fatalf("clientIP: got %q, want 2001:db8::1 (IPv6 via CF header)", got)
	}
}

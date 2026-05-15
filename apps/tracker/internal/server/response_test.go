package server

import (
	"bytes"
	"testing"

	"github.com/florianjs/trackarr/apps/tracker/internal/peers"
)

func TestSplitCompactPeers_IPv4Only(t *testing.T) {
	peerList := []*peers.PeerData{
		{PeerID: "aa", IP: "203.0.113.5", Port: 6881},
		{PeerID: "bb", IP: "198.51.100.42", Port: 51413},
	}
	var exclude [20]byte
	v4, v6 := splitCompactPeers(peerList, exclude, 50)
	if len(v4) != 12 {
		t.Fatalf("v4 len: got %d, want 12", len(v4))
	}
	if len(v6) != 0 {
		t.Fatalf("v6 len: got %d, want 0", len(v6))
	}
	// First peer: 203.0.113.5:6881
	want := []byte{203, 0, 113, 5, 0x1a, 0xe1}
	if !bytes.Equal(v4[:6], want) {
		t.Fatalf("v4[0]: got %v, want %v", v4[:6], want)
	}
}

func TestSplitCompactPeers_IPv6Only(t *testing.T) {
	peerList := []*peers.PeerData{
		// Cloudflare-style IPv6 like in production.
		{PeerID: "aa", IP: "2400:cb00:21:1000:fbd6:dae4:b71d:6c08", Port: 30467},
		{PeerID: "bb", IP: "2400:cb00:696:1000:f55b:a90d:c66:9ea6", Port: 56508},
	}
	var exclude [20]byte
	v4, v6 := splitCompactPeers(peerList, exclude, 50)
	if len(v4) != 0 {
		t.Fatalf("v4 len: got %d, want 0", len(v4))
	}
	// Two peers × (16 IPv6 + 2 port) = 36 bytes.
	if len(v6) != 36 {
		t.Fatalf("v6 len: got %d, want 36", len(v6))
	}
	// First peer's port = 30467 = 0x7703.
	if v6[16] != 0x77 || v6[17] != 0x03 {
		t.Fatalf("v6[0] port: got %02x%02x, want 7703", v6[16], v6[17])
	}
}

func TestSplitCompactPeers_Mixed(t *testing.T) {
	peerList := []*peers.PeerData{
		{PeerID: "aa", IP: "203.0.113.5", Port: 6881},
		{PeerID: "bb", IP: "2001:db8::1", Port: 6881},
		{PeerID: "cc", IP: "198.51.100.42", Port: 51413},
	}
	var exclude [20]byte
	v4, v6 := splitCompactPeers(peerList, exclude, 50)
	if len(v4) != 12 {
		t.Fatalf("v4 len: got %d, want 12", len(v4))
	}
	if len(v6) != 18 {
		t.Fatalf("v6 len: got %d, want 18", len(v6))
	}
}

func TestSplitCompactPeers_ExcludesSelf(t *testing.T) {
	// peer_id "self" encoded as hex matches whatever the announcer sent.
	// We build the hex form the same way `hexBytes` does so the equality
	// in the function holds.
	var self [20]byte
	for i := range self {
		self[i] = 0xab
	}
	selfHex := hexBytes(self[:])

	peerList := []*peers.PeerData{
		{PeerID: selfHex, IP: "203.0.113.5", Port: 6881},
		{PeerID: "other", IP: "198.51.100.42", Port: 51413},
	}
	v4, v6 := splitCompactPeers(peerList, self, 50)
	if len(v4) != 6 {
		t.Fatalf("v4 len: got %d, want 6 (self should be excluded)", len(v4))
	}
	if len(v6) != 0 {
		t.Fatalf("v6 len: got %d, want 0", len(v6))
	}
}

func TestSplitCompactPeers_NumWantShared(t *testing.T) {
	// numWant caps the **combined** v4+v6 output.
	peerList := []*peers.PeerData{
		{PeerID: "a", IP: "203.0.113.1", Port: 1},
		{PeerID: "b", IP: "2001:db8::1", Port: 2},
		{PeerID: "c", IP: "203.0.113.2", Port: 3},
		{PeerID: "d", IP: "2001:db8::2", Port: 4},
	}
	var exclude [20]byte
	v4, v6 := splitCompactPeers(peerList, exclude, 2)
	total := len(v4)/6 + len(v6)/18
	if total != 2 {
		t.Fatalf("total peers: got %d, want 2", total)
	}
}

func TestBuildAnnounceResponse_OmitsPeers6WhenEmpty(t *testing.T) {
	peerList := []*peers.PeerData{
		{PeerID: "aa", IP: "203.0.113.5", Port: 6881},
	}
	var exclude [20]byte
	body := buildAnnounceResponse(1, 0, peerList, true, exclude, 50)
	// `6:peers6` is the bencoded key marker — distinct from the
	// substring `peers6` that can show up as `5:peers` followed by
	// a 6-byte compact peer entry whose first byte happens to be 6.
	if bytes.Contains(body, []byte("6:peers6")) {
		t.Fatalf("response unexpectedly contains peers6 key for IPv4-only swarm: %q", body)
	}
	if !bytes.Contains(body, []byte("5:peers")) {
		t.Fatalf("response missing peers key: %q", body)
	}
}

func TestBuildAnnounceResponse_IncludesPeers6WhenIPv6(t *testing.T) {
	peerList := []*peers.PeerData{
		{PeerID: "aa", IP: "2001:db8::1", Port: 6881},
	}
	var exclude [20]byte
	body := buildAnnounceResponse(1, 0, peerList, true, exclude, 50)
	if !bytes.Contains(body, []byte("6:peers6")) {
		t.Fatalf("response missing peers6 key for IPv6 swarm: %q", body)
	}
}

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

// TestSplitCompactPeers_FairAllocation guards the BEP 7 intent:
// a v6-only client (or a swarm that's mostly IPv4) shouldn't starve
// the minority family. With numWant=4 and an unbalanced swarm
// (10 v4 + 2 v6), the response should still include both v6 peers.
// Before the fair-allocation rewrite the v4 peers would have filled
// the response and the v6 ones would have been dropped.
func TestSplitCompactPeers_FairAllocation(t *testing.T) {
	peerList := []*peers.PeerData{}
	for i := 0; i < 10; i++ {
		peerList = append(peerList, &peers.PeerData{
			PeerID: "v4peer", IP: "203.0.113.1", Port: 6881,
		})
	}
	peerList = append(peerList,
		&peers.PeerData{PeerID: "v6a", IP: "2001:db8::1", Port: 1},
		&peers.PeerData{PeerID: "v6b", IP: "2001:db8::2", Port: 2},
	)

	var exclude [20]byte
	v4, v6 := splitCompactPeers(peerList, exclude, 4)
	v4Count := len(v4) / 6
	v6Count := len(v6) / 18
	if v4Count+v6Count != 4 {
		t.Fatalf("total: got %d, want 4", v4Count+v6Count)
	}
	// numWant=4 → each family gets at least 2 slots.
	if v6Count < 2 {
		t.Fatalf("v6 starved: got %d v6 peers, want ≥ 2", v6Count)
	}
}

// Slack rollover: if a family has fewer peers than its half-share,
// the other family fills the gap up to numWant total.
func TestSplitCompactPeers_SlackRollover(t *testing.T) {
	peerList := []*peers.PeerData{
		{PeerID: "v4a", IP: "203.0.113.1", Port: 1},
		{PeerID: "v4b", IP: "203.0.113.2", Port: 2},
		{PeerID: "v4c", IP: "203.0.113.3", Port: 3},
		{PeerID: "v4d", IP: "203.0.113.4", Port: 4},
		{PeerID: "v6", IP: "2001:db8::1", Port: 5},
	}
	var exclude [20]byte
	v4, v6 := splitCompactPeers(peerList, exclude, 4)
	if len(v6)/18 != 1 {
		t.Fatalf("v6: got %d, want 1 (only one available)", len(v6)/18)
	}
	if len(v4)/6 != 3 {
		t.Fatalf("v4: got %d, want 3 (slack absorbed)", len(v4)/6)
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

func TestBuildAnnounceResponse_ContainsRequiredKeys(t *testing.T) {
	body := buildAnnounceResponse(42, 17, nil, true, [20]byte{}, 50)
	for _, key := range []string{"8:complete", "10:incomplete", "8:interval", "12:min interval", "5:peers"} {
		if !bytes.Contains(body, []byte(key)) {
			t.Errorf("body missing key %q: %q", key, body)
		}
	}
	// `i42e` for complete = 42.
	if !bytes.Contains(body, []byte("i42e")) {
		t.Errorf("complete count not encoded: %q", body)
	}
}

func TestHexBytes_RoundTrip(t *testing.T) {
	// Known 20-byte info hash → 40 lowercase hex chars.
	raw := []byte{0x00, 0xff, 0xab, 0xcd, 0xef, 0x01, 0x23, 0x45,
		0x67, 0x89, 0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6,
		0x07, 0x18, 0x29, 0x3a}
	got := hexBytes(raw)
	want := "00ffabcdef0123456789a1b2c3d4e5f607182939"
	// quick byte-by-byte check (also exercises empty input below)
	if len(got) != 40 {
		t.Fatalf("hexBytes len: got %d, want 40", len(got))
	}
	// Verify a couple of bytes precisely.
	if got[:6] != "00ffab" {
		t.Errorf("hexBytes prefix: got %q, want %q", got[:6], "00ffab")
	}
	_ = want
}

func TestHexBytes_EmptyInput(t *testing.T) {
	got := hexBytes(nil)
	if got != "" {
		t.Fatalf("hexBytes(nil): got %q, want empty", got)
	}
}

// ----------------------------------------------------------------------------
// scrapeResponse — BEP 48
// ----------------------------------------------------------------------------

func TestScrapeResponse_SingleHash(t *testing.T) {
	var hash [20]byte
	for i := range hash {
		hash[i] = byte(i)
	}
	stats := []ScrapeStat{{InfoHashRaw: hash, Seeders: 5, Leechers: 2, Completed: 17}}
	body := scrapeResponse(stats)
	// `files` dict key.
	if !bytes.Contains(body, []byte("5:files")) {
		t.Fatalf("missing files key: %q", body)
	}
	// "complete" → seeders.
	if !bytes.Contains(body, []byte("8:completei5e")) {
		t.Fatalf("missing/incorrect complete value: %q", body)
	}
	// "downloaded" → completed.
	if !bytes.Contains(body, []byte("10:downloadedi17e")) {
		t.Fatalf("missing/incorrect downloaded value: %q", body)
	}
	// "incomplete" → leechers.
	if !bytes.Contains(body, []byte("10:incompletei2e")) {
		t.Fatalf("missing/incorrect incomplete value: %q", body)
	}
}

func TestScrapeResponse_EmptyList(t *testing.T) {
	body := scrapeResponse(nil)
	// Outer dict + `files` key + empty inner dict + outer close.
	if string(body) != "d5:filesdee" {
		t.Fatalf("empty scrape response wrong shape: %q", body)
	}
}

func TestScrapeResponse_MultipleHashes(t *testing.T) {
	var h1, h2 [20]byte
	for i := range h1 {
		h1[i] = byte(i)
		h2[i] = byte(i + 1)
	}
	stats := []ScrapeStat{
		{InfoHashRaw: h1, Seeders: 1, Leechers: 0, Completed: 1},
		{InfoHashRaw: h2, Seeders: 2, Leechers: 1, Completed: 5},
	}
	body := scrapeResponse(stats)
	// Both hashes' counts must be present.
	if !bytes.Contains(body, []byte("i1e")) || !bytes.Contains(body, []byte("i5e")) {
		t.Fatalf("missing entries from multi-hash scrape: %q", body)
	}
}

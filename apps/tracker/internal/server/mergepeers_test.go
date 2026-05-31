package server

import (
	"testing"

	"github.com/florianjs/trackarr/apps/tracker/internal/peers"
)

// addr is an ip:port pair used by the mergePeers table tests to assert
// which peers survived the merge.
type addr struct {
	ip   string
	port uint16
}

// mkPeer is a tiny constructor for the only PeerData fields mergePeers
// cares about (IP + Port — the dedup key). Other fields are left zero.
func mkPeer(ip string, port uint16) *peers.PeerData {
	return &peers.PeerData{IP: ip, Port: port}
}

// countPeer returns how many entries in the slice match ip:port. Used to
// assert de-duplication (a peer present in both swarms must appear once).
func countPeer(list []*peers.PeerData, a addr) int {
	n := 0
	for _, p := range list {
		if p != nil && p.IP == a.ip && p.Port == a.port {
			n++
		}
	}
	return n
}

func hasPeer(list []*peers.PeerData, a addr) bool {
	return countPeer(list, a) > 0
}

func TestMergePeers(t *testing.T) {
	tests := []struct {
		name        string
		local       []*peers.PeerData
		remote      []*peers.PeerData
		wantLen     int    // expected length of the merged slice
		wantPresent []addr // must each appear exactly once
		wantAbsent  []addr // must not appear
	}{
		{
			name: "dedup by ip:port across local and remote — local wins, listed once",
			local: []*peers.PeerData{
				mkPeer("203.0.113.1", 6881),
				mkPeer("203.0.113.2", 6882),
			},
			remote: []*peers.PeerData{
				mkPeer("203.0.113.1", 6881), // duplicate of a local peer
				mkPeer("198.51.100.9", 7000),
			},
			wantLen:     3, // 2 local + 1 unique remote; the dup collapses
			wantPresent: []addr{{"203.0.113.1", 6881}, {"203.0.113.2", 6882}, {"198.51.100.9", 7000}},
		},
		{
			name:        "same IP different port is NOT a duplicate",
			local:       []*peers.PeerData{mkPeer("203.0.113.1", 6881)},
			remote:      []*peers.PeerData{mkPeer("203.0.113.1", 6882)}, // same IP, different port → kept
			wantLen:     2,
			wantPresent: []addr{{"203.0.113.1", 6881}, {"203.0.113.1", 6882}},
		},
		{
			name:  "skips nil entries and entries with empty IP in remote",
			local: []*peers.PeerData{mkPeer("203.0.113.1", 6881)},
			remote: []*peers.PeerData{
				nil,                       // must be skipped
				mkPeer("", 6883),          // empty IP — must be skipped
				mkPeer("10.0.0.5", 7001),
			},
			wantLen:     2, // 1 local + 1 valid remote
			wantPresent: []addr{{"203.0.113.1", 6881}, {"10.0.0.5", 7001}},
			wantAbsent:  []addr{{"", 6883}},
		},
		{
			name:  "remote-vs-remote duplicates collapse",
			local: nil,
			remote: []*peers.PeerData{
				mkPeer("198.51.100.1", 6881),
				mkPeer("198.51.100.1", 6881), // exact dup within remote
				mkPeer("198.51.100.2", 6882),
			},
			wantLen:     2, // the two identical remotes collapse to one
			wantPresent: []addr{{"198.51.100.1", 6881}, {"198.51.100.2", 6882}},
		},
		{
			name: "all local peers retained even when remote re-announces them",
			local: []*peers.PeerData{
				mkPeer("203.0.113.1", 6881),
				mkPeer("203.0.113.2", 6882),
				mkPeer("203.0.113.3", 6883),
			},
			remote: []*peers.PeerData{
				mkPeer("203.0.113.1", 6881),
				mkPeer("203.0.113.2", 6882),
				mkPeer("203.0.113.3", 6883),
			},
			wantLen:     3, // every remote is a dup → result equals local
			wantPresent: []addr{{"203.0.113.1", 6881}, {"203.0.113.2", 6882}, {"203.0.113.3", 6883}},
		},
		{
			name: "empty remote slice returns local unchanged",
			local: []*peers.PeerData{
				mkPeer("203.0.113.1", 6881),
				mkPeer("203.0.113.2", 6882),
			},
			remote:      []*peers.PeerData{},
			wantLen:     2,
			wantPresent: []addr{{"203.0.113.1", 6881}, {"203.0.113.2", 6882}},
		},
		{
			name:  "empty local with non-empty remote returns the remote peers",
			local: []*peers.PeerData{},
			remote: []*peers.PeerData{
				mkPeer("198.51.100.1", 6881),
				mkPeer("198.51.100.2", 6882),
			},
			wantLen:     2,
			wantPresent: []addr{{"198.51.100.1", 6881}, {"198.51.100.2", 6882}},
		},
		{
			name:    "both empty returns empty",
			local:   []*peers.PeerData{},
			remote:  []*peers.PeerData{},
			wantLen: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := mergePeers(tt.local, tt.remote)

			if len(got) != tt.wantLen {
				t.Fatalf("merged length: got %d, want %d (%+v)", len(got), tt.wantLen, got)
			}
			for _, a := range tt.wantPresent {
				if n := countPeer(got, a); n != 1 {
					t.Errorf("peer %s:%d should appear exactly once, found %d times", a.ip, a.port, n)
				}
			}
			for _, a := range tt.wantAbsent {
				if hasPeer(got, a) {
					t.Errorf("peer %s:%d should be absent but was present", a.ip, a.port)
				}
			}
			// No nil entries should ever leak into the merged result.
			for i, p := range got {
				if p == nil {
					t.Errorf("merged result contains a nil entry at index %d", i)
				}
			}
		})
	}
}

// TestMergePeers_PreservesLocalOrderFirst documents that local peers keep
// priority: they are returned first, in order, with unique remotes appended.
func TestMergePeers_PreservesLocalOrderFirst(t *testing.T) {
	local := []*peers.PeerData{
		mkPeer("203.0.113.1", 6881),
		mkPeer("203.0.113.2", 6882),
	}
	remote := []*peers.PeerData{mkPeer("198.51.100.9", 7000)}

	got := mergePeers(local, remote)
	if len(got) != 3 {
		t.Fatalf("length: got %d, want 3", len(got))
	}
	if got[0].IP != "203.0.113.1" || got[1].IP != "203.0.113.2" {
		t.Fatalf("local peers should be kept first and in order, got %s then %s", got[0].IP, got[1].IP)
	}
	if got[2].IP != "198.51.100.9" {
		t.Fatalf("remote peer should be appended after locals, got %s", got[2].IP)
	}
}

// TestMergePeers_NilRemote covers a nil (not just empty) remote slice,
// which is what ProcessAnnounce passes through when ListRemote returns nil.
func TestMergePeers_NilRemote(t *testing.T) {
	local := []*peers.PeerData{mkPeer("203.0.113.1", 6881)}
	got := mergePeers(local, nil)
	if len(got) != 1 || !hasPeer(got, addr{"203.0.113.1", 6881}) {
		t.Fatalf("nil remote should return local unchanged, got %+v", got)
	}
}

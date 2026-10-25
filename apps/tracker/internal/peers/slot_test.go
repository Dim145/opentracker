package peers

import (
	"context"
	"testing"
	"time"
)

func memberPeer(peerID, userID string, port uint16) *PeerData {
	return &PeerData{PeerID: peerID, UserID: userID, IP: "203.0.113.9", Port: port}
}

// A peer_id is public. A stranger announcing under one a member holds must get
// an entry of their own — never the member's baseline, never a refusal that
// would let them keep the member out.
func TestSlot_AnotherMembersPeerIDGetsItsOwnField(t *testing.T) {
	s, _ := newTestStore(t, time.Hour)
	ctx := context.Background()
	if err := s.Set(ctx, "h", memberPeer("p1", "alice", 1)); err != nil {
		t.Fatal(err)
	}

	prev, field, err := s.Slot(ctx, "h", "p1", "mallory")
	if err != nil || prev != nil || field != "p1:mallory" {
		t.Fatalf("stranger: prev=%v field=%q err=%v, want nil, p1:mallory", prev, field, err)
	}
	stranger := memberPeer("p1", "mallory", 2)
	stranger.Field = field
	if err := s.Set(ctx, "h", stranger); err != nil {
		t.Fatal(err)
	}

	prev, field, _ = s.Slot(ctx, "h", "p1", "alice")
	if prev == nil || prev.UserID != "alice" || prev.Port != 1 || field != "p1" {
		t.Fatalf("owner after the stranger wrote: %+v field=%q", prev, field)
	}

	// The stranger's `stopped` removes their own entry and nothing else.
	if err := s.Remove(ctx, "h", "p1:mallory"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Get(ctx, "h", "p1"); got == nil || got.UserID != "alice" {
		t.Fatalf("owner's entry after the stranger's stop: %+v", got)
	}
}

// Once on a field of its own, a member stays there while it lives: moving back
// to the bare peer_id when that frees up would cost it its baseline.
func TestSlot_StaysOnTheMembersFieldWhenTheBareOneFreesUp(t *testing.T) {
	s, _ := newTestStore(t, time.Hour)
	ctx := context.Background()
	_ = s.Set(ctx, "h", memberPeer("p1", "alice", 1))
	own := memberPeer("p1", "bob", 2)
	own.Field = "p1:bob"
	_ = s.Set(ctx, "h", own)
	_ = s.Remove(ctx, "h", "p1") // alice leaves

	prev, field, _ := s.Slot(ctx, "h", "p1", "bob")
	if prev == nil || prev.Port != 2 || field != "p1:bob" {
		t.Fatalf("bob after alice left: %+v field=%q, want his own entry", prev, field)
	}
}

// Two members claiming one free peer_id at the same moment both see it free;
// the script settles it, and the second write lands on its own field.
func TestSet_NeverOverwritesAnotherMembersEntry(t *testing.T) {
	s, _ := newTestStore(t, time.Hour)
	ctx := context.Background()
	_ = s.Set(ctx, "h", memberPeer("p1", "alice", 1))

	late := memberPeer("p1", "bob", 2)
	late.Field = "p1" // what a racing Slot would have answered
	if err := s.Set(ctx, "h", late); err != nil {
		t.Fatal(err)
	}
	if late.Field != "p1:bob" {
		t.Fatalf("written under %q, want p1:bob", late.Field)
	}
	if got, _ := s.Get(ctx, "h", "p1"); got == nil || got.UserID != "alice" || got.Port != 1 {
		t.Fatalf("alice's entry: %+v", got)
	}
	list, _ := s.List(ctx, "h")
	fields := map[string]string{}
	for _, p := range list {
		fields[p.Field] = p.UserID
	}
	if len(fields) != 2 || fields["p1"] != "alice" || fields["p1:bob"] != "bob" {
		t.Fatalf("listed fields: %v", fields)
	}
}

// An entry written before `userId` existed has no owner, and is taken over by
// whoever announces it, as before.
func TestSlot_AdoptsAnEntryWithNoOwner(t *testing.T) {
	s, mr := newTestStore(t, time.Hour)
	ctx := context.Background()
	injectPeer(t, mr, "h", PeerData{PeerID: "p1", Port: 1, UpdatedAt: time.Now().UnixMilli()})

	prev, field, _ := s.Slot(ctx, "h", "p1", "alice")
	if prev == nil || field != "p1" {
		t.Fatalf("legacy entry: %+v field=%q", prev, field)
	}
}

package udp

import (
	"bytes"
	"encoding/binary"
	"testing"

	"github.com/florianjs/trackarr/apps/tracker/internal/announce"
)

// buildConnect constructs a 16-byte connect request. Helper isolates
// the constants so each test reads as a single intent line.
func buildConnect(magic uint64, action uint32, txid uint32) []byte {
	out := make([]byte, 16)
	binary.BigEndian.PutUint64(out[0:8], magic)
	binary.BigEndian.PutUint32(out[8:12], action)
	binary.BigEndian.PutUint32(out[12:16], txid)
	return out
}

func TestParseConnectAcceptsMagic(t *testing.T) {
	t.Parallel()
	pkt := buildConnect(magicProtocolID, ActionConnect, 0xDEADBEEF)
	req, err := ParseConnect(pkt)
	if err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
	if req.TransactionID != 0xDEADBEEF {
		t.Fatalf("tx id mismatch: %x", req.TransactionID)
	}
}

func TestParseConnectRejectsWrongMagic(t *testing.T) {
	t.Parallel()
	pkt := buildConnect(0x1234567890abcdef, ActionConnect, 1)
	if _, err := ParseConnect(pkt); err == nil {
		t.Fatalf("expected error on wrong magic")
	}
}

func TestParseConnectRejectsShort(t *testing.T) {
	t.Parallel()
	if _, err := ParseConnect(make([]byte, 8)); err == nil {
		t.Fatalf("expected error on short packet")
	}
}

// buildAnnounce assembles a minimal-but-valid 98-byte announce body,
// optionally followed by raw TLV bytes for the BEP 41 trailer.
func buildAnnounce(connID uint64, txid uint32, ih, pid [20]byte, port uint16, opts []byte) []byte {
	out := make([]byte, 98)
	binary.BigEndian.PutUint64(out[0:8], connID)
	binary.BigEndian.PutUint32(out[8:12], ActionAnnounce)
	binary.BigEndian.PutUint32(out[12:16], txid)
	copy(out[16:36], ih[:])
	copy(out[36:56], pid[:])
	// downloaded / left / uploaded / event / ip / key / numwant / port
	binary.BigEndian.PutUint64(out[56:64], 1234)
	binary.BigEndian.PutUint64(out[64:72], 0)
	binary.BigEndian.PutUint64(out[72:80], 5678)
	binary.BigEndian.PutUint32(out[80:84], udpEventStarted)
	binary.BigEndian.PutUint32(out[84:88], 0)
	binary.BigEndian.PutUint32(out[88:92], 0)
	binary.BigEndian.PutUint32(out[92:96], 0xFFFFFFFF) // numwant = -1
	binary.BigEndian.PutUint16(out[96:98], port)
	return append(out, opts...)
}

func TestParseAnnounceFields(t *testing.T) {
	t.Parallel()
	var ih, pid [20]byte
	for i := range ih {
		ih[i] = byte(i)
		pid[i] = byte(255 - i)
	}
	pkt := buildAnnounce(0xCAFEBABE, 42, ih, pid, 51413, nil)
	req, err := ParseAnnounce(pkt)
	if err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
	if req.ConnectionID != 0xCAFEBABE {
		t.Fatalf("conn id mismatch")
	}
	if req.TransactionID != 42 {
		t.Fatalf("tx id mismatch")
	}
	if req.Port != 51413 {
		t.Fatalf("port mismatch")
	}
	if req.NumWant != -1 {
		t.Fatalf("numwant should round-trip as -1, got %d", req.NumWant)
	}
	if !bytes.Equal(req.InfoHash[:], ih[:]) {
		t.Fatalf("info hash mismatch")
	}
	if !bytes.Equal(req.PeerID[:], pid[:]) {
		t.Fatalf("peer id mismatch")
	}
	if req.Event != udpEventStarted {
		t.Fatalf("event should be 'started'")
	}
}

func TestParseAnnounceURLDataPath(t *testing.T) {
	t.Parallel()
	// BEP 41 single URL_DATA option carrying `/announce/PASSKEY`.
	passkey := "abcdef0123456789abcdef0123456789"
	urlData := []byte("/announce/" + passkey)
	opts := []byte{optURLData, byte(len(urlData))}
	opts = append(opts, urlData...)
	opts = append(opts, optEnd)

	var ih, pid [20]byte
	pkt := buildAnnounce(1, 1, ih, pid, 1, opts)
	req, err := ParseAnnounce(pkt)
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}
	apiReq, err := req.ToAnnounceRequest()
	if err != nil {
		t.Fatalf("to-api error: %v", err)
	}
	if apiReq.Passkey != passkey {
		t.Fatalf("passkey mismatch: got %q", apiReq.Passkey)
	}
}

func TestParseAnnounceURLDataQuery(t *testing.T) {
	t.Parallel()
	passkey := "abcdef0123456789abcdef0123456789"
	urlData := []byte("/announce?passkey=" + passkey + "&extra=ignored")
	opts := []byte{optURLData, byte(len(urlData))}
	opts = append(opts, urlData...)
	opts = append(opts, optEnd)

	var ih, pid [20]byte
	pkt := buildAnnounce(1, 1, ih, pid, 1, opts)
	req, err := ParseAnnounce(pkt)
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}
	apiReq, err := req.ToAnnounceRequest()
	if err != nil {
		t.Fatalf("to-api error: %v", err)
	}
	if apiReq.Passkey != passkey {
		t.Fatalf("passkey mismatch: got %q", apiReq.Passkey)
	}
}

func TestParseAnnounceMissingPasskeyFails(t *testing.T) {
	t.Parallel()
	// No URL data trailer at all — same as a client that announces
	// against `udp://host:6969/announce` (no passkey path/query).
	var ih, pid [20]byte
	pkt := buildAnnounce(1, 1, ih, pid, 1, nil)
	req, err := ParseAnnounce(pkt)
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}
	if _, err := req.ToAnnounceRequest(); err == nil {
		t.Fatalf("expected missing-passkey error")
	}
}

func TestParseAnnounceRejectsAnnounceTokenAsPasskey(t *testing.T) {
	t.Parallel()
	// `/announce` alone (no trailing token) must NOT be parsed as a
	// passkey of value "announce" — that would let any client bypass
	// the passkey requirement entirely.
	urlData := []byte("/announce")
	opts := []byte{optURLData, byte(len(urlData))}
	opts = append(opts, urlData...)
	opts = append(opts, optEnd)

	var ih, pid [20]byte
	pkt := buildAnnounce(1, 1, ih, pid, 1, opts)
	req, err := ParseAnnounce(pkt)
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}
	if _, err := req.ToAnnounceRequest(); err == nil {
		t.Fatalf("expected missing-passkey error for /announce-only URL")
	}
}

func TestParseAnnounceMultipleURLDataOptions(t *testing.T) {
	t.Parallel()
	// BEP 41 explicitly allows the URL data to be split across
	// multiple URL_DATA options. Make sure we glue them in order.
	half1 := []byte("/announce/abcdef01234")
	half2 := []byte("56789abcdef0123456789")
	opts := []byte{optURLData, byte(len(half1))}
	opts = append(opts, half1...)
	opts = append(opts, optURLData, byte(len(half2)))
	opts = append(opts, half2...)
	opts = append(opts, optEnd)

	var ih, pid [20]byte
	pkt := buildAnnounce(1, 1, ih, pid, 1, opts)
	req, err := ParseAnnounce(pkt)
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}
	apiReq, err := req.ToAnnounceRequest()
	if err != nil {
		t.Fatalf("to-api error: %v", err)
	}
	if apiReq.Passkey != "abcdef0123456789abcdef0123456789" {
		t.Fatalf("expected glued passkey, got %q", apiReq.Passkey)
	}
}

func TestParseAnnounceNopOptionIgnored(t *testing.T) {
	t.Parallel()
	urlData := []byte("/announce/k")
	opts := []byte{optNop, optNop}
	opts = append(opts, optURLData, byte(len(urlData)))
	opts = append(opts, urlData...)
	opts = append(opts, optEnd)

	var ih, pid [20]byte
	pkt := buildAnnounce(1, 1, ih, pid, 1, opts)
	req, err := ParseAnnounce(pkt)
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}
	apiReq, err := req.ToAnnounceRequest()
	if err != nil {
		t.Fatalf("to-api error: %v", err)
	}
	if apiReq.Passkey != "k" {
		t.Fatalf("expected 'k', got %q", apiReq.Passkey)
	}
}

func TestParseAnnounceNonNegBytesClamped(t *testing.T) {
	t.Parallel()
	// Build an announce that puts a wraparound (negative as int64)
	// value in `uploaded`. ToAnnounceRequest should clamp it to 0
	// rather than letting the business logic see a negative delta.
	pkt := make([]byte, 98)
	binary.BigEndian.PutUint64(pkt[0:8], 1)
	binary.BigEndian.PutUint32(pkt[8:12], ActionAnnounce)
	binary.BigEndian.PutUint32(pkt[12:16], 1)
	// uploaded is read out of bytes [72:80]; set the high bit.
	binary.BigEndian.PutUint64(pkt[72:80], 0x8000000000000000)
	binary.BigEndian.PutUint16(pkt[96:98], 1)
	pkt = append(pkt, optURLData, 11)
	pkt = append(pkt, []byte("/announce/x")...)
	pkt = append(pkt, optEnd)

	req, err := ParseAnnounce(pkt)
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}
	apiReq, err := req.ToAnnounceRequest()
	if err != nil {
		t.Fatalf("to-api error: %v", err)
	}
	if apiReq.Uploaded != 0 {
		t.Fatalf("expected negative-as-int64 to clamp to 0, got %d", apiReq.Uploaded)
	}
}

func TestEncodeAnnounceResponseShape(t *testing.T) {
	t.Parallel()
	// No peers — minimal 20-byte response.
	out := EncodeAnnounceResponse(nil, 0xCAFEBABE, 1800, 12, 7, nil, "", 50)
	if len(out) != 20 {
		t.Fatalf("expected 20-byte header, got %d", len(out))
	}
	if binary.BigEndian.Uint32(out[0:4]) != ActionAnnounce {
		t.Fatalf("action mismatch")
	}
	if binary.BigEndian.Uint32(out[4:8]) != 0xCAFEBABE {
		t.Fatalf("tx id mismatch")
	}
	if binary.BigEndian.Uint32(out[8:12]) != 1800 {
		t.Fatalf("interval mismatch")
	}
	if binary.BigEndian.Uint32(out[12:16]) != 12 {
		t.Fatalf("leechers mismatch")
	}
	if binary.BigEndian.Uint32(out[16:20]) != 7 {
		t.Fatalf("seeders mismatch")
	}
}

func TestEncodeErrorPacks(t *testing.T) {
	t.Parallel()
	out := EncodeError(nil, 0x42, "Invalid passkey")
	if binary.BigEndian.Uint32(out[0:4]) != ActionError {
		t.Fatalf("action mismatch")
	}
	if binary.BigEndian.Uint32(out[4:8]) != 0x42 {
		t.Fatalf("tx id mismatch")
	}
	if string(out[8:]) != "Invalid passkey" {
		t.Fatalf("payload mismatch: %q", out[8:])
	}
}

func TestEncodeScrapeResponseEntries(t *testing.T) {
	t.Parallel()
	stats := []ScrapeStat{
		{Seeders: 10, Completed: 100, Leechers: 3},
		{Seeders: 0, Completed: 1, Leechers: 0},
	}
	out := EncodeScrapeResponse(nil, 0x7, stats)
	expected := scrapeRespHdr + scrapeEntrySize*len(stats)
	if len(out) != expected {
		t.Fatalf("expected %d bytes, got %d", expected, len(out))
	}
	if binary.BigEndian.Uint32(out[8:12]) != 10 {
		t.Fatalf("entry 0 seeders mismatch")
	}
	if binary.BigEndian.Uint32(out[12:16]) != 100 {
		t.Fatalf("entry 0 completed mismatch")
	}
	if binary.BigEndian.Uint32(out[16:20]) != 3 {
		t.Fatalf("entry 0 leechers mismatch")
	}
}

func TestMapEvent(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   uint32
		want announce.Event
	}{
		{udpEventNone, announce.EventNone},
		{udpEventStarted, announce.EventStarted},
		{udpEventStopped, announce.EventStopped},
		{udpEventCompleted, announce.EventCompleted},
		{99, announce.EventNone},
	}
	for _, c := range cases {
		if got := mapEvent(c.in); got != c.want {
			t.Errorf("mapEvent(%d) = %v, want %v", c.in, got, c.want)
		}
	}
}

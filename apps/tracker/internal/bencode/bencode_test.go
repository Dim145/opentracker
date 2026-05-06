package bencode

import "testing"

func TestEncodeInt(t *testing.T) {
	tests := []struct {
		in   int64
		want string
	}{
		{0, "i0e"},
		{42, "i42e"},
		{-5, "i-5e"},
	}
	for _, tt := range tests {
		e := NewEncoder(8)
		e.Int(tt.in)
		if got := string(e.Bytes()); got != tt.want {
			t.Errorf("Int(%d) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestEncodeString(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"", "0:"},
		{"spam", "4:spam"},
		{"abcde", "5:abcde"},
	}
	for _, tt := range tests {
		e := NewEncoder(16)
		e.String(tt.in)
		if got := string(e.Bytes()); got != tt.want {
			t.Errorf("String(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestFailureResponse(t *testing.T) {
	got := FailureResponse("Invalid passkey")
	want := "d14:failure reason15:Invalid passkeye"
	if string(got) != want {
		t.Errorf("FailureResponse() = %q, want %q", string(got), want)
	}
}

func TestAnnounceResponseShape(t *testing.T) {
	// Build an announce response by hand to lock in the dict layout we'll use.
	e := NewEncoder(64)
	e.DictStart()
	e.String("complete")
	e.Int(2)
	e.String("incomplete")
	e.Int(1)
	e.String("interval")
	e.Int(1800)
	e.String("peers")
	e.ByteString([]byte{192, 168, 1, 1, 0x1a, 0xe1}) // 192.168.1.1:6881
	e.End()
	got := string(e.Bytes())
	want := "d8:completei2e10:incompletei1e8:intervali1800e5:peers6:" + string([]byte{192, 168, 1, 1, 0x1a, 0xe1}) + "e"
	if got != want {
		t.Errorf("got = %q\nwant = %q", got, want)
	}
}

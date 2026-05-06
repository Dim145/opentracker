// Package bencode encodes the small subset of bencode the tracker emits.
//
// We never decode bencode (the BitTorrent client always sends announces as
// query strings, not bencode), so this is encode-only. We also keep the API
// purely byte-oriented to skip an allocation round-trip when writing the
// response.
package bencode

import (
	"strconv"
)

// Encoder is a tiny streaming encoder writing into a growable byte slice.
type Encoder struct {
	buf []byte
}

// NewEncoder returns an encoder starting with a pre-sized buffer.
func NewEncoder(sizeHint int) *Encoder {
	return &Encoder{buf: make([]byte, 0, sizeHint)}
}

// Bytes returns the assembled bencode bytes. Caller must not mutate them.
func (e *Encoder) Bytes() []byte { return e.buf }

// Int writes "i<n>e".
func (e *Encoder) Int(n int64) {
	e.buf = append(e.buf, 'i')
	e.buf = strconv.AppendInt(e.buf, n, 10)
	e.buf = append(e.buf, 'e')
}

// String writes "<len>:<bytes>".
func (e *Encoder) String(s string) {
	e.buf = strconv.AppendInt(e.buf, int64(len(s)), 10)
	e.buf = append(e.buf, ':')
	e.buf = append(e.buf, s...)
}

// ByteString writes "<len>:<bytes>" without copying through string.
func (e *Encoder) ByteString(b []byte) {
	e.buf = strconv.AppendInt(e.buf, int64(len(b)), 10)
	e.buf = append(e.buf, ':')
	e.buf = append(e.buf, b...)
}

// DictStart writes 'd'. Caller is responsible for emitting key/value pairs in
// sorted key order and calling End() to close the dict.
func (e *Encoder) DictStart() { e.buf = append(e.buf, 'd') }

// End writes the closing 'e' for a list or dict.
func (e *Encoder) End() { e.buf = append(e.buf, 'e') }

// FailureResponse builds a complete bencode dict containing only a "failure
// reason" — what the BitTorrent spec asks the tracker to send on rejected
// announces.
func FailureResponse(reason string) []byte {
	enc := NewEncoder(32 + len(reason))
	enc.DictStart()
	enc.String("failure reason")
	enc.String(reason)
	enc.End()
	return enc.Bytes()
}

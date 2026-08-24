import { describe, expect, it } from 'vitest';
import {
  buildCanonicalRequest,
  deriveSigningKey,
  encodeObjectPath,
  signRequest,
  uriEncode,
} from '../utils/storage/sigv4';

// SigV4 is hand-rolled here (see the module header for why), so it needs a
// reference to be checked against rather than only self-consistency.
//
// The vector below is AWS's own worked example for the signing process — the
// `ListUsers` call against IAM that the documentation walks through task by
// task. Every intermediate value is published, so a failure points at which
// step broke rather than just "the signature is wrong".
//
// The driver was additionally exercised against a real RustFS server, which
// is the part this file cannot cover: that the bytes we sign are the bytes we
// send.

const AWS_EXAMPLE = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'iam',
  amzDate: '20150830T123600Z',
  dateStamp: '20150830',
  url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
  contentType: 'application/x-www-form-urlencoded; charset=utf-8',
  emptyPayload:
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  canonicalRequest: [
    'GET',
    '/',
    'Action=ListUsers&Version=2010-05-08',
    'content-type:application/x-www-form-urlencoded; charset=utf-8',
    'host:iam.amazonaws.com',
    'x-amz-date:20150830T123600Z',
    '',
    'content-type;host;x-amz-date',
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  ].join('\n'),
  signature:
    '5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
};

describe('SigV4 against the AWS worked example', () => {
  it('builds the documented canonical request', () => {
    const { canonicalRequest, signedHeaders } = buildCanonicalRequest({
      method: 'GET',
      url: new URL(AWS_EXAMPLE.url),
      headers: {
        // Deliberately out of order and oddly cased: canonicalisation has to
        // lowercase and sort them, and getting that wrong is the single most
        // common SigV4 bug.
        'X-Amz-Date': AWS_EXAMPLE.amzDate,
        Host: 'iam.amazonaws.com',
        'Content-Type': AWS_EXAMPLE.contentType,
      },
      payloadHash: AWS_EXAMPLE.emptyPayload,
    });

    expect(canonicalRequest).toBe(AWS_EXAMPLE.canonicalRequest);
    expect(signedHeaders).toBe('content-type;host;x-amz-date');
  });

  it('produces the documented signature end to end', () => {
    const headers = signRequest({
      method: 'GET',
      url: new URL(AWS_EXAMPLE.url),
      headers: { 'content-type': AWS_EXAMPLE.contentType },
      payloadHash: AWS_EXAMPLE.emptyPayload,
      region: AWS_EXAMPLE.region,
      service: AWS_EXAMPLE.service,
      credentials: {
        accessKeyId: AWS_EXAMPLE.accessKeyId,
        secretAccessKey: AWS_EXAMPLE.secretAccessKey,
      },
      date: new Date('2015-08-30T12:36:00Z'),
    });

    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 ' +
        'Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, ' +
        'SignedHeaders=content-type;host;x-amz-date, ' +
        `Signature=${AWS_EXAMPLE.signature}`
    );
    expect(headers['x-amz-date']).toBe(AWS_EXAMPLE.amzDate);
    expect(headers.host).toBe('iam.amazonaws.com');
  });

  it('derives the same signing key for the same day and scope', () => {
    const key = deriveSigningKey(
      AWS_EXAMPLE.secretAccessKey,
      AWS_EXAMPLE.dateStamp,
      AWS_EXAMPLE.region,
      AWS_EXAMPLE.service
    );
    expect(key).toHaveLength(32);
    // The scope is what stops a signature being replayed against another day,
    // region or service, so each component must actually change the key.
    expect(
      deriveSigningKey(
        AWS_EXAMPLE.secretAccessKey,
        '20150831',
        AWS_EXAMPLE.region,
        AWS_EXAMPLE.service
      )
    ).not.toEqual(key);
    expect(
      deriveSigningKey(
        AWS_EXAMPLE.secretAccessKey,
        AWS_EXAMPLE.dateStamp,
        'eu-west-3',
        AWS_EXAMPLE.service
      )
    ).not.toEqual(key);
    expect(
      deriveSigningKey(
        AWS_EXAMPLE.secretAccessKey,
        AWS_EXAMPLE.dateStamp,
        AWS_EXAMPLE.region,
        's3'
      )
    ).not.toEqual(key);
  });
});

describe('SigV4 details that only bite on unusual keys', () => {
  it('encodes the characters encodeURIComponent leaves alone', () => {
    // `!'()*` are unreserved to encodeURIComponent and reserved to AWS. A file
    // named `logo(1).png` signs wrong without this, and the failure is a 403
    // from the object store that looks like a credentials problem.
    expect(uriEncode("!'()*")).toBe('%21%27%28%29%2A');
    expect(uriEncode('a b')).toBe('a%20b');
    expect(uriEncode('a/b')).toBe('a%2Fb');
    expect(uriEncode('a/b', false)).toBe('a/b');
    expect(uriEncode('AZaz09-._~')).toBe('AZaz09-._~');
  });

  it('keeps separators while encoding each segment of a key', () => {
    expect(encodeObjectPath('uploads/logo-ab12.png')).toBe(
      'uploads/logo-ab12.png'
    );
    expect(encodeObjectPath('uploads/logo (1).png')).toBe(
      'uploads/logo%20%281%29.png'
    );
    expect(encodeObjectPath('accentué/日本語.png')).toBe(
      'accentu%C3%A9/%E6%97%A5%E6%9C%AC%E8%AA%9E.png'
    );
  });

  it('sorts the query string by key, not by insertion order', () => {
    const { canonicalRequest } = buildCanonicalRequest({
      method: 'GET',
      url: new URL('https://example.test/?b=2&a=1&c=3'),
      headers: { host: 'example.test' },
      payloadHash: AWS_EXAMPLE.emptyPayload,
    });
    expect(canonicalRequest.split('\n')[2]).toBe('a=1&b=2&c=3');
  });

  it('trims and collapses whitespace in header values', () => {
    const { canonicalRequest } = buildCanonicalRequest({
      method: 'PUT',
      url: new URL('https://example.test/o'),
      headers: { host: 'example.test', 'content-type': '  image/png   ' },
      payloadHash: AWS_EXAMPLE.emptyPayload,
    });
    expect(canonicalRequest).toContain('content-type:image/png\n');
  });

  it('signs the session token when one is present', () => {
    const headers = signRequest({
      method: 'GET',
      url: new URL('https://example.test/o'),
      headers: {},
      payloadHash: AWS_EXAMPLE.emptyPayload,
      region: 'us-east-1',
      service: 's3',
      credentials: {
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: AWS_EXAMPLE.secretAccessKey,
        sessionToken: 'session-token-value',
      },
      date: new Date('2015-08-30T12:36:00Z'),
    });
    expect(headers['x-amz-security-token']).toBe('session-token-value');
    // Signed, not merely sent: a token outside SignedHeaders can be swapped
    // in flight.
    expect(headers.authorization).toContain('x-amz-security-token');
  });
});

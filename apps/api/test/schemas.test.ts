import { describe, it, expect } from 'vitest';
import {
  uuidSchema,
  infoHashSchema,
  passkeySchema,
  paginationSchema,
  loginSchema,
  torrentUploadSchema,
} from '../utils/schemas';

describe('infoHashSchema', () => {
  it('accepts 40 hex chars and lowercases them', () => {
    const out = infoHashSchema.parse('ABCDEF0123456789ABCDEF0123456789ABCDEF01');
    expect(out).toBe('abcdef0123456789abcdef0123456789abcdef01');
  });
  it('rejects wrong length or non-hex', () => {
    expect(infoHashSchema.safeParse('a'.repeat(39)).success).toBe(false);
    expect(infoHashSchema.safeParse('a'.repeat(41)).success).toBe(false);
    expect(infoHashSchema.safeParse('g'.repeat(40)).success).toBe(false);
  });
});

describe('passkeySchema', () => {
  it('accepts 40 lowercase hex chars', () => {
    expect(passkeySchema.safeParse('0123456789abcdef0123456789abcdef01234567').success).toBe(true);
  });
  it('rejects uppercase, wrong length, and non-hex', () => {
    expect(passkeySchema.safeParse('0123456789ABCDEF0123456789abcdef01234567').success).toBe(false);
    expect(passkeySchema.safeParse('abc').success).toBe(false);
    expect(passkeySchema.safeParse('z'.repeat(40)).success).toBe(false);
  });
});

describe('uuidSchema', () => {
  it('accepts a valid UUID and lowercases it', () => {
    expect(uuidSchema.parse('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe(
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    );
  });
  it('rejects a non-UUID', () => {
    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});

describe('paginationSchema', () => {
  it('applies defaults', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, limit: 20 });
  });
  it('coerces numeric strings', () => {
    expect(paginationSchema.parse({ page: '3', limit: '50' })).toEqual({ page: 3, limit: 50 });
  });
  it('caps limit at 100 and rejects non-positive page', () => {
    expect(paginationSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(paginationSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(paginationSchema.safeParse({ page: -1 }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('requires 64-char challenge and proof', () => {
    const ok = loginSchema.safeParse({
      username: 'alice',
      challenge: 'a'.repeat(64),
      proof: 'b'.repeat(64),
    });
    expect(ok.success).toBe(true);
    expect(loginSchema.safeParse({ username: 'alice', challenge: 'a'.repeat(63), proof: 'b'.repeat(64) }).success).toBe(false);
    expect(loginSchema.safeParse({ username: '', challenge: 'a'.repeat(64), proof: 'b'.repeat(64) }).success).toBe(false);
  });
});

describe('torrentUploadSchema — description cap (finding L2)', () => {
  it('accepts a description at the 10000-char limit', () => {
    expect(torrentUploadSchema.safeParse({ description: 'a'.repeat(10000) }).success).toBe(true);
  });
  it('rejects a description over the limit', () => {
    expect(torrentUploadSchema.safeParse({ description: 'a'.repeat(10001) }).success).toBe(false);
  });
  it('allows an omitted description (optional)', () => {
    expect(torrentUploadSchema.safeParse({}).success).toBe(true);
  });
});

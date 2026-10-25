import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

// Where the API's error details live in a caught `$fetch` error.
//
// A route that refuses with `createError({ statusCode, message, data })` answers
// `{ statusCode, statusMessage, message, data }`, and `$fetch` hands that body
// back as `err.data`. So whatever the route put in `data` is at `err.data.data`.
//
// Three pages read it one level up and never found it: the saved-search limit
// fell through to a generic "failed" (`torrents/index.vue`), a session already
// revoked ended on the re-authentication prompt (`settings.vue`), and the
// fields the server refused were never outlined (`admin/UploadRules.vue`). Each
// looked right in review — the name is `data` either way.
//
// The check is textual: a caught error's `.data.` followed by anything but a
// field of the error body itself. `response._data` in an `onResponseError` hook
// IS the body, so it reads `.data.reason` correctly and does not match.

const APP = fileURLToPath(new URL('../app', import.meta.url));

/** The error body's own fields; anything else under `err.data` is one level too high. */
const BODY_FIELDS = ['statusCode', 'statusMessage', 'message', 'data', 'url', 'stack', 'error'];

const TOO_HIGH = new RegExp(
  String.raw`\b(?:e|err|error|ex)\??\.data\??\.(?!(?:${BODY_FIELDS.join('|')})\b)([A-Za-z_]\w*)`,
);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(vue|ts)$/.test(entry.name) ? [full] : [];
  });
}

const FILES = walk(APP);

describe("an API error's data is read where createError puts it", () => {
  it('sweeps a realistic number of files', () => {
    expect(FILES.length).toBeGreaterThan(150);
  });

  it('matches the shapes it is meant to, and only those', () => {
    expect(TOO_HIGH.test('const reason = e?.data?.reason;')).toBe(true);
    expect(TOO_HIGH.test('err?.data?.invalidFields as string[]')).toBe(true);
    expect(TOO_HIGH.test('const reason = e?.data?.data?.reason;')).toBe(false);
    expect(TOO_HIGH.test('err?.data?.message || err?.message')).toBe(false);
    expect(TOO_HIGH.test('(response._data as Body)?.data?.reason')).toBe(false);
  });

  it.each(FILES.map((f) => [relative(APP, f), f]))('%s', (rel, full) => {
    const offenders = readFileSync(full, 'utf8')
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => TOO_HIGH.test(line))
      .map(([n, line]) => `${rel}:${n} ${line.trim()}`);
    expect(
      offenders,
      `${rel} reads an API error's details at err.data.<field>. createError nests ` +
        'them: the body is err.data, its data is err.data.data.',
    ).toEqual([]);
  });
});

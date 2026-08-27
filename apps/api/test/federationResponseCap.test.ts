import { describe, it, expect } from 'vitest';
import { readCappedText, MAX_RESPONSE_BYTES } from '../utils/federation/signing';

// A hostile — or merely buggy — partner can answer with a multi-gigabyte
// stream. `res.text()` would buffer all of it; the only bound was the abort
// timeout, too late on a fast link. `readCappedText` counts bytes as it reads
// and refuses past the ceiling.

function streamOf(chunks: Uint8Array[]) {
  let i = 0;
  return {
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < chunks.length) controller.enqueue(chunks[i++]);
        else controller.close();
      },
    }),
    text: async () => Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'),
  };
}

describe('capped response reader', () => {
  it('reads a normal body whole', async () => {
    const body = JSON.stringify({ ok: true, records: [1, 2, 3] });
    const res = streamOf([new TextEncoder().encode(body)]);
    expect(await readCappedText(res)).toBe(body);
  });

  it('refuses a body past the ceiling instead of buffering it', async () => {
    // One chunk just over the limit — the read must throw, not allocate it.
    const oversized = new Uint8Array(MAX_RESPONSE_BYTES + 1);
    const res = streamOf([oversized]);
    await expect(readCappedText(res)).rejects.toThrow(/size limit/);
  });

  it('refuses a body that only crosses the line across many chunks', async () => {
    // The counter is cumulative: a flood of small chunks cannot slip past by
    // staying individually small.
    const chunk = new Uint8Array(1024 * 1024); // 1 MB each
    const chunks = Array.from({ length: 20 }, () => chunk); // 20 MB total
    await expect(readCappedText(streamOf(chunks))).rejects.toThrow(/size limit/);
  });

  it('treats a bodyless response as empty', async () => {
    const res = { body: null, text: async () => '' };
    expect(await readCappedText(res)).toBe('');
  });
});

import { randomBytes } from 'crypto';
import { describe, expect, it } from 'vitest';
import { S3Storage } from '../../utils/storage/s3Driver';
import { resolveObjectKey } from '../../utils/storage/keys';

/**
 * The S3 driver against a real S3-compatible server.
 *
 * The unit suite proves the signature matches AWS's published vector and that
 * the URL we build is the one we meant. Neither can prove the part that
 * actually breaks in practice: that the bytes we sign are the bytes we send,
 * and that a real server accepts the result. A single misplaced header —
 * `content-length` signed but rewritten by the runtime, a payload hash taken
 * before a stream was consumed — passes every unit test and fails every
 * request.
 *
 * `run-integration-tests.sh` starts RustFS (the object store the Helm chart
 * ships as an optional subchart) and sets these variables. Without them the
 * file skips, so the suite still runs against Postgres alone.
 */

const endpoint = process.env.S3_TEST_ENDPOINT;
const accessKeyId = process.env.S3_TEST_ACCESS_KEY_ID ?? '';
const secretAccessKey = process.env.S3_TEST_SECRET_ACCESS_KEY ?? '';

const describeS3 = endpoint ? describe : describe.skip;

function storageFor(prefix = ''): S3Storage {
  return new S3Storage({
    endpoint: endpoint!,
    region: process.env.S3_TEST_REGION ?? 'us-east-1',
    bucket: process.env.S3_TEST_BUCKET ?? 'trackarr-itest',
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    prefix,
    createBucket: true,
    timeoutMs: 20_000,
  });
}

async function readAll(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  // Both a web ReadableStream and a Node Readable are async-iterable here.
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describeS3('S3 driver against a live object store', () => {
  it('creates the bucket on demand and round-trips an object', async () => {
    const storage = storageFor();
    const key = `logo-${randomBytes(8).toString('hex')}.png`;
    // Real binary, not ASCII: a signing or encoding bug that mangles high
    // bytes would survive a text-only test.
    const payload = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      randomBytes(4096),
    ]);

    await storage.put(key, payload, 'image/png');

    const object = await storage.get(key);
    expect(object).not.toBeNull();
    expect(object!.size).toBe(payload.length);
    expect(object!.contentType).toBe('image/png');
    expect(await readAll(object!.body)).toEqual(payload);

    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
  });

  it('answers null for an object that was never written', async () => {
    const storage = storageFor();
    expect(await storage.get(`absent-${randomBytes(8).toString('hex')}.png`))
      .toBeNull();
  });

  it('signs keys that need percent-encoding', async () => {
    // `!'()* ` are the characters encodeURIComponent leaves alone and AWS
    // wants encoded. Getting that wrong is a 403 that reads like a
    // credentials problem, so it is worth a real request.
    const storage = storageFor();
    const key = `logo (1)+[final]!'~-${randomBytes(4).toString('hex')}.png`;
    const resolved = resolveObjectKey(key);
    expect(resolved).toBe(key);

    await storage.put(resolved!, Buffer.from('encoded'), 'image/png');
    expect(await readAll((await storage.get(resolved!))!.body)).toEqual(
      Buffer.from('encoded')
    );
    await storage.delete(resolved!);
  });

  it('keeps prefixes apart', async () => {
    const name = `shared-${randomBytes(8).toString('hex')}.txt`;
    const a = storageFor('tenant-a');
    const b = storageFor('tenant-b');

    await a.put(name, Buffer.from('A'), 'text/plain');
    expect(await b.get(name)).toBeNull();
    expect(await readAll((await a.get(name))!.body)).toEqual(Buffer.from('A'));

    await a.delete(name);
  });

  it('refuses a traversal key before it reaches the network', async () => {
    const storage = storageFor('uploads');
    await expect(
      storage.put('../escaped.txt', Buffer.from('x'), 'text/plain')
    ).rejects.toThrow(/escaped the configured prefix/);
  });

  it('overwrites in place', async () => {
    const storage = storageFor();
    const key = `overwrite-${randomBytes(8).toString('hex')}.txt`;
    await storage.put(key, Buffer.from('first'), 'text/plain');
    await storage.put(key, Buffer.from('second'), 'text/plain');
    expect(await readAll((await storage.get(key))!.body)).toEqual(
      Buffer.from('second')
    );
    await storage.delete(key);
  });

  it('treats deleting an absent object as success', async () => {
    const storage = storageFor();
    await expect(
      storage.delete(`never-${randomBytes(8).toString('hex')}.txt`)
    ).resolves.toBeUndefined();
  });
});

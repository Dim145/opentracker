import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { FilesystemStorage } from '../utils/storage/fsDriver';
import { S3Storage } from '../utils/storage/s3Driver';
import {
  configuredDriver,
  createStorage,
  getStorage,
  resetStorage,
} from '../utils/storage';

async function drain(body: unknown): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as Readable) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

describe('FilesystemStorage', () => {
  let root: string;
  let base: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'trackarr-storage-'));
    base = join(root, 'uploads');
    await mkdir(base, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips an object', async () => {
    const storage = new FilesystemStorage(base);
    await storage.put('logo-abc.png', Buffer.from('PNGDATA'), 'image/png');

    const object = await storage.get('logo-abc.png');
    expect(object).not.toBeNull();
    expect(object!.size).toBe(7);
    expect(await drain(object!.body)).toBe('PNGDATA');

    await storage.delete('logo-abc.png');
    expect(await storage.get('logo-abc.png')).toBeNull();
  });

  it('creates intermediate directories on write', async () => {
    const storage = new FilesystemStorage(base);
    await storage.put('a/b/c.png', Buffer.from('x'), 'image/png');
    expect(await drain((await storage.get('a/b/c.png'))!.body)).toBe('x');
  });

  it('answers null rather than throwing when nothing is there', async () => {
    const storage = new FilesystemStorage(base);
    expect(await storage.get('missing.png')).toBeNull();
    // Deleting something absent is a no-op, so a double-upload that races
    // does not 500 on the cleanup of the previous file.
    await expect(storage.delete('missing.png')).resolves.toBeUndefined();
  });

  it('answers null when the uploads directory does not exist yet', async () => {
    // Fresh install, nothing uploaded. This must be a 404, not a 500.
    const storage = new FilesystemStorage(join(root, 'not-created'));
    expect(await storage.get('logo.png')).toBeNull();
  });

  it('answers null for a directory', async () => {
    const storage = new FilesystemStorage(base);
    await mkdir(join(base, 'subdir'));
    expect(await storage.get('subdir')).toBeNull();
  });

  it('refuses a symlink pointing out of the uploads directory', async () => {
    // The check no string analysis can do. `resolveObjectKey` sees an
    // ordinary filename; only realpath reveals where it lands.
    await writeFile(join(root, 'secret.txt'), 'SECRET');
    await symlink(join(root, 'secret.txt'), join(base, 'latest.png'));

    const storage = new FilesystemStorage(base);
    await expect(storage.get('latest.png')).rejects.toThrow(
      /resolves outside/
    );
  });

  it('turns a permission error into something an operator can act on', async () => {
    // The failure this covers shipped in 0.29.0: a fresh `uploads_data` volume
    // is created root-owned while the container runs as uid 65532, so the first
    // branding upload died on a bare `EACCES: permission denied, open …`. The
    // image now seeds the directory (apps/api/Dockerfile), but Docker will not
    // re-seed a volume that already exists, so the message still has to name
    // the cause and the fix.
    //
    // Skipped when the test process is root, because root ignores the mode
    // bits — which is exactly why the bug was invisible for so long.
    if (process.getuid?.() === 0) return;

    const locked = join(root, 'locked');
    await mkdir(locked);
    await chmod(locked, 0o500); // r-x: listable, not writable

    const storage = new FilesystemStorage(locked);
    await expect(
      storage.put('logo.png', Buffer.from('x'), 'image/png')
    ).rejects.toThrow(/Cannot write to the uploads directory .*\(EACCES\)/);
    // It has to carry the uid and the remedy, not just the errno.
    await expect(
      storage.put('logo.png', Buffer.from('x'), 'image/png')
    ).rejects.toThrow(/chown -R \d+:\d+/);

    await chmod(locked, 0o700); // so afterEach can remove it
  });

  it('refuses to write outside the uploads directory', async () => {
    // Keys reaching a driver have been through resolveObjectKey, so this is
    // the second line of defence rather than the first.
    const storage = new FilesystemStorage(base);
    await expect(
      storage.put('../escaped.png', Buffer.from('x'), 'image/png')
    ).rejects.toThrow(/outside/);
  });
});

describe('S3Storage — request shape', () => {
  const credentials = {
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  };

  const baseConfig = {
    endpoint: 'http://rustfs-svc:9000',
    region: 'us-east-1',
    bucket: 'trackarr',
    credentials,
    forcePathStyle: true,
    prefix: '',
    createBucket: false,
    timeoutMs: 5000,
  };

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function lastUrl(): URL {
    return fetchMock.mock.calls.at(-1)![0] as URL;
  }

  function lastHeaders(): Record<string, string> {
    return (fetchMock.mock.calls.at(-1)![1] as RequestInit)
      .headers as Record<string, string>;
  }

  it('addresses path-style as endpoint/bucket/key', async () => {
    const storage = new S3Storage(baseConfig);
    await storage.put('logo-ab.png', Buffer.from('x'), 'image/png');
    expect(lastUrl().href).toBe('http://rustfs-svc:9000/trackarr/logo-ab.png');
  });

  it('addresses virtual-hosted as bucket.endpoint/key', async () => {
    const storage = new S3Storage({
      ...baseConfig,
      endpoint: 'https://s3.eu-west-3.amazonaws.com',
      forcePathStyle: false,
    });
    await storage.put('logo-ab.png', Buffer.from('x'), 'image/png');
    expect(lastUrl().href).toBe(
      'https://trackarr.s3.eu-west-3.amazonaws.com/logo-ab.png'
    );
  });

  it('applies the configured prefix', async () => {
    const storage = new S3Storage({ ...baseConfig, prefix: '/uploads//' });
    await storage.put('logo-ab.png', Buffer.from('x'), 'image/png');
    expect(lastUrl().pathname).toBe('/trackarr/uploads/logo-ab.png');
  });

  it('percent-encodes the key without eating the separators', async () => {
    const storage = new S3Storage({ ...baseConfig, prefix: 'uploads' });
    await storage.put('a b/logo (1).png', Buffer.from('x'), 'image/png');
    expect(lastUrl().pathname).toBe(
      '/trackarr/uploads/a%20b/logo%20%281%29.png'
    );
  });

  it('refuses a key that would escape the prefix', async () => {
    // resolveObjectKey rejects `..` before a key ever gets here, so this is
    // the driver's own assertion. It matters because the escape is silent:
    // `new URL()` collapses the `..` during construction, so without the
    // check the request would succeed against the wrong object.
    const storage = new S3Storage({ ...baseConfig, prefix: 'uploads' });
    await expect(
      storage.put('../secrets/key.pem', Buffer.from('x'), 'image/png')
    ).rejects.toThrow(/escaped the configured prefix/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a key that would escape the bucket', async () => {
    const storage = new S3Storage(baseConfig);
    await expect(
      storage.put('../other-bucket/key', Buffer.from('x'), 'image/png')
    ).rejects.toThrow(/escaped the bucket path/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signs every request and declares the payload hash', async () => {
    const storage = new S3Storage(baseConfig);
    await storage.put('logo.png', Buffer.from('PNGDATA'), 'image/png');

    const headers = lastHeaders();
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/
    );
    // The hash is of the body we actually send, and it must appear in
    // SignedHeaders — an unsigned content hash is one an intermediary can
    // rewrite along with the body.
    expect(headers['x-amz-content-sha256']).toBe(
      createHash('sha256').update('PNGDATA').digest('hex')
    );
    expect(headers.authorization).toContain('x-amz-content-sha256');
    expect(headers['content-type']).toBe('image/png');
  });

  describe('what get() reports about the body it hands over', () => {
    it('ignores content-length when the response was compressed', async () => {
      // The bug that served a truncated file with a 200 and a year of
      // `immutable` caching on top. undici adds `accept-encoding: gzip,
      // deflate` itself and transparently decompresses, leaving the COMPRESSED
      // length in the header — which the read routes echo as their outgoing
      // `Content-Length`. Measured on a real store: a 4046-byte SVG reported
      // `content-length: 86`, and the client got 86 bytes.
      fetchMock.mockImplementation(
        async () =>
          new Response('decompressed body', {
            status: 200,
            headers: {
              'content-length': '86',
              'content-encoding': 'gzip',
              'content-type': 'image/svg+xml',
            },
          }),
      );
      const storage = new S3Storage(baseConfig);
      const object = await storage.get('logo.svg');

      expect(object).toBeTruthy();
      expect(object!.size).toBeUndefined(); // no claim beats a wrong one
      expect(object!.contentType).toBe('image/svg+xml');
    });

    it('trusts content-length when the encoding is identity', async () => {
      fetchMock.mockImplementation(
        async () =>
          new Response('body', {
            status: 200,
            headers: { 'content-length': '4', 'content-encoding': 'identity' },
          }),
      );
      const storage = new S3Storage(baseConfig);
      expect((await storage.get('a.bin'))!.size).toBe(4);
    });

    it('reports no size when the store sends no content-length', async () => {
      fetchMock.mockImplementation(
        async () => new Response('chunked body', { status: 200 }),
      );
      const storage = new S3Storage(baseConfig);
      expect((await storage.get('a.bin'))!.size).toBeUndefined();
    });

    it('asks the store not to compress', async () => {
      const storage = new S3Storage(baseConfig);
      fetchMock.mockImplementation(
        async () => new Response('x', { status: 200 }),
      );
      await storage.get('a.bin');
      expect(lastHeaders()['accept-encoding']).toBe('identity');
      // …and not by signing it: a proxy rewriting the header must not
      // invalidate the signature.
      expect(lastHeaders().authorization).not.toContain('accept-encoding');
    });

    it('leaves the deadline off the body it hands over', async () => {
      // `S3_TIMEOUT_MS` is a deadline on the request. It used to be attached to
      // the fetch as an `AbortSignal.timeout`, which stays attached to the
      // response BODY — so a slow client reading a large object had the stream
      // aborted mid-download, after the 200 was already flushed.
      const storage = new S3Storage(baseConfig);
      fetchMock.mockImplementation(
        async () => new Response('x', { status: 200 }),
      );
      const object = await storage.get('a.bin');

      const signal = (fetchMock.mock.calls.at(-1)![1] as RequestInit)
        .signal as AbortSignal;
      expect(signal.aborted).toBe(false);
      // The timer is cleared once the headers are in, so nothing can abort the
      // stream afterwards. Reading it to the end proves it survives.
      const text = await new Response(object!.body as ReadableStream).text();
      expect(text).toBe('x');
    });

    it('turns a 403 read into a legible error, not a null', async () => {
      fetchMock.mockImplementation(
        async () =>
          new Response('<Error><Code>AccessDenied</Code></Error>', {
            status: 403,
          }),
      );
      const storage = new S3Storage(baseConfig);
      await expect(storage.get('a.bin')).rejects.toThrow(/AccessDenied/);
    });
  });

  it('turns a 404 read into null rather than an error', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const storage = new S3Storage(baseConfig);
    expect(await storage.get('missing.png')).toBeNull();
  });

  it('reports the S3 error code when a read fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })
    );
    const storage = new S3Storage(baseConfig);
    await expect(storage.get('logo.png')).rejects.toThrow(/AccessDenied/);
  });

  it('treats a delete of something absent as success', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const storage = new S3Storage(baseConfig);
    await expect(storage.delete('gone.png')).resolves.toBeUndefined();
  });

  it('creates the bucket once when asked and the first write 404s', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response('<Error><Code>NoSuchBucket</Code></Error>', {
          status: 404,
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 })) // create
      .mockResolvedValueOnce(new Response(null, { status: 200 })); // retry

    const storage = new S3Storage({ ...baseConfig, createBucket: true });
    await storage.put('logo.png', Buffer.from('x'), 'image/png');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[1][0] as URL).pathname).toBe('/trackarr/');
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('PUT');

    // Second write: the bucket is known to exist, so no probe.
    await storage.put('favicon.ico', Buffer.from('x'), 'image/x-icon');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not create a bucket that was not asked for', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<Error><Code>NoSuchBucket</Code></Error>', { status: 404 })
    );
    const storage = new S3Storage(baseConfig);
    await expect(
      storage.put('logo.png', Buffer.from('x'), 'image/png')
    ).rejects.toThrow(/NoSuchBucket/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('driver selection', () => {
  beforeEach(() => {
    resetStorage();
    // getStorage logs the resolved backend once; keep it out of the report.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetStorage();
  });

  it('defaults to the filesystem, so an existing deployment is unchanged', () => {
    vi.stubEnv('STORAGE_DRIVER', '');
    expect(configuredDriver()).toBe('fs');
    expect(createStorage().driver).toBe('fs');
  });

  it('refuses a driver name it does not know', () => {
    // Falling back to `fs` on a typo would put uploads somewhere the operator
    // did not intend, and only show up as files missing from the bucket later.
    vi.stubEnv('STORAGE_DRIVER', 'S3 ');
    expect(configuredDriver()).toBe('s3'); // trimmed and lowercased
    vi.stubEnv('STORAGE_DRIVER', 'minio');
    expect(() => configuredDriver()).toThrow(/must be "fs" or "s3"/);
  });

  it('names every missing S3 variable at once', () => {
    vi.stubEnv('STORAGE_DRIVER', 's3');
    expect(() => createStorage()).toThrow(
      /S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY are not set/
    );
  });

  it('says which variable is a bad URL rather than "Invalid URL"', () => {
    vi.stubEnv('STORAGE_DRIVER', 's3');
    vi.stubEnv('S3_BUCKET', 'trackarr');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'k');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 's');

    // Unparseable.
    vi.stubEnv('S3_ENDPOINT', 'not a url');
    expect(() => createStorage()).toThrow(/S3_ENDPOINT is not a valid URL/);

    // Parseable but wrong, which is the one people actually type: `host:9000`
    // is read as the scheme `host:` with the path `9000`, and would otherwise
    // survive until a key is appended and throws a bare "Invalid URL" from
    // somewhere that names nothing.
    vi.stubEnv('S3_ENDPOINT', 'rustfs-svc:9000');
    expect(() => createStorage()).toThrow(/needs an http:\/\/ or https:\/\//);
  });

  it('reads credentials through readSecret, so *_FILE works', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trackarr-secret-'));
    await writeFile(join(dir, 'key'), 'from-a-docker-secret\n');

    vi.stubEnv('STORAGE_DRIVER', 's3');
    vi.stubEnv('S3_ENDPOINT', 'http://rustfs-svc:9000');
    vi.stubEnv('S3_BUCKET', 'trackarr');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'plain-env-key');
    vi.stubEnv('S3_SECRET_ACCESS_KEY_FILE', join(dir, 'key'));

    const storage = createStorage();
    expect(storage.driver).toBe('s3');
    // The value itself must never surface in the describe() line that goes to
    // the log.
    expect(storage.describe()).not.toContain('from-a-docker-secret');
    expect(storage.describe()).toBe(
      's3 http://rustfs-svc:9000 bucket=trackarr region=us-east-1 path-style'
    );

    await rm(dir, { recursive: true, force: true });
  });

  it('builds the backend once and reuses it', () => {
    vi.stubEnv('STORAGE_DRIVER', 'fs');
    expect(getStorage()).toBe(getStorage());
    resetStorage();
    expect(getStorage()).not.toBe(null);
  });
});

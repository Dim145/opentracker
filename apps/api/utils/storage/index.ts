/**
 * Where uploaded files live.
 *
 * `STORAGE_DRIVER` picks the backend and defaults to `fs`, so a deployment
 * that sets nothing behaves exactly as it did before this module existed.
 *
 *   STORAGE_DRIVER=fs   files under UPLOADS_DIR (the default)
 *   STORAGE_DRIVER=s3   any S3-compatible object store
 *
 * The reason to switch is horizontal scale: with `fs`, every API replica has
 * to write the same volume — a ReadWriteMany PVC on Kubernetes, a shared mount
 * in Compose — and that is the API's last blocker to adding replicas freely.
 * See doc/guide/object-storage.md and doc/guide/scaling.md.
 *
 * Configuration is resolved lazily, on first use, rather than at boot. That is
 * a deliberate trade: a typo in the S3 settings surfaces as a 500 on the first
 * upload with a message naming the missing variable, instead of a crash-loop
 * that also takes down `/api/health`, the tracker's health probe and every
 * page the web tier renders. The `describe()` line is logged once when the
 * driver is built, so the resolved configuration is still visible in the logs.
 */

import { readOptionalSecret, readSecret } from '../secrets';
import { FilesystemStorage, defaultUploadsDir } from './fsDriver';
import { S3Storage } from './s3Driver';
import type { ObjectStorage, StorageDriverName } from './types';

// Deliberately no re-exports of the sibling modules: `utils/**` is
// auto-imported by Nitro, and a name exported from two files in the scan set
// is ambiguous. Import `resolveObjectKey` from `./keys`, the drivers from
// their own files.

const DEFAULT_S3_TIMEOUT_MS = 30_000;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function configuredDriver(): StorageDriverName {
  const raw = (process.env.STORAGE_DRIVER || 'fs').trim().toLowerCase();
  if (raw === 'fs') return 'fs';
  if (raw === 's3') return 's3';
  // No lenient aliases. A typo'd driver name silently falling back to `fs`
  // would mean uploads land somewhere the operator did not intend, and only
  // show up as files missing from the bucket much later.
  throw new Error(
    `STORAGE_DRIVER must be "fs" or "s3" (got "${process.env.STORAGE_DRIVER}")`
  );
}

function buildS3Storage(): S3Storage {
  const missing: string[] = [];
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  if (!endpoint) missing.push('S3_ENDPOINT');
  if (!bucket) missing.push('S3_BUCKET');

  // Credentials go through readSecret so a `*_FILE` Docker secret works the
  // same way it does for the database and session secrets.
  let accessKeyId = '';
  let secretAccessKey = '';
  try {
    accessKeyId = readSecret('S3_ACCESS_KEY_ID');
  } catch {
    missing.push('S3_ACCESS_KEY_ID');
  }
  try {
    secretAccessKey = readSecret('S3_SECRET_ACCESS_KEY');
  } catch {
    missing.push('S3_SECRET_ACCESS_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `STORAGE_DRIVER=s3 but ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } not set. ` +
        'Each accepts a Docker secret through the matching *_FILE variable.'
    );
  }

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint!);
  } catch {
    // `new URL` throws a bare "Invalid URL" that names nothing. Say which
    // variable, and what it is missing — a scheme, nine times out of ten.
    throw new Error(
      `S3_ENDPOINT is not a valid URL: "${endpoint}". ` +
        'It needs a scheme, e.g. https://s3.eu-west-3.amazonaws.com'
    );
  }
  // `host:9000` parses — as scheme `host:` with path `9000` — and only fails
  // much later, when a key is appended to it, as another bare "Invalid URL".
  // Catch the missing scheme here, where we can name the variable.
  if (parsedEndpoint.protocol !== 'http:' && parsedEndpoint.protocol !== 'https:') {
    throw new Error(
      `S3_ENDPOINT is not a valid URL: "${endpoint}". ` +
        'It needs an http:// or https:// scheme, e.g. http://rustfs-svc:9000'
    );
  }

  const forcePathStyle = parseBoolean(process.env.S3_FORCE_PATH_STYLE, true);
  if (forcePathStyle && /(^|\.)amazonaws\.com$/i.test(parsedEndpoint.hostname)) {
    console.warn(
      '[Storage] S3_ENDPOINT looks like AWS but S3_FORCE_PATH_STYLE is on. ' +
        'AWS prefers virtual-hosted addressing — set S3_FORCE_PATH_STYLE=false.'
    );
  }

  const timeoutRaw = Number(process.env.S3_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw > 0
      ? timeoutRaw
      : DEFAULT_S3_TIMEOUT_MS;

  return new S3Storage({
    endpoint: endpoint!,
    bucket: bucket!,
    region: process.env.S3_REGION?.trim() || 'us-east-1',
    credentials: {
      accessKeyId,
      secretAccessKey,
      sessionToken: readOptionalSecret('S3_SESSION_TOKEN'),
    },
    forcePathStyle,
    prefix: process.env.S3_PREFIX || '',
    createBucket: parseBoolean(process.env.S3_CREATE_BUCKET, false),
    timeoutMs,
  });
}

/** Build the configured driver without consulting or filling the cache. */
export function createStorage(): ObjectStorage {
  return configuredDriver() === 's3'
    ? buildS3Storage()
    : new FilesystemStorage(defaultUploadsDir());
}

let cached: ObjectStorage | null = null;

/**
 * The process-wide storage backend. Built on first call and reused; the S3
 * driver holds no connection state beyond an "I have seen this bucket" flag,
 * so one instance per process is right.
 */
export function getStorage(): ObjectStorage {
  if (!cached) {
    cached = createStorage();
    console.log(`[Storage] ${cached.describe()}`);
  }
  return cached;
}

/** Drop the cached driver. For tests that change the environment. */
export function resetStorage(): void {
  cached = null;
}

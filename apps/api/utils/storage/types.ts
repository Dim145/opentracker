import type { Readable } from 'stream';

export type StorageDriverName = 'fs' | 's3';

export interface StoredObject {
  /**
   * A Node `Readable` (filesystem) or a web `ReadableStream` (S3 — it is
   * `Response.body` handed straight through). h3's `sendStream` accepts
   * either, which is why the read routes do not have to know which driver
   * answered.
   */
  body: Readable | ReadableStream<Uint8Array>;
  /** Absent when the backend did not report one. */
  size?: number;
  /**
   * What the backend has stored as the object's type. The read routes do NOT
   * trust this — they derive `Content-Type` from the extension, because that
   * is what the SVG sandbox CSP keys off. It is here for logging and for the
   * `Content-Type` of a future non-branding consumer.
   */
  contentType?: string;
}

/**
 * The two implementations behind `STORAGE_DRIVER`.
 *
 * Keys handed to these methods must already have been through
 * `resolveObjectKey()`. The drivers re-assert containment anyway — the
 * filesystem one because `realpath` catches symlink traps that no string
 * check can, the S3 one because a URL is normalised by the runtime after we
 * build it.
 */
export interface ObjectStorage {
  readonly driver: StorageDriverName;

  /** Overwrites any existing object at `key`. */
  put(key: string, data: Buffer, contentType: string): Promise<void>;

  /** `null` when the object does not exist. Anything else throws. */
  get(key: string): Promise<StoredObject | null>;

  /** Succeeds when the object was already absent. */
  delete(key: string): Promise<void>;

  /** One line for the boot log, with no secrets in it. */
  describe(): string;
}

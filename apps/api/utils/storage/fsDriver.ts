/**
 * The filesystem driver — what the API has always done, now behind the
 * `ObjectStorage` interface.
 *
 * This is the default, so an existing deployment that sets nothing keeps
 * exactly the behaviour it had: files under `UPLOADS_DIR`, served by the two
 * `/uploads` routes.
 *
 * The containment logic is the one that was in
 * `routes/api/uploads/[...path].get.ts`, kept whole rather than rewritten. Its
 * two checks do different jobs and both are needed:
 *
 *   1. `resolve()` + prefix — catches a path that escapes before we touch the
 *      filesystem. `resolveObjectKey()` already rejects `..`, so this is the
 *      second line, not the first.
 *   2. `realpath()` + prefix — catches a SYMLINK inside the uploads directory
 *      pointing out of it (`latest -> ../../etc`). No amount of string
 *      analysis finds that one; only asking the kernel does.
 */

import { createReadStream } from 'fs';
import { mkdir, realpath, stat, unlink, writeFile } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';
import type { ObjectStorage, StoredObject } from './types';

export function defaultUploadsDir(): string {
  return (
    process.env.UPLOADS_DIR ||
    (process.env.NODE_ENV === 'production'
      ? '/app/data/uploads'
      : join(process.cwd(), 'public', 'uploads'))
  );
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export class FilesystemStorage implements ObjectStorage {
  readonly driver = 'fs' as const;

  constructor(private readonly baseDir: string = defaultUploadsDir()) {}

  describe(): string {
    return `filesystem at ${this.baseDir}`;
  }

  /**
   * Resolve `key` to an absolute path inside the uploads directory, or throw.
   *
   * `mustExist` decides whether the base directory is realpath'd (read and
   * delete, where it has to be there) or merely resolved (write, which creates
   * it). Resolving a base that does not exist yet would otherwise throw ENOENT
   * before the very first upload.
   */
  private async resolvePath(key: string, mustExist: boolean): Promise<string> {
    const baseReal = mustExist
      ? await realpath(this.baseDir)
      : resolve(this.baseDir);
    const candidate = resolve(baseReal, key);
    if (candidate !== baseReal && !candidate.startsWith(baseReal + sep)) {
      throw new Error(`Refusing to address "${key}" outside ${baseReal}`);
    }
    return candidate;
  }

  async get(key: string): Promise<StoredObject | null> {
    let candidate: string;
    try {
      candidate = await this.resolvePath(key, true);
    } catch (error) {
      // The uploads directory itself is missing — nothing has been uploaded
      // yet on a fresh install. That is a 404, not a 500.
      if (isEnoent(error)) return null;
      throw error;
    }

    let finalPath: string;
    let stats: Awaited<ReturnType<typeof stat>>;
    try {
      // realpath BEFORE stat: a symlink out of the directory has to be caught
      // by the containment check below, not merely followed.
      finalPath = await realpath(candidate);
      stats = await stat(finalPath);
    } catch (error) {
      if (isEnoent(error)) return null;
      throw error;
    }

    const baseReal = await realpath(this.baseDir);
    if (finalPath !== baseReal && !finalPath.startsWith(baseReal + sep)) {
      throw new Error(`Refusing to serve "${key}" — it resolves outside ${baseReal}`);
    }

    // A directory is not an object. Reading one streams EISDIR at the client.
    if (!stats.isFile()) return null;

    return { body: createReadStream(finalPath), size: stats.size };
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<void> {
    const target = await this.resolvePath(key, false);
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    } catch (error) {
      // A bare EACCES here says nothing an operator can act on, and it has one
      // overwhelmingly likely cause: the uploads volume is owned by root while
      // the container runs as a non-root user. The image now seeds a
      // correctly-owned directory (apps/api/Dockerfile), but Docker only seeds
      // a volume that is EMPTY — a volume created empty by an earlier version
      // keeps its root ownership through the upgrade, and this is where that
      // shows up.
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
        const uid = process.getuid?.() ?? 'unknown';
        const gid = process.getgid?.() ?? 'unknown';
        throw new Error(
          `Cannot write to the uploads directory ${this.baseDir} (${code}). ` +
            `This process runs as uid ${uid}:${gid}, so the volume mounted there ` +
            'is most likely owned by someone else. Hand it over with ' +
            `\`docker run --rm -v <volume>:/d alpine chown -R ${uid}:${gid} /d\`, ` +
            'or switch to STORAGE_DRIVER=s3 (doc/guide/object-storage.md).',
          { cause: error }
        );
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    let target: string;
    try {
      target = await this.resolvePath(key, true);
    } catch (error) {
      if (isEnoent(error)) return;
      throw error;
    }
    try {
      await unlink(target);
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
  }
}

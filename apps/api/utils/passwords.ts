import { scrypt as scryptCallback, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

/**
 * Server-side password hashing for the *panic password* only.
 *
 * Regular user authentication uses Zero-Knowledge proofs (no password ever
 * reaches the server). The panic password is the one exception: an admin
 * provides it during initial setup so we can use it later as a key for
 * emergency database encryption.
 *
 * We previously got these helpers from `nuxt-auth-utils`. Since we dropped
 * that module along with the Nitro standalone migration, we re-implement
 * them with Node's built-in scrypt + a `salt:hash` (hex) format.
 */

const scrypt = promisify<string | Buffer, Buffer, number, Buffer>(scryptCallback);

const SALT_LEN = 16;
const KEY_LEN = 64;

/** Hash a password using scrypt. Returns `<saltHex>:<hashHex>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const hash = await scrypt(password, salt, KEY_LEN);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/** Constant-time comparison of a password against a stored `salt:hash`. */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const sep = stored.indexOf(':');
  if (sep <= 0) return false;
  const salt = Buffer.from(stored.slice(0, sep), 'hex');
  const expected = Buffer.from(stored.slice(sep + 1), 'hex');
  if (salt.length !== SALT_LEN || expected.length !== KEY_LEN) return false;

  const candidate = await scrypt(password, salt, KEY_LEN);
  return timingSafeEqual(expected, candidate);
}

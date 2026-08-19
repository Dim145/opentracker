/**
 * Panic-mode encryption primitives.
 *
 * Format on the wire: each encrypted field is `iv:ct:tag` in base64 —
 * a *fresh* 12-byte IV is generated per call and stored inline. The
 * previous design (a single global IV reused for every record under
 * the same key) catastrophically broke AES-GCM's confidentiality and
 * authenticity guarantees: under nonce reuse, GMAC tags become
 * forgeable and ciphertexts XOR-cancel into known-plaintext attacks.
 *
 * For backward compatibility while transitioning, `decrypt` also
 * accepts the legacy `ct:tag` shape when a `legacyIv` is supplied —
 * the panic-restore route passes the old `panic_state.encryption_iv`
 * through this argument so existing encrypted DBs can still be
 * recovered.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
} from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
// 12-byte IVs are the AES-GCM standard (96-bit nonce); previous code
// used 16 bytes, which is allowed but strictly worse — extra entropy
// gets folded into the auth-tag derivation and the spec is built
// around 96 bits.
const IV_LENGTH = 12;

export async function deriveKey(
  password: string,
  salt: Buffer
): Promise<Buffer> {
  return (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
}

/**
 * Encrypt with a fresh per-call IV. Output: `iv:ct:tag` (all base64).
 */
export function encrypt(text: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${encrypted}:${authTag.toString('base64')}`;
}

/**
 * Decrypt either format:
 *   - `iv:ct:tag` (current — three parts)
 *   - `ct:tag`    (legacy — two parts; requires `legacyIv`)
 * Throws on auth-tag mismatch. The caller treats that as data drift
 * and can choose to skip the field rather than crash the restore
 * loop.
 */
export function decrypt(
  encryptedData: string,
  key: Buffer,
  legacyIv?: Buffer
): string {
  const parts = encryptedData.split(':');
  let iv: Buffer;
  let encrypted: string;
  let authTag: string;
  if (parts.length === 3) {
    [iv, encrypted, authTag] = [
      Buffer.from(parts[0]!, 'base64'),
      parts[1]!,
      parts[2]!,
    ];
  } else if (parts.length === 2 && legacyIv) {
    [iv, encrypted, authTag] = [legacyIv, parts[0]!, parts[1]!];
  } else {
    throw new Error('Malformed ciphertext (expected iv:ct:tag or legacy ct:tag with legacyIv)');
  }
  // `authTagLength` n'est pas décoratif : sans lui, Node accepte pour AES-GCM
  // des tags de 4, 8, 12, 13, 14, 15 ou 16 octets, et le tag vient d'ici même —
  // de la chaîne stockée en base. Un attaquant capable d'écrire en base peut
  // donc le tronquer à 4 octets et ramener le coût d'une forge de 2^128 à 2^32 ;
  // avec GCM une forge réussie sur tag court fait fuiter la sous-clé
  // d'authentification H, ce qui ouvre ensuite des forges arbitraires. C'est
  // précisément le scénario que le mode panique existe pour couvrir : une base
  // compromise. Node déprécie d'ailleurs l'omission depuis DEP0182.
  //
  // Aucun risque pour l'existant : le chiffrement n'a jamais passé d'option, et
  // le défaut de Node pour GCM est justement 16 octets — vérifié sur les deux
  // formats, courant `iv:ct:tag` et hérité `ct:tag`.
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function generateSalt(): string {
  return randomBytes(32).toString('base64');
}

export function encryptField(
  value: string | null | undefined,
  key: Buffer
): string | null {
  if (value == null) return null;
  return encrypt(value, key);
}

export function decryptField(
  value: string | null | undefined,
  key: Buffer,
  legacyIv?: Buffer
): string | null {
  if (value == null) return null;
  return decrypt(value, key, legacyIv);
}

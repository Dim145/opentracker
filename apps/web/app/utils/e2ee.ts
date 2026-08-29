/**
 * Optional end-to-end encryption for private conversations.
 *
 * The shape follows one promise made to the member, and everything else
 * falls out of it: **nobody else can read this, including you on another
 * device**. So the private key is generated non-extractable, kept in
 * IndexedDB, and never leaves the browser that made it. There is no
 * backup, no sync and no recovery — because each of those would be a way
 * for the key to exist somewhere else, which is the thing being promised
 * against.
 *
 * The curve is P-256 rather than X25519. X25519 was measured working in a
 * current browser and is the nicer primitive, but a single curve the whole
 * fleet supports avoids a failure that is very hard to explain: two
 * members unable to talk because their browsers chose differently. The
 * key row records `alg`, so moving later is a migration rather than a
 * guess.
 */

const DB_NAME = 'trackarr-messaging';
const STORE = 'keys';
const KEY_ID = 'identity';

export interface StoredIdentity {
  privateKey: CryptoKey;
  publicKeyRaw: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromB64url = (value: string) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

/** The identity this browser holds, if it has one. */
export async function loadIdentity(): Promise<StoredIdentity | null> {
  try {
    return (await idbGet<StoredIdentity>(KEY_ID)) ?? null;
  } catch {
    // A browser with storage disabled cannot hold a key, which is the
    // same situation as not having one — the caller offers a plain
    // conversation.
    return null;
  }
}

/**
 * Make a key for this browser.
 *
 * Never called on a page load. It runs when somebody has been told what
 * it means and said yes, because generating one silently on a second
 * device is exactly the accident this design has to avoid.
 */
export async function createIdentity(): Promise<StoredIdentity> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    // Non-extractable. The key cannot be read back out even by this code,
    // which is what makes "it never leaves this browser" a property of the
    // platform rather than a promise from the application.
    false,
    ['deriveKey', 'deriveBits']
  );
  const raw = await crypto.subtle.exportKey('spki', pair.publicKey);
  const identity: StoredIdentity = {
    privateKey: pair.privateKey,
    publicKeyRaw: b64url(raw),
  };
  await idbPut(KEY_ID, identity);
  return identity;
}

/** Forget this browser's key. What it sealed becomes unreadable, forever. */
export async function discardIdentity(): Promise<void> {
  await idbDelete(KEY_ID);
}

/**
 * The symmetric key for a conversation with `peerPublicKey`.
 *
 * ECDH to a shared secret, then HKDF to an AES-GCM key. The conversation
 * id goes into the HKDF info, so two members who share several encrypted
 * conversations do not reuse one key across them — a ciphertext moved
 * from one thread to another would otherwise still decrypt.
 */
export async function conversationKey(
  identity: StoredIdentity,
  peerPublicKey: string,
  conversationId: string
): Promise<CryptoKey> {
  const peer = await crypto.subtle.importKey(
    'spki',
    fromB64url(peerPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peer },
    identity.privateKey,
    256
  );

  const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, [
    'deriveKey',
  ]);

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('trackarr-messaging-v1'),
      info: new TextEncoder().encode(conversationId),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface Sealed {
  cipher: string;
  iv: string;
}

export async function seal(key: CryptoKey, text: string): Promise<Sealed> {
  // A fresh IV per message. Reusing one under AES-GCM does not merely
  // weaken it, it breaks it outright.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text)
  );
  return { cipher: b64url(cipher), iv: b64url(iv.buffer) };
}

/**
 * Null rather than a throw when it cannot be read.
 *
 * A message sealed to a key this browser no longer holds is the expected
 * state after a rotation, not an error — the thread renders it as
 * unreadable and says why, which is more use than an exception.
 */
export async function open(
  key: CryptoKey,
  sealed: Sealed
): Promise<string | null> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64url(sealed.iv) },
      key,
      fromB64url(sealed.cipher)
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

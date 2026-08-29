import {
  conversationKey,
  createIdentity,
  discardIdentity,
  loadIdentity,
  open as openSealed,
  seal,
  type StoredIdentity,
} from '~/utils/e2ee';

/**
 * The encrypted half of a conversation, and the states it can be in.
 *
 * Four, and naming them is most of the work — the interface has to say
 * which one it is, because "you cannot read this" and "this failed to
 * load" look identical to somebody who was not told the difference:
 *
 *   ready    — this browser holds the key and can read the thread
 *   noKey    — this browser has no identity yet
 *   foreign  — there is an identity, but the thread was sealed to another
 *              one. This is the state after using a second device, and
 *              the only way out is destructive.
 *   plain    — the conversation is not encrypted
 *   peerKeyBroken
 *            — the correspondent published something this browser cannot
 *              use as a key. Named rather than folded into `noKey`
 *              because the two need opposite advice: `noKey` is fixed by
 *              generating one here, and this one cannot be fixed here at
 *              all — the other side has to republish.
 */
export type CryptoState =
  | 'plain'
  | 'ready'
  | 'noKey'
  | 'foreign'
  | 'peerKeyBroken';

export function useConversationCrypto() {
  const state = ref<CryptoState>('plain');
  const identity = ref<StoredIdentity | null>(null);
  let key: CryptoKey | null = null;

  async function ensureIdentity() {
    identity.value ??= await loadIdentity();
    return identity.value;
  }

  /**
   * Prepare for a conversation. Returns the state the caller should show.
   *
   * `foreign` is told from `ready` by comparing this browser's key with
   * the one the member has published — not by trying to decrypt the
   * thread's history, which stays unreadable after a rotation no matter
   * what and left the state stuck there.
   */
  /**
   * This member's published public key, whichever browser published it.
   * Cached: it changes only when they rotate, and this asks on every
   * thread open otherwise.
   */
  const publishedKey = ref<string | null | undefined>(undefined);

  async function loadPublished(force = false) {
    if (!force && publishedKey.value !== undefined) return publishedKey.value;
    try {
      const res = await $fetch<{ published: boolean; publicKey?: string }>(
        '/api/messaging/keys'
      );
      publishedKey.value = res.published ? (res.publicKey ?? null) : null;
    } catch {
      publishedKey.value = null;
    }
    return publishedKey.value;
  }

  async function prepare(opts: {
    encrypted: boolean;
    conversationId: string;
    peerPublicKey?: string | null;
  }): Promise<CryptoState> {
    key = null;
    if (!opts.encrypted) return (state.value = 'plain');

    const mine = await ensureIdentity();
    if (!mine) return (state.value = 'noKey');

    /*
     * `foreign` is decided by WHICH KEY IS PUBLISHED, not by whether the
     * thread's history happens to open.
     *
     * It used to be the latter: decrypt the newest ciphertext and, on
     * failure, call the browser foreign. That is right on a second
     * device and wrong immediately after a deliberate rotation — the old
     * messages can never open again, by definition, so the state stayed
     * `foreign` for ever and the one action offered to escape it did not
     * escape it. Clicking "use this device instead" appeared to do
     * nothing at all.
     *
     * What actually decides whether this browser can take part is
     * whether the correspondent encrypts to the key it holds. If the
     * published key is this one, everything from here on works; the
     * history sealed to an older key stays unreadable and each message
     * says so on its own line.
     */
    if ((await loadPublished()) !== mine.publicKeyRaw) {
      return (state.value = 'foreign');
    }

    // Their key, not mine. Saying `noKey` here blamed the wrong side.
    if (!opts.peerPublicKey) return (state.value = 'peerKeyBroken');

    // A peer key WebCrypto refuses is not an exception to propagate.
    // The server rejects malformed keys at publication now, but rows
    // predating that check still exist, and a key for a curve this
    // browser does not support would fail here too. Letting the
    // DOMException escape left the page doing nothing at all.
    try {
      key = await conversationKey(mine, opts.peerPublicKey, opts.conversationId);
    } catch {
      key = null;
      return (state.value = 'peerKeyBroken');
    }

    return (state.value = 'ready');
  }

  async function decrypt(sealed: { cipher: string; iv: string }) {
    if (!key) return null;
    return openSealed(key, sealed);
  }

  async function encrypt(text: string) {
    if (!key) throw new Error('no conversation key');
    return seal(key, text);
  }

  /**
   * Make an identity for this browser and publish it.
   *
   * Deliberately not called on page load. Generating a key silently on a
   * second device is precisely the accident that would break the promise
   * — the caller has to have shown the warning first.
   */
  async function generateAndPublish(deviceLabel?: string) {
    const created = await createIdentity();
    identity.value = created;
    await $fetch('/api/messaging/keys', {
      method: 'PUT',
      body: { publicKey: created.publicKeyRaw, deviceLabel },
    });
    // This browser is now the one the world encrypts to. Recorded here
    // rather than re-fetched, so the very next `prepare` sees it.
    publishedKey.value = created.publicKeyRaw;
    return created;
  }

  /** Replace the identity. Everything the old one sealed is gone. */
  async function rotate(deviceLabel?: string) {
    await discardIdentity();
    identity.value = null;
    return generateAndPublish(deviceLabel);
  }

  return {
    state,
    identity,
    publishedKey,
    loadPublished,
    prepare,
    decrypt,
    encrypt,
    ensureIdentity,
    generateAndPublish,
    rotate,
  };
}

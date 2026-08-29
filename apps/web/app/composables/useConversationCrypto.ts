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
   * `probe` is a ciphertext from the thread, used to tell `ready` from
   * `foreign`: deriving a key always succeeds, so the only honest test is
   * whether it actually opens something the thread already contains.
   */
  async function prepare(opts: {
    encrypted: boolean;
    conversationId: string;
    peerPublicKey?: string | null;
    probe?: { cipher: string; iv: string } | null;
  }): Promise<CryptoState> {
    key = null;
    if (!opts.encrypted) return (state.value = 'plain');

    const mine = await ensureIdentity();
    if (!mine || !opts.peerPublicKey) return (state.value = 'noKey');

    // A peer key that WebCrypto refuses is not an exception to propagate.
    //
    // The server now rejects malformed keys at publication, but rows
    // predating that check still exist, and a key for a curve this
    // browser does not support would fail here too. Letting the
    // DOMException escape leaves the page doing nothing at all — which
    // is what it did: the rotation succeeded, the network calls all
    // returned 200, and the interface never moved.
    try {
      key = await conversationKey(mine, opts.peerPublicKey, opts.conversationId);
    } catch {
      key = null;
      return (state.value = 'peerKeyBroken');
    }

    if (opts.probe) {
      const opened = await openSealed(key, opts.probe);
      if (opened === null) {
        // The key derived fine and decrypts nothing: this thread belongs
        // to a previous identity. Saying "foreign" rather than "error" is
        // what lets the UI offer the one action that helps.
        key = null;
        return (state.value = 'foreign');
      }
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
    prepare,
    decrypt,
    encrypt,
    ensureIdentity,
    generateAndPublish,
    rotate,
  };
}

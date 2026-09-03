import { afterEach, describe, expect, it, vi } from 'vitest';
import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * Un seul flux, même quand deux connexions se chevauchent.
 *
 * `useMessagingStream.connect()` ferme la source ouverte puis attend deux fois
 * — le jeton, le rattrapage. Fermer ne suffisait donc pas : `stop()` suivi de
 * `start()`, l'usage que le composable documente, laissait le premier
 * `connect()` en train d'attendre son jeton ; il reprenait ensuite avec
 * `stopped` remis à faux et ouvrait un second `EventSource`. Le premier
 * restait ouvert sans référence, continuait de livrer, et chaque message
 * arrivait deux fois.
 *
 * Ce fichier est le premier du lot à exercer un composable plutôt qu'une
 * fonction pure. Le prix en est explicite : les auto-imports de Nuxt dont
 * `useMessagingStream` dépend sont posés ici à la main. Cela reste très
 * au-dessous de `@nuxt/test-utils` et d'un navigateur simulé, et l'invariant
 * couvert est invisible autrement — c'est précisément un compteur qu'un
 * relecteur peut retirer en croyant simplifier.
 */

/** Les `EventSource` créés, dans l'ordre, avec leur état de fermeture. */
const opened: Array<{ url: string; closed: boolean }> = [];

class FakeEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly slot: { url: string; closed: boolean };
  constructor(url: string) {
    this.slot = { url, closed: false };
    opened.push(this.slot);
  }
  close() {
    this.slot.closed = true;
  }
}

/** Différé résolu à la main, pour arrêter `connect()` sur son await. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tokenCalls: Array<{ resolve: (v: unknown) => void }> = [];

vi.stubGlobal('ref', ref);
vi.stubGlobal('onMounted', onMounted);
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount);
vi.stubGlobal('EventSource', FakeEventSource);
vi.stubGlobal('$fetch', (url: string) => {
  if (url === '/api/messaging/token') {
    const d = deferred<unknown>();
    tokenCalls.push({ resolve: d.resolve });
    return d.promise;
  }
  // Le rattrapage : rien à réparer.
  return Promise.resolve({ messages: [], truncated: false });
});

// Importé APRÈS les globaux : le module les lit à l'appel, mais l'ordre reste
// ce qu'un lecteur attend.
const { useMessagingStream } = await import(
  '../app/composables/useMessagingStream'
);

afterEach(() => {
  opened.length = 0;
  tokenCalls.length = 0;
});

/** Laisse la file de microtâches s'écouler. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('useMessagingStream — une seule connexion', () => {
  it('ne laisse pas un flux orphelin quand stop() puis start() se croisent', async () => {
    const received: unknown[] = [];
    const stream = useMessagingStream({ onFrame: (f) => received.push(f) });

    // 1. Première connexion : elle attend son jeton.
    stream.start();
    await settle();
    expect(tokenCalls).toHaveLength(1);
    expect(opened).toHaveLength(0);

    // 2. Suspendue puis relancée pendant que la première attend encore.
    stream.stop();
    stream.start();
    await settle();
    expect(tokenCalls).toHaveLength(2);

    // 3. Les deux jetons arrivent, la première EN DERNIER — le pire ordre.
    tokenCalls[1]!.resolve({ url: 'http://relay', token: 'b', expiresAt: 0 });
    await settle();
    tokenCalls[0]!.resolve({ url: 'http://relay', token: 'a', expiresAt: 0 });
    await settle();

    // Un seul flux ouvert, et c'est celui de la tentative la plus récente.
    expect(opened).toHaveLength(1);
    expect(opened[0]!.url).toContain('token=b');
    expect(opened[0]!.closed).toBe(false);
  });

  it('ferme le flux précédent quand connect() est rappelé après ouverture', async () => {
    const stream = useMessagingStream({ onFrame: () => {} });
    stream.start();
    await settle();
    tokenCalls[0]!.resolve({ url: 'http://relay', token: 'a', expiresAt: 0 });
    await settle();
    expect(opened).toHaveLength(1);

    stream.start();
    await settle();
    tokenCalls[1]!.resolve({ url: 'http://relay', token: 'b', expiresAt: 0 });
    await settle();

    expect(opened).toHaveLength(2);
    expect(opened[0]!.closed).toBe(true);
    expect(opened[1]!.closed).toBe(false);
  });
});

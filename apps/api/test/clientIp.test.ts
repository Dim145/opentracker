import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Client-IP resolution behind a reverse proxy.
//
// Everything that decides "is this request abusive" keys on this value: the
// per-IP rate limits, the DDoS blacklist, the `banned_ips` table. Getting it
// wrong is not a subtle bug — it lets a client choose its own identity, which
// both lifts every limit and lets an attacker frame someone else's address
// into the blacklist.
//
// The contract is documented in `doc/reference/env.md`: the RIGHTMOST token of
// `X-Forwarded-For` wins, because a trusted proxy appends. The Go tracker has
// always done that; this module used to take the leftmost one — the only entry
// the client fully controls.

function eventWith(headers: Record<string, string>, socketIp = '10.0.0.1') {
  return {
    node: { req: { socket: { remoteAddress: socketIp }, headers } },
  };
}

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // h3's `getHeader` is auto-imported in the app; stub it against the fake
  // event so the unit stays free of a real H3 instance.
  vi.stubGlobal('getHeader', (event: any, name: string) =>
    event?.node?.req?.headers?.[name.toLowerCase()],
  );
  return await import('../utils/rateLimit');
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TRUST_PROXY;
  delete process.env.TRUST_CF_CONNECTING_IP;
});

describe('TRUST_PROXY off — the default', () => {
  // The first `load()` pays for a cold import of the whole `@trackarr/db`
  // graph — a second and a half on an idle machine, more than five on a busy
  // one. The default budget made this the one test in the suite that failed
  // for being on the wrong laptop.
  it('ignores every proxy header and uses the socket peer', async () => {
    const { getClientIP } = await load({ TRUST_PROXY: undefined });
    const event = eventWith({
      'x-forwarded-for': '1.2.3.4',
      'x-real-ip': '5.6.7.8',
      'cf-connecting-ip': '9.9.9.9',
    });
    expect(getClientIP(event)).toBe('10.0.0.1');
  }, 20_000);
});

describe('TRUST_PROXY on', () => {
  it('takes the RIGHTMOST X-Forwarded-For entry', async () => {
    // The leftmost entry is whatever the client sent; only the rightmost was
    // observed by the proxy we trust.
    const { getClientIP } = await load({ TRUST_PROXY: 'true' });
    const event = eventWith({
      'x-forwarded-for': '203.0.113.9, 198.51.100.4, 192.0.2.7',
    });
    expect(getClientIP(event)).toBe('192.0.2.7');
  });

  it('does not let a forged X-Real-IP override the appended list', async () => {
    // Caddy sets both, but a proxy that sets only XFF would leave X-Real-IP
    // entirely client-controlled — so the list has to win.
    const { getClientIP } = await load({ TRUST_PROXY: 'true' });
    const event = eventWith({
      'x-real-ip': '203.0.113.9',
      'x-forwarded-for': '198.51.100.4',
    });
    expect(getClientIP(event)).toBe('198.51.100.4');
  });

  it('falls back to X-Real-IP only when there is no usable list', async () => {
    const { getClientIP } = await load({ TRUST_PROXY: 'true' });
    expect(getClientIP(eventWith({ 'x-real-ip': '198.51.100.4' }))).toBe(
      '198.51.100.4',
    );
  });

  it('skips malformed entries instead of trusting them', async () => {
    // An unvalidated value becomes a Redis key and a `banned_ips` comparand;
    // arbitrary strings would let an attacker mint cache keys at will.
    const { getClientIP } = await load({ TRUST_PROXY: 'true' });
    expect(
      getClientIP(eventWith({ 'x-forwarded-for': '192.0.2.7, not-an-ip' })),
    ).toBe('192.0.2.7');
    expect(getClientIP(eventWith({ 'x-forwarded-for': 'garbage' }))).toBe(
      '10.0.0.1',
    );
  });

  it('accepts IPv6', async () => {
    const { getClientIP } = await load({ TRUST_PROXY: 'true' });
    expect(
      getClientIP(eventWith({ 'x-forwarded-for': '2001:db8::1' })),
    ).toBe('2001:db8::1');
  });

  it('ignores CF-Connecting-IP unless explicitly trusted', async () => {
    // Caddy strips the header, but the flag is the real gate: the header is
    // only authoritative when Cloudflare actually fronts the deployment.
    const { getClientIP } = await load({
      TRUST_PROXY: 'true',
      TRUST_CF_CONNECTING_IP: undefined,
    });
    const event = eventWith({
      'cf-connecting-ip': '203.0.113.9',
      'x-forwarded-for': '198.51.100.4',
    });
    expect(getClientIP(event)).toBe('198.51.100.4');
  });

  it('honours CF-Connecting-IP when the flag is on', async () => {
    const { getClientIP } = await load({
      TRUST_PROXY: 'true',
      TRUST_CF_CONNECTING_IP: 'true',
    });
    const event = eventWith({
      'cf-connecting-ip': '203.0.113.9',
      'x-forwarded-for': '198.51.100.4',
    });
    expect(getClientIP(event)).toBe('203.0.113.9');
  });
});

// Le rendu serveur n'est pas un client.
//
// Le compteur d'abus est par adresse, et le conteneur web n'en a qu'une pour
// tout le site. Mesuré sur la pile e2e : quatre requêtes d'API par page vue
// s'y accumulaient, donc vingt-cinq pages en dix secondes suffisaient à mettre
// l'instance entière sur liste noire. Le discriminant retenu — pair socket
// privé ET aucun en-tête de transfert — vient de ce que le proxy du conteneur
// web fait déjà : il pose `x-forwarded-for` sur ce qu'il RELAIE, et rien sur
// ce qu'il émet pour lui-même.
describe('isInternalOrigin', () => {
  it('reconnaît une requête émise par le rendu serveur', async () => {
    const { isInternalOrigin } = await load({});
    expect(isInternalOrigin(eventWith({}, '172.22.0.8'))).toBe(true);
    expect(isInternalOrigin(eventWith({}, '10.0.0.4'))).toBe(true);
    expect(isInternalOrigin(eventWith({}, '::1'))).toBe(true);
    expect(isInternalOrigin(eventWith({}, '::ffff:127.0.0.1'))).toBe(true);
  });

  it('ne reconnaît PAS une requête relayée pour un navigateur', async () => {
    // C'est le cas d'une pile sans Caddy : le conteneur web relaie les appels
    // du navigateur et pose le pair qu'il a vu.
    const { isInternalOrigin } = await load({});
    expect(
      isInternalOrigin(
        eventWith({ 'x-forwarded-for': '203.0.113.9' }, '172.22.0.8'),
      ),
    ).toBe(false);
    for (const h of ['x-real-ip', 'cf-connecting-ip', 'true-client-ip', 'forwarded']) {
      expect(isInternalOrigin(eventWith({ [h]: '203.0.113.9' }, '172.22.0.8'))).toBe(
        false,
      );
    }
  });

  it('ne peut pas être obtenu depuis Internet', async () => {
    // Une adresse publique ne passe pas, avec ou sans en-tête — et ajouter un
    // en-tête ne fait jamais qu'exempter MOINS.
    const { isInternalOrigin } = await load({});
    expect(isInternalOrigin(eventWith({}, '203.0.113.9'))).toBe(false);
    expect(isInternalOrigin(eventWith({}, '8.8.8.8'))).toBe(false);
    // 172.32 est PUBLIQUE : la plage privée s'arrête à 172.31.
    expect(isInternalOrigin(eventWith({}, '172.32.0.1'))).toBe(false);
    expect(isInternalOrigin(eventWith({}, '172.15.0.1'))).toBe(false);
  });

  it('ne dépend pas de TRUST_PROXY', async () => {
    // Le filtre lit le pair SOCKET, jamais la valeur résolue : sinon un client
    // pourrait se déclarer privé par en-tête dès que TRUST_PROXY est actif.
    const { isInternalOrigin } = await load({ TRUST_PROXY: 'true' });
    expect(
      isInternalOrigin(eventWith({ 'x-forwarded-for': '10.0.0.9' }, '203.0.113.9')),
    ).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  isBlockedIp,
  validateHost,
  safeFetch,
  SafeFetchError,
} from '../utils/safeFetch';

// SSRF guard. This is the single choke point behind the web_push channel
// (finding M10) and the federation swarm peer relay (finding L6): if any
// private / loopback / link-local / metadata / CGNAT address slips through
// as "not blocked", an attacker can pivot the server into internal HTTP
// services or poison the swarm with bogus peers. Fail-closed on anything
// that is not a clean public IP literal.

describe('isBlockedIp — IPv4', () => {
  it('blocks loopback, private, CGNAT, link-local/metadata, wildcard, multicast', () => {
    for (const ip of [
      '127.0.0.1',
      '127.10.20.30',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1', // CGNAT
      '100.127.255.255', // CGNAT upper bound
      '169.254.169.254', // cloud metadata
      '0.0.0.0',
      '224.0.0.1', // multicast
      '255.255.255.255', // broadcast (>= 224)
      '192.0.2.10', // TEST-NET-1
      '198.51.100.10', // TEST-NET-2
      '203.0.113.10', // TEST-NET-3
      '198.18.0.1', // benchmark
    ]) {
      expect(isBlockedIp(ip), `${ip} must be blocked`).toBe(true);
    }
  });

  it('allows ordinary public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1']) {
      expect(isBlockedIp(ip), `${ip} must be allowed`).toBe(false);
    }
  });

  it('fails closed on malformed / out-of-range input', () => {
    for (const bad of ['', 'not-an-ip', '256.1.1.1', '1.2.3', '1.2.3.4.5', '10.0.0.-1', '0x7f.0.0.1']) {
      expect(isBlockedIp(bad), `${bad} must be treated as unsafe`).toBe(true);
    }
  });
});

describe('isBlockedIp — IPv6', () => {
  it('blocks loopback, unspecified, ULA, link-local, multicast, NAT64', () => {
    for (const ip of [
      '::1', // loopback
      '::', // unspecified
      'fc00::1', // unique-local fc00::/7
      'fd12:3456::1', // unique-local
      'fe80::1', // link-local
      'ff02::1', // multicast
      '64:ff9b::7f00:1', // NAT64 wrapping 127.0.0.1
      '::ffff:127.0.0.1', // IPv4-mapped loopback (dotted)
      '::ffff:169.254.169.254', // IPv4-mapped metadata
      '::ffff:7f00:1', // IPv4-mapped loopback (hex form)
    ]) {
      expect(isBlockedIp(ip), `${ip} must be blocked`).toBe(true);
    }
  });

  it('allows ordinary public IPv6', () => {
    for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8']) {
      expect(isBlockedIp(ip), `${ip} must be allowed`).toBe(false);
    }
  });

  it('fails closed on malformed IPv6', () => {
    for (const bad of ['fe80::1::2', 'gggg::1', '12345::1', '1:2:3:4:5:6:7']) {
      expect(isBlockedIp(bad), `${bad} must be treated as unsafe`).toBe(true);
    }
  });
});

describe('validateHost', () => {
  it('rejects an IP literal in a blocked range (no DNS round-trip)', async () => {
    await expect(validateHost('169.254.169.254')).rejects.toBeInstanceOf(SafeFetchError);
    await expect(validateHost('127.0.0.1')).rejects.toBeInstanceOf(SafeFetchError);
    await expect(validateHost('::1')).rejects.toBeInstanceOf(SafeFetchError);
  });

  it('accepts a public IP literal', async () => {
    await expect(validateHost('1.1.1.1')).resolves.toBeUndefined();
  });

  it('rejects localhost (resolves to a loopback address)', async () => {
    // `localhost` resolves via /etc/hosts to 127.0.0.1 / ::1 — both blocked.
    await expect(validateHost('localhost')).rejects.toBeInstanceOf(SafeFetchError);
  });
});

/*
 * Redirections : ce qui traverse une frontière d'origine, et ce qui tombe.
 *
 * La validation d'hôte était déjà rejouée à chaque saut, donc aucune
 * redirection ne pouvait atteindre une plage privée. Ce qui manquait, c'est
 * que l'`init` de l'appelant — en-têtes compris — était réinjecté dans chaque
 * `fetch` : une cible publique qui répondait `302 Location: https://attaquant`
 * recevait les seize en-têtes que le membre configure sur son webhook, son
 * HMAC de corps, l'`Authorization` de son ntfy ou la signature SigV4 du
 * stockage. Aucune plage franchie, rien dans le journal.
 *
 * Les hôtes sont des littéraux d'adresse PUBLIQUE : `validateHost` les
 * court-circuite sans DNS, donc ces tests ne touchent pas le réseau.
 */
describe('safeFetch — frontières d’origine', () => {
  type Hop = { url: string; method: string; headers: Record<string, string> };

  /**
   * Remplace `fetch` par un enregistreur qui rejoue un script de réponses.
   * Renvoie les sauts observés — c'est là que se lit la panne : un total
   * correct ne dit rien si le secret est parti au saut d'avant.
   */
  function stubFetch(script: Array<{ status: number; location?: string }>) {
    const hops: Hop[] = [];
    let i = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      const seen: Record<string, string> = {};
      new Headers(init.headers as HeadersInit).forEach((v, k) => {
        seen[k] = v;
      });
      hops.push({ url: String(url), method: String(init.method), headers: seen });
      const step = script[Math.min(i++, script.length - 1)];
      const h = new Headers();
      if (step.location) h.set('location', step.location);
      return new Response(null, { status: step.status, headers: h });
    }) as typeof globalThis.fetch;
    return { hops, restore: () => void (globalThis.fetch = original) };
  }

  const SECRETS = {
    Authorization: 'Bearer s3cr3t',
    'X-Trackarr-Signature': 'deadbeef',
    'X-Gotify-Key': 'gotify-token',
    Cookie: 'session=abc',
    'User-Agent': 'Trackarr-Notify/1',
    Accept: 'application/json',
  };

  it('garde les en-têtes sur une redirection DANS la même origine', async () => {
    // Le contrôle positif. Sans lui, un test qui ne voit aucun secret au
    // second saut ne distingue pas « retiré » de « jamais envoyé ».
    const { hops, restore } = stubFetch([
      { status: 302, location: 'http://1.1.1.1/b' },
      { status: 200 },
    ]);
    try {
      await safeFetch('http://1.1.1.1/a', { headers: SECRETS });
    } finally {
      restore();
    }
    expect(hops).toHaveLength(2);
    expect(hops[1]!.headers.authorization).toBe('Bearer s3cr3t');
    expect(hops[1]!.headers['x-trackarr-signature']).toBe('deadbeef');
  });

  it('retire TOUT en-tête porteur de secret au passage vers une autre origine', async () => {
    const { hops, restore } = stubFetch([
      { status: 302, location: 'http://1.0.0.1/b' },
      { status: 200 },
    ]);
    try {
      await safeFetch('http://1.1.1.1/a', { headers: SECRETS });
    } finally {
      restore();
    }
    expect(hops).toHaveLength(2);
    // Le premier saut, vers l'hôte que l'appelant a choisi, les garde.
    expect(hops[0]!.headers.authorization).toBe('Bearer s3cr3t');
    // Le second, non — et pas seulement `authorization` : une liste noire
    // laisserait passer `x-trackarr-signature` et `x-gotify-key`.
    expect(hops[1]!.headers.authorization).toBeUndefined();
    expect(hops[1]!.headers['x-trackarr-signature']).toBeUndefined();
    expect(hops[1]!.headers['x-gotify-key']).toBeUndefined();
    expect(hops[1]!.headers.cookie).toBeUndefined();
    // Ce qui ne peut rien authentifier survit.
    expect(hops[1]!.headers['user-agent']).toBe('Trackarr-Notify/1');
    expect(hops[1]!.headers.accept).toBe('application/json');
  });

  it('compte un passage https → http sur le même hôte comme un franchissement', async () => {
    // Livrer le jeton en clair est le pire des deux cas, pas le meilleur.
    const { hops, restore } = stubFetch([
      { status: 302, location: 'http://1.1.1.1/b' },
      { status: 200 },
    ]);
    try {
      await safeFetch('https://1.1.1.1/a', { headers: SECRETS });
    } finally {
      restore();
    }
    expect(hops[1]!.headers.authorization).toBeUndefined();
  });

  it('ne rend pas les en-têtes si la chaîne revient à l’origine de départ', async () => {
    // A → B → A. B a choisi ce retour ; il aurait pu choisir un A homographe.
    const { hops, restore } = stubFetch([
      { status: 302, location: 'http://1.0.0.1/b' },
      { status: 302, location: 'http://1.1.1.1/c' },
      { status: 200 },
    ]);
    try {
      await safeFetch('http://1.1.1.1/a', { headers: SECRETS });
    } finally {
      restore();
    }
    expect(hops).toHaveLength(3);
    expect(hops[2]!.url).toBe('http://1.1.1.1/c');
    expect(hops[2]!.headers.authorization).toBeUndefined();
  });

  it('refuse un 307 qui rejouerait le corps vers une autre origine', async () => {
    // Un 307/308 conserve la méthode ET le corps : retirer les en-têtes n'y
    // suffirait pas, le contenu partirait quand même. Et dégrader le PUT en
    // GET rendrait un 200 pour une écriture qui n'a jamais eu lieu — on
    // refuse, visiblement.
    const { hops, restore } = stubFetch([
      { status: 307, location: 'http://1.0.0.1/b' },
      { status: 200 },
    ]);
    try {
      await expect(
        safeFetch('http://1.1.1.1/a', {
          method: 'PUT',
          headers: SECRETS,
          body: 'des octets à ne pas divulguer',
        })
      ).rejects.toBeInstanceOf(SafeFetchError);
    } finally {
      restore();
    }
    // Un seul saut : le second n'a jamais été tenté.
    expect(hops).toHaveLength(1);
  });

  it('suit un POST vers une autre origine sans corps et sans secret', async () => {
    // Le comportement existant (POST → GET, corps abandonné) est conservé ;
    // ce qui change, c'est que les en-têtes ne suivent plus.
    const { hops, restore } = stubFetch([
      { status: 302, location: 'http://1.0.0.1/b' },
      { status: 200 },
    ]);
    try {
      const res = await safeFetch('http://1.1.1.1/a', {
        method: 'POST',
        headers: SECRETS,
        body: '{"payload":"x"}',
      });
      expect(res.status).toBe(200);
    } finally {
      restore();
    }
    expect(hops).toHaveLength(2);
    expect(hops[1]!.method).toBe('GET');
    expect(hops[1]!.headers.authorization).toBeUndefined();
  });
});

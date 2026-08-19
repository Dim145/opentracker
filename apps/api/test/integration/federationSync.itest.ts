import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import type { FederationPeer } from '@trackarr/db/schema';
import { makeUser } from './helpers';

// Synchronisation de catalogue fédéré.
//
// C'est le seul endroit du projet où des données écrites par une machine
// tierce entrent en base. Le partenaire est donc traité comme une entrée
// hostile : tout ce qui arrive de lui est borné, tronqué, filtré. Ces tests
// figent les deux familles de garanties qui en découlent.
//
// D'abord la PROGRESSION. Le curseur est la seule mémoire de la synchro :
// mal avancé, il refait éternellement la même page ; trop avancé, il saute
// silencieusement des torrents. Le défaut le plus coûteux rencontré ici était
// invisible — `toISOString()` tronquait le curseur à la milliseconde alors que
// le partenaire l'émet à la microseconde, si bien que la dernière page était
// refetchée à chaque passage.
//
// Ensuite le CONFINEMENT. Un partenaire qui déborde (pages infinies, noms
// démesurés, compteurs absurdes, URL `javascript:`) ne doit pouvoir ni faire
// grossir la table sans fin, ni faire tomber la synchro, ni injecter quoi que
// ce soit dans l'interface.
//
// Le réseau est le seul élément simulé : `signedGet` est remplacé par un
// partenaire de test programmable. Tout le reste — Postgres, le curseur, les
// notifications — est réel.

const partner = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; baseUrl: string; params: URLSearchParams }>,
  handlers: {} as Record<
    string,
    (p: URLSearchParams, baseUrl: string) => { status: number; data: unknown }
  >,
}));

vi.mock('../../utils/federation/signing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/federation/signing')>()),
  // Le `baseUrl` est transmis au gestionnaire : plusieurs tests montent deux
  // pairs et doivent leur faire dire des choses différentes — c'est justement
  // la façon de prouver que les écritures restent cloisonnées par pair.
  signedGet: async ({ pathname, baseUrl }: { pathname: string; baseUrl: string }) => {
    const [path, qs = ''] = pathname.split('?');
    const params = new URLSearchParams(qs);
    partner.calls.push({ path: path!, baseUrl, params });
    const handler = partner.handlers[path!];
    // Par défaut le partenaire n'a rien à dire : une page vide et valide.
    // Les passes annexes de `syncAllCatalogues` s'en contentent.
    return handler
      ? handler(params, baseUrl)
      : { status: 200, data: { ok: true, items: [] } };
  },
}));

const { syncPeerCatalogue, syncAllCatalogues } = await import(
  '../../utils/federation/catalogSync'
);
const { ensureFederationIdentity } = await import('../../utils/federation/config');

const CATALOG = '/api/federation/catalog';
const REMOVALS = '/api/federation/catalog-removals';
const REFRESH = '/api/federation/catalog-refresh';
const STATS = '/api/federation/catalog-stats';
const PAGE_LIMIT = 100; // doit rester aligné sur catalogSync.ts
const MAX_PAGES_PER_RUN = 25;

function on(
  resource: string,
  handler: (p: URLSearchParams, baseUrl: string) => { status: number; data: unknown },
): void {
  partner.handlers[resource] = handler;
}

/** Une page de catalogue valide. */
function page(items: unknown[], nextCursor?: unknown) {
  return { status: 200, data: { ok: true, items, nextCursor } };
}

/** Un article de catalogue plausible, tel que l'émet `/api/federation/catalog`. */
function item(n: number, over: Record<string, unknown> = {}) {
  return {
    remoteId: `r-${n}`,
    infoHash: String(n).padStart(40, 'a'),
    name: `Remote Release ${n}`,
    size: 1_000_000 * n,
    categorySlug: 'movies',
    categoryType: 'movie',
    seeders: 10,
    leechers: 2,
    completed: 5,
    uploaderName: 'Uploader',
    createdAt: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}.000Z`,
    detailUrl: `https://partner.example/t/${n}`,
    downloadUrl: `https://partner.example/dl/${n}`,
    ...over,
  };
}

const SCOPES_CATALOG = {
  catalog: true,
  social: false,
  accounts: false,
  swarm: false,
};

async function makePeer(
  over: Partial<typeof schema.federationPeers.$inferInsert> = {},
): Promise<FederationPeer> {
  const id = randomUUID();
  const [row] = await db
    .insert(schema.federationPeers)
    .values({
      id,
      baseUrl: `https://p-${id.slice(0, 8)}.example`,
      instanceId: `tk_${id.slice(0, 12)}`,
      publicKey: 'PUBKEY',
      displayName: `Peer ${id.slice(0, 4)}`,
      status: 'active',
      sharesWithThem: SCOPES_CATALOG,
      acceptsFromThem: SCOPES_CATALOG,
      ...over,
    })
    .returning();
  return row!;
}

async function mirrored(peerId: string) {
  return db
    .select()
    .from(schema.remoteTorrents)
    .where(eq(schema.remoteTorrents.peerId, peerId));
}

async function syncState(peerId: string, resource = 'catalog') {
  const [row] = await db
    .select()
    .from(schema.federationSyncState)
    .where(
      and(
        eq(schema.federationSyncState.peerId, peerId),
        eq(schema.federationSyncState.resource, resource),
      ),
    );
  return row ?? null;
}

/** Le curseur stocké, décodé. */
async function cursor(peerId: string, resource = 'catalog') {
  const st = await syncState(peerId, resource);
  return st?.cursor ? (JSON.parse(st.cursor) as { t: string; id: string | null }) : null;
}

const catalogCalls = () => partner.calls.filter((c) => c.path === CATALOG);

beforeEach(async () => {
  partner.calls.length = 0;
  for (const k of Object.keys(partner.handlers)) delete partner.handlers[k];
  // Identité réelle : `syncAllCatalogues` ne lance ses passes annexes que si
  // l'instance sait signer, donc on provisionne la vraie paire de clés plutôt
  // que de simuler la configuration.
  await ensureFederationIdentity();
  await db
    .update(schema.federationConfig)
    .set({ enabled: true })
    .where(eq(schema.federationConfig.id, 'singleton'));
});

describe('curseur — la mémoire de la synchro', () => {
  it('ne demande aucun point de départ au tout premier passage', async () => {
    const peer = await makePeer();
    on(CATALOG, () => page([item(1)], { createdAt: '2026-01-01T00:00:01.000Z', id: 'r-1' }));

    await syncPeerCatalogue(peer);

    const first = catalogCalls()[0]!;
    expect(first.params.get('since')).toBeNull();
    expect(first.params.get('sinceId')).toBeNull();
    expect(first.params.get('limit')).toBe(String(PAGE_LIMIT));
  });

  it('persiste le curseur rendu par le partenaire et le renvoie au passage suivant', async () => {
    const peer = await makePeer();
    on(CATALOG, () => page([item(1)], { createdAt: '2026-01-01T00:00:01.000Z', id: 'r-1' }));

    await syncPeerCatalogue(peer);
    expect(await cursor(peer.id)).toEqual({ t: '2026-01-01T00:00:01.000Z', id: 'r-1' });

    await syncPeerCatalogue(peer);
    const second = catalogCalls()[1]!;
    expect(second.params.get('since')).toBe('2026-01-01T00:00:01.000Z');
    expect(second.params.get('sinceId')).toBe('r-1');
  });

  it('conserve la précision microseconde du curseur', async () => {
    // Le défaut le plus coûteux de cette synchro : le partenaire compare un
    // `created_at` à la microseconde, mais le curseur repassait par
    // `toISOString()` qui tronque à la milliseconde. Renvoyé arrondi vers le
    // bas, il ramenait indéfiniment la même dernière page.
    const peer = await makePeer();
    const precis = '2026-01-02T03:04:05.123456Z';
    on(CATALOG, () => page([item(1)], { createdAt: precis, id: 'r-1' }));

    await syncPeerCatalogue(peer);
    expect((await cursor(peer.id))!.t).toBe(precis);

    await syncPeerCatalogue(peer);
    expect(catalogCalls()[1]!.params.get('since')).toBe(precis);
  });

  it('accepte un curseur hérité au format ISO nu', async () => {
    // Les instances antérieures au curseur composite stockaient une simple
    // chaîne ISO. Une mise à jour ne doit pas repartir de zéro.
    const peer = await makePeer();
    await db.insert(schema.federationSyncState).values({
      peerId: peer.id,
      resource: 'catalog',
      cursor: '2026-01-01T00:00:00.000Z',
    });
    on(CATALOG, () => page([]));

    await syncPeerCatalogue(peer);

    const first = catalogCalls()[0]!;
    expect(first.params.get('since')).toBe('2026-01-01T00:00:00.000Z');
    expect(first.params.get('sinceId')).toBeNull();
  });

  it('n’avance pas — et ne casse pas — sur un curseur illisible', async () => {
    // Une date invalide faisait auparavant échouer toute la synchro du pair.
    // Ne pas avancer est le bon repli : on refera la page, on ne la sautera pas.
    const peer = await makePeer();
    on(CATALOG, () => page([item(1)], { createdAt: 'pas-une-date', id: 'r-1' }));

    const res = await syncPeerCatalogue(peer);

    expect(res.status).toBe('ok');
    expect(await cursor(peer.id)).toBeNull();
    expect(await mirrored(peer.id)).toHaveLength(1);
  });
});

describe('pagination', () => {
  it('enchaîne sur une page pleine et s’arrête sur une page partielle', async () => {
    const peer = await makePeer();
    let appel = 0;
    on(CATALOG, () => {
      appel++;
      const n = appel === 1 ? PAGE_LIMIT : 3;
      const debut = (appel - 1) * PAGE_LIMIT;
      return page(
        Array.from({ length: n }, (_, i) => item(debut + i)),
        { createdAt: `2026-01-0${appel}T00:00:00.000Z`, id: `r-${debut + n - 1}` },
      );
    });

    const res = await syncPeerCatalogue(peer);

    expect(catalogCalls()).toHaveLength(2);
    expect(res.synced).toBe(PAGE_LIMIT + 3);
  });

  it('plafonne le nombre de pages par passage', async () => {
    // Un partenaire avec un énorme retard à rattraper — ou qui rend
    // éternellement des pages pleines — est drainé sur plusieurs tours de
    // cron plutôt que de monopoliser celui-ci.
    const peer = await makePeer();
    let appel = 0;
    on(CATALOG, () => {
      appel++;
      const debut = (appel - 1) * PAGE_LIMIT;
      return page(
        Array.from({ length: PAGE_LIMIT }, (_, i) => item(debut + i)),
        { createdAt: '2026-01-01T00:00:00.000Z', id: `r-${debut + PAGE_LIMIT - 1}` },
      );
    });

    await syncPeerCatalogue(peer);

    expect(catalogCalls()).toHaveLength(MAX_PAGES_PER_RUN);
    // Le curseur reste posé là où on s'est arrêté : le tour suivant reprend
    // exactement à cet endroit, sans trou ni doublon.
    expect((await cursor(peer.id))!.id).toBe(`r-${MAX_PAGES_PER_RUN * PAGE_LIMIT - 1}`);
  });

  it('s’arrête net sur une page vide', async () => {
    const peer = await makePeer();
    on(CATALOG, () => page([]));

    const res = await syncPeerCatalogue(peer);

    expect(catalogCalls()).toHaveLength(1);
    expect(res.synced).toBe(0);
  });
});

describe('miroir — déduplication et intégrité', () => {
  it('ne crée qu’une ligne pour un même remoteId, et met à jour la suivante', async () => {
    const peer = await makePeer();
    on(CATALOG, () => page([item(1, { name: 'Version initiale', seeders: 1 })]));
    await syncPeerCatalogue(peer);

    on(CATALOG, () => page([item(1, { name: 'Version corrigée', seeders: 42 })]));
    await syncPeerCatalogue(peer);

    const rows = await mirrored(peer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Version corrigée');
    expect(rows[0]!.seeders).toBe(42);
  });

  it('laisse deux partenaires miroiter le même infoHash', async () => {
    // Le même torrent circule souvent sur plusieurs instances. Chaque miroir
    // est propre à son pair : dédupliquer sur l'infoHash ferait disparaître la
    // source concurrente et son lien de téléchargement.
    const a = await makePeer();
    const b = await makePeer();
    on(CATALOG, () => page([item(7)]));

    await syncPeerCatalogue(a);
    await syncPeerCatalogue(b);

    expect(await mirrored(a.id)).toHaveLength(1);
    expect(await mirrored(b.id)).toHaveLength(1);
  });

  it('ignore un article incomplet sans perdre le reste de la page', async () => {
    const peer = await makePeer();
    on(CATALOG, () =>
      page([
        item(1),
        { remoteId: 'sans-hash', name: 'x' },
        { infoHash: 'b'.repeat(40), name: 'sans id' },
        { remoteId: 'r-9', infoHash: 'c'.repeat(40) }, // sans nom
        item(2),
      ]),
    );

    const res = await syncPeerCatalogue(peer);

    expect(res.synced).toBe(2);
    expect(await mirrored(peer.id)).toHaveLength(2);
  });
});

describe('confinement d’un partenaire hostile', () => {
  it('n’enregistre que des URL http(s)', async () => {
    const peer = await makePeer();
    on(CATALOG, () =>
      page([
        item(1, { detailUrl: 'javascript:alert(1)', downloadUrl: 'data:text/html,x' }),
        item(2, { detailUrl: 'https://ok.example/t/2', downloadUrl: 'http://ok.example/dl/2' }),
      ]),
    );

    await syncPeerCatalogue(peer);
    const rows = (await mirrored(peer.id)).sort((x, y) =>
      x.remoteId.localeCompare(y.remoteId),
    );

    // Ces deux colonnes finissent dans un `:href` de l'interface.
    expect(rows[0]!.remoteDetailUrl).toBeNull();
    expect(rows[0]!.remoteDownloadUrl).toBeNull();
    expect(rows[1]!.remoteDetailUrl).toBe('https://ok.example/t/2');
    expect(rows[1]!.remoteDownloadUrl).toBe('http://ok.example/dl/2');
  });

  it('ramène les compteurs aberrants dans les bornes de la colonne', async () => {
    // `seeders` est un `integer` Postgres : une valeur au-delà de 2^31 fait
    // échouer l'INSERT et emporte toute la page avec elle.
    const peer = await makePeer();
    on(CATALOG, () =>
      page([
        item(1, {
          seeders: -5,
          leechers: 9e18,
          completed: Number.NaN,
          size: -1,
        }),
      ]),
    );

    await syncPeerCatalogue(peer);
    const [row] = await mirrored(peer.id);

    expect(row!.seeders).toBe(0);
    expect(row!.leechers).toBe(2_147_483_647);
    expect(row!.completed).toBe(0);
    expect(row!.size).toBe(0);
  });

  it('tronque les champs démesurés au lieu de les refuser', async () => {
    const peer = await makePeer();
    on(CATALOG, () =>
      page([
        item(1, {
          name: 'N'.repeat(5000),
          description: 'D'.repeat(50_000),
          tags: [...Array.from({ length: 80 }, (_, i) => `tag${i}`), 42, null, { x: 1 }],
        }),
      ]),
    );

    await syncPeerCatalogue(peer);
    const [row] = await mirrored(peer.id);

    expect(row!.name).toHaveLength(1000);
    expect(row!.description).toHaveLength(20_000);
    expect(row!.tags).toHaveLength(50);
    expect(row!.tags!.every((t) => typeof t === 'string')).toBe(true);
  });

  it('refuse de dépasser le plafond de lignes par partenaire', async () => {
    // Garde-fou de dernier recours : passé 100 000 lignes miroitées, on cesse
    // de tirer chez ce pair. Sans lui, un partenaire malveillant fait grossir
    // la table jusqu'à saturation du disque.
    const peer = await makePeer();
    await db.execute(sql`
      INSERT INTO remote_torrents (id, peer_id, remote_id, info_hash, name, size)
      SELECT gen_random_uuid()::text, ${peer.id}, 'bulk-' || g, lpad(g::text, 40, '0'),
             'Bulk ' || g, 0
      FROM generate_series(1, 100000) g
    `);
    on(CATALOG, () => page([item(1)]));

    const res = await syncPeerCatalogue(peer);

    expect(res.status).toBe('ok');
    expect(res.synced).toBe(0);
    expect(catalogCalls()).toHaveLength(0); // on n'appelle même pas le pair
    expect((await syncState(peer.id))!.lastError).toMatch(/row cap/i);
  });
});

describe('erreurs de transport', () => {
  it('signale l’échec sur le pair et n’avance pas le curseur', async () => {
    const peer = await makePeer();
    on(CATALOG, () => ({ status: 502, data: { ok: false, message: 'bad gateway' } }));

    const res = await syncPeerCatalogue(peer);

    expect(res.status).toBe('error');
    expect(await cursor(peer.id)).toBeNull();
    const st = await syncState(peer.id);
    expect(st!.lastStatus).toBe('error');
    expect(st!.lastError).toMatch(/bad gateway/);

    const [row] = await db
      .select()
      .from(schema.federationPeers)
      .where(eq(schema.federationPeers.id, peer.id));
    expect(row!.lastError).toMatch(/Catalogue sync/);
  });

  it('conserve la page déjà encaissée quand la suivante échoue', async () => {
    // Une coupure en cours de route ne doit ni perdre le travail fait, ni
    // laisser le curseur devant les données réellement écrites — sinon le
    // tour suivant sauterait la page manquante.
    const peer = await makePeer();
    let appel = 0;
    on(CATALOG, () => {
      appel++;
      if (appel === 1) {
        return page(
          Array.from({ length: PAGE_LIMIT }, (_, i) => item(i)),
          { createdAt: '2026-01-01T00:00:00.000Z', id: `r-${PAGE_LIMIT - 1}` },
        );
      }
      return { status: 500, data: { ok: false, message: 'boom' } };
    });

    const res = await syncPeerCatalogue(peer);

    expect(res.status).toBe('error');
    expect(res.synced).toBe(PAGE_LIMIT);
    expect(await mirrored(peer.id)).toHaveLength(PAGE_LIMIT);
    expect((await cursor(peer.id))!.id).toBe(`r-${PAGE_LIMIT - 1}`);
  });

  it('traite une réponse mal formée comme une erreur, pas comme une page vide', async () => {
    // `{ok:true}` sans tableau `items` ne veut pas dire « rien de neuf » :
    // le prendre pour une fin de flux marquerait la synchro réussie et
    // masquerait un partenaire cassé.
    const peer = await makePeer();
    on(CATALOG, () => ({ status: 200, data: { ok: true } }));

    const res = await syncPeerCatalogue(peer);

    expect(res.status).toBe('error');
  });
});

describe('notification des abonnés', () => {
  async function follow(userId: string, peerId: string, uploader: string) {
    await db.insert(schema.federatedFollows).values({
      id: randomUUID(),
      localUserId: userId,
      peerId,
      remoteUsername: uploader,
    });
  }

  async function notices(userId: string) {
    return db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId));
  }

  it('reste muet au tout premier passage', async () => {
    // Le premier passage rapatrie le catalogue entier du partenaire. Notifier
    // dessus enverrait des milliers d'alertes d'un coup pour des torrents qui
    // n'ont rien de nouveau.
    const peer = await makePeer();
    const user = await makeUser();
    await follow(user, peer.id, 'Uploader');
    on(CATALOG, () => page(Array.from({ length: 5 }, (_, i) => item(i))));

    await syncPeerCatalogue(peer);

    expect(await notices(user)).toHaveLength(0);
  });

  it('prévient l’abonné dès le passage suivant', async () => {
    const peer = await makePeer();
    const user = await makeUser();
    await follow(user, peer.id, 'Uploader');
    on(CATALOG, () => page([item(1)]));
    await syncPeerCatalogue(peer);

    on(CATALOG, () => page([item(2)]));
    await syncPeerCatalogue(peer);

    const recus = await notices(user);
    expect(recus).toHaveLength(1);
    expect(recus[0]!.type).toBe('federated_followed_upload');
    expect((recus[0]!.payload as Record<string, unknown>).uploaderName).toBe('Uploader');
  });

  it('ne re-notifie pas un torrent seulement rafraîchi', async () => {
    // La distinction tient à `xmax = 0` : seul un vrai INSERT compte comme
    // nouveauté. Sans elle, chaque rafraîchissement de stats re-sonnerait.
    const peer = await makePeer();
    const user = await makeUser();
    await follow(user, peer.id, 'Uploader');
    on(CATALOG, () => page([item(1)]));
    await syncPeerCatalogue(peer);
    await syncPeerCatalogue(peer); // même article, ré-encaissé
    await syncPeerCatalogue(peer);

    expect(await notices(user)).toHaveLength(0);
  });

  it('ne prévient pas l’abonné d’un autre uploadeur', async () => {
    const peer = await makePeer();
    const user = await makeUser();
    await follow(user, peer.id, 'QuelquUnDautre');
    on(CATALOG, () => page([item(1)]));
    await syncPeerCatalogue(peer);
    on(CATALOG, () => page([item(2)]));
    await syncPeerCatalogue(peer);

    expect(await notices(user)).toHaveLength(0);
  });

  it('plafonne la rafale qu’un partenaire peut déclencher', async () => {
    // Un pair qui fabrique 500 uploads d'un uploadeur suivi ne doit pas
    // pouvoir déclencher 500 notifications — et autant de mails.
    const peer = await makePeer();
    const user = await makeUser();
    await follow(user, peer.id, 'Uploader');
    on(CATALOG, () => page([item(0)]));
    await syncPeerCatalogue(peer);

    on(CATALOG, () => page(Array.from({ length: 60 }, (_, i) => item(i + 100))));
    await syncPeerCatalogue(peer);

    expect(await notices(user)).toHaveLength(25);
  });
});

describe('passes annexes — suppressions, rafraîchissement, stats', () => {
  it('supprime les lignes désignées par les tombstones, chez ce pair seulement', async () => {
    // La synchro de catalogue n'avance que vers l'avant : sans ce flux, une
    // suppression ou un bannissement chez le partenaire laisserait un miroir
    // orphelin avec un lien mort.
    const a = await makePeer();
    const b = await makePeer();
    on(CATALOG, () => page([item(1), item(2)]));
    await syncPeerCatalogue(a);
    await syncPeerCatalogue(b);

    partner.calls.length = 0;
    on(CATALOG, () => page([]));
    on(REMOVALS, (_p, base) =>
      base === a.baseUrl
        ? page([{ remoteId: 'r-1' }], { t: '2026-02-01T00:00:00.000Z', id: 'x' })
        : page([]),
    );

    const res = await syncAllCatalogues();

    expect(res.removed).toBeGreaterThanOrEqual(1);
    expect((await mirrored(a.id)).map((r) => r.remoteId)).toEqual(['r-2']);
    // Le pair B a le même remoteId : il ne doit pas être emporté.
    expect((await mirrored(b.id)).map((r) => r.remoteId).sort()).toEqual(['r-1', 'r-2']);
    expect(await cursor(a.id, 'catalog_removals')).toEqual({
      t: '2026-02-01T00:00:00.000Z',
      id: 'x',
    });
  });

  it('réapplique une métadonnée corrigée sans la compter comme nouveauté', async () => {
    const peer = await makePeer();
    const user = await makeUser();
    await db.insert(schema.federatedFollows).values({
      id: randomUUID(),
      localUserId: user,
      peerId: peer.id,
      remoteUsername: 'Uploader',
    });
    on(CATALOG, () => page([item(1, { name: 'Titre fautif' })]));
    await syncPeerCatalogue(peer);

    on(CATALOG, () => page([]));
    on(REFRESH, () => page([item(1, { name: 'Titre corrigé' })], {
      t: '2026-02-01T00:00:00.000Z',
      id: 'r-1',
    }));

    await syncAllCatalogues();

    const [row] = await mirrored(peer.id);
    expect(row!.name).toBe('Titre corrigé');
    // Une correction n'est pas une sortie : personne n'est prévenu.
    const recus = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, user));
    expect(recus).toHaveLength(0);
  });

  it('rafraîchit le swarm par infoHash, pair par pair', async () => {
    const a = await makePeer();
    const b = await makePeer();
    on(CATALOG, () => page([item(1, { seeders: 1, leechers: 1, completed: 1 })]));
    await syncPeerCatalogue(a);
    await syncPeerCatalogue(b);

    on(CATALOG, () => page([]));
    on(STATS, (_p, base) =>
      // Seul le pair A publie des stats ; B garde les siennes.
      base === a.baseUrl
        ? page(
            [{ infoHash: item(1).infoHash, seeders: 99, leechers: 7, completed: 3 }],
            { t: '2026-02-01T00:00:00.000Z', id: 'r-1' },
          )
        : page([]),
    );

    await syncAllCatalogues();

    const [rowA] = await mirrored(a.id);
    const [rowB] = await mirrored(b.id);
    expect(rowA!.seeders).toBe(99);
    expect(rowA!.leechers).toBe(7);
    expect(rowB!.seeders).toBe(1); // l'autre pair n'a pas bougé
  });

  it('n’interroge que les pairs actifs qui partagent leur catalogue', async () => {
    const actif = await makePeer();
    await makePeer({ status: 'suspended' });
    await makePeer({
      acceptsFromThem: { catalog: false, social: true, accounts: false, swarm: false },
    });
    on(CATALOG, () => page([item(1)]));

    const res = await syncAllCatalogues();

    expect(res.peers).toBe(1);
    expect(await mirrored(actif.id)).toHaveLength(1);
  });

  it('ne tire rien quand la fédération est éteinte', async () => {
    const peer = await makePeer();
    await db
      .update(schema.federationConfig)
      .set({ enabled: false })
      .where(eq(schema.federationConfig.id, 'singleton'));
    on(CATALOG, () => page([item(1)]));

    const res = await syncPeerCatalogue(peer);

    expect(res.status).toBe('error');
    expect(catalogCalls()).toHaveLength(0);
    expect(await mirrored(peer.id)).toHaveLength(0);
  });
});

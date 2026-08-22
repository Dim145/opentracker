import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import type { FederationPeer } from '@trackarr/db/schema';
import { makeUser } from './helpers';
import { didKeyFromPublicKey } from '../../utils/federation/did';
import { CONTEXT, signRecord } from '../../utils/federation/record';

// Ingesting signed records.
//
// This is where the architecture actually changes, so the tests are about one
// question: **is a record accepted because of its proof, or because of who
// sent it?** Everything below is a way of asking that.
//
// The old path trusted the connection, which is why a record could never be
// relayed — B saying "C published this" was unverifiable. If any of these
// tests can be made to pass by trusting the peer instead of the proof, the
// property is gone and with it every reason to have built this.
//
// The second theme is the one that gets signed-data systems compromised: a
// valid signature proves the issuer wrote these bytes and says NOTHING about
// whether the issuer is honest. A signed `size: -1` is a perfectly valid
// record.

/**
 * The partner is a real implementation of the other half.
 *
 * It answers reconciliation with `respond` over its own set and hands over
 * records by id, which is exactly what a partner instance does — so these
 * tests exercise the protocol rather than a fixture shaped like its output.
 * The network is the only thing faked.
 */
const partner = vi.hoisted(() => ({
  /** The partner's published set, keyed by content address. */
  records: new Map<string, unknown>(),
  calls: [] as string[],
  status: 200,
  /** Rounds it took to converge, for the tests that care. */
  rounds: 0,
}));

vi.mock('../../utils/federation/signing', async (importOriginal) => {
  const { respond, arraySource } = await import('../../utils/federation/rbsr');
  return {
    ...(await importOriginal<typeof import('../../utils/federation/signing')>()),
    signedPost: async ({ pathname, body }: { pathname: string; body: unknown }) => {
      partner.calls.push(pathname);
      if (partner.status !== 200) return { status: partner.status, data: null };

      if (pathname === '/api/federation/records') {
        const ids = ((body as { ids?: unknown }).ids ?? []) as string[];
        return {
          status: 200,
          data: {
            ok: true,
            records: ids.map((i) => partner.records.get(i)).filter(Boolean),
          },
        };
      }

      partner.rounds++;
      const step = await respond(
        (body as { ranges?: unknown }).ranges,
        arraySource([...partner.records.keys()]),
        { echoIds: true },
      );
      return { status: 200, data: { ok: true, ranges: step.reply } };
    },

  };
});

/**
 * Anything with an id that the partner can hand over.
 *
 * Deliberately not `SignedRecord`: half these tests serve records that have
 * been tampered with, stripped of their proof, or hand-built to be refused,
 * and a type admitting only well-formed ones would rule out exactly the cases
 * worth testing. The ingest takes `unknown` for the same reason.
 */
type SignedLike = { id?: unknown };

/** What the partner publishes. Replaces whatever it published before. */
function serve(...records: SignedLike[]): void {
  partner.records.clear();
  for (const r of records) partner.records.set(String(r.id), r);
}

/** Publish more without retracting what is already there. */
function alsoServe(...records: SignedLike[]): void {
  for (const r of records) partner.records.set(String(r.id), r);
}

const { syncPeerRecords } = await import('../../utils/federation/recordSync');
const { ensureFederationIdentity, getPrivateKeyPem } = await import(
  '../../utils/federation/config'
);

let issuer: ReturnType<typeof keypair>;
let counter = 0;

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    publicKeyPem,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    did: didKeyFromPublicKey(publicKeyPem),
  };
}

function record(over: Record<string, unknown> = {}) {
  const draft = {
    '@context': CONTEXT,
    type: 'Torrent',
    'bt:infohash_v1': (counter++).toString(16).padStart(40, 'e'),
    'bt:magnet': null,
    url: 'https://origin.example/torrents/abc',
    name: 'Show.S02E03.1080p.WEB-DL-NTb',
    content: null,
    published: '2026-05-01T00:00:00.000Z',
    attributedTo: null,
    'trackarr:size': 2_540_000_000,
    'trackarr:contentSignature': null,
    'trackarr:category': 'tv-hd',
    'trackarr:categoryType': 'tv',
    'trackarr:isAdult': false,
    'trackarr:tags': ['1080p'],
    'trackarr:imdbId': null,
    'trackarr:tmdbId': 'tv/1',
    'trackarr:tvdbId': null,
    'trackarr:igdbId': null,
    'trackarr:openlibraryId': null,
    'trackarr:season': 2,
    'trackarr:episode': 3,
    'trackarr:uploaderName': 'RemoteUp',
    'trackarr:issuer': issuer.did,
    'trackarr:replaces': null,
    ...over,
  };
  return signRecord(draft as never, {
    privateKeyPem: issuer.privateKeyPem,
    did: issuer.did,
  });
}

function tombstone(replaces: string, infoHash: string) {
  return signRecord(
    {
      '@context': CONTEXT,
      type: 'Tombstone',
      'bt:infohash_v1': infoHash,
      published: '2026-05-02T00:00:00.000Z',
      'trackarr:issuer': issuer.did,
      'trackarr:replaces': replaces,
    } as never,
    { privateKeyPem: issuer.privateKeyPem, did: issuer.did },
  );
}

/**
 * A partner whose key is the one signing these records.
 *
 * Records are only taken in from an instance we federate with, or on a
 * partner's countersignature — so a peer row without the issuer's public key
 * is a peer whose records are all refused, which is correct and useless as a
 * fixture.
 */
async function makePeer(displayName = 'Partner'): Promise<FederationPeer> {
  const id = randomUUID();
  const [row] = await db
    .insert(schema.federationPeers)
    .values({
      id,
      publicKey: issuer.publicKeyPem,
      baseUrl: `https://p-${id.slice(0, 8)}.example`,
      displayName,
      instanceId: `tk_${id.slice(0, 10)}`,
      status: 'active',
      sharesWithThem: { catalog: true, social: false, accounts: false, swarm: false },
      acceptsFromThem: { catalog: true, social: false, accounts: false, swarm: false },
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

beforeEach(async () => {
  partner.records.clear();
  partner.calls = [];
  partner.status = 200;
  partner.rounds = 0;
  counter = 0;
  issuer = keypair();
  // The identity is provisioned but federation ships DISABLED, and
  // `syncPeerRecords` refuses to run without it — as it should.
  await ensureFederationIdentity();
  // Reset the switches too, not just `enabled`. The config row survives
  // between tests, so a test that turns relaying on was leaving it on for
  // every test after it — and a relaying instance behaves differently enough
  // that the next failure would have looked like a defect in the code.
  await db
    .update(schema.federationConfig)
    .set({ enabled: true, relayEnabled: false, discoverable: false })
    .where(eq(schema.federationConfig.id, 'singleton'));
});

describe('accepting a record', () => {
  it('mirrors one that verifies, and marks it verified', async () => {
    const peer = await makePeer();
    const r = record();
    serve(r);

    const out = await syncPeerRecords(peer);
    expect(out.ingested).toBe(1);
    expect(out.rejected).toBe(0);

    const [row] = await mirrored(peer.id);
    expect(row!.verified).toBe(true);
    expect(row!.recordId).toBe(r.id);
    // The signer, not the sender. They are the same here and will not be once
    // records are relayed — storing the sender would quietly make the
    // distinction unrecoverable.
    expect(row!.issuer).toBe(issuer.did);
    expect(row!.season).toBe(2);
    expect(row!.episode).toBe(3);
  });

  it('refuses one that was edited in flight', async () => {
    // The property the whole design rests on. If a peer can change a record
    // and have it accepted, nothing above this line is worth anything.
    const peer = await makePeer();
    const tampered = JSON.parse(JSON.stringify(record()));
    tampered.name = 'Something.Else-A';
    serve(tampered);

    const out = await syncPeerRecords(peer);
    expect(out.ingested).toBe(0);
    expect(out.rejected).toBe(1);
    expect(await mirrored(peer.id)).toHaveLength(0);
  });

  it('refuses one with no proof at all', async () => {
    const peer = await makePeer();
    const bare = JSON.parse(JSON.stringify(record()));
    delete bare.proof;
    serve(bare);

    expect((await syncPeerRecords(peer)).rejected).toBe(1);
    expect(await mirrored(peer.id)).toHaveLength(0);
  });

  it('keeps the good records of a page that also carries bad ones', async () => {
    // A partner sending one forged record must not cost us the rest of the
    // page — otherwise a single bad row is a denial of service on the sync.
    const peer = await makePeer();
    const bad = JSON.parse(JSON.stringify(record()));
    bad['trackarr:size'] = 1;
    serve(record(), bad, record());

    const out = await syncPeerRecords(peer);
    expect(out.ingested).toBe(2);
    expect(out.rejected).toBe(1);
    expect(await mirrored(peer.id)).toHaveLength(2);
  });

  it('leaves the failures where an operator can see them', async () => {
    const peer = await makePeer();
    const bad = JSON.parse(JSON.stringify(record()));
    bad.name = 'edited';
    serve(bad);
    await syncPeerRecords(peer);

    const [state] = await db
      .select()
      .from(schema.federationSyncState)
      .where(eq(schema.federationSyncState.peerId, peer.id));
    expect(state!.lastStatus).toBe('partial');
    expect(state!.lastError).toContain('verification');
  });
});

describe('a proof is not a validation', () => {
  it('coerces a signed but implausible value instead of storing it', async () => {
    // A valid signature proves the issuer wrote these bytes. It says nothing
    // about whether the issuer is honest, and conflating the two is how
    // signed-data systems get compromised.
    const peer = await makePeer();
    serve(record({
            name: 'Unreadable.Upload',
            'trackarr:size': -5,
            'trackarr:season': 99_999,
            'trackarr:episode': 1.5,
            url: 'javascript:alert(1)',
          }));

    await syncPeerRecords(peer);
    const [row] = await mirrored(peer.id);
    expect(row!.size).toBe(0);
    expect(row!.season).toBeNull();
    expect(row!.episode).toBeNull();
    // Never a `javascript:` URL into a template's href, signed or not.
    expect(row!.remoteDetailUrl?.startsWith('https://')).toBe(true);
  });

  it('takes the release location from the record, not from the relay', async () => {
    // A record says where its content lives. The peer that handed it over is
    // not necessarily that place, and will not be once records are relayed.
    const peer = await makePeer();
    serve(record({ url: 'https://origin.example/torrents/xyz' }));

    await syncPeerRecords(peer);
    const [row] = await mirrored(peer.id);
    expect(row!.remoteDetailUrl).toBe('https://origin.example/torrents/xyz');
  });
});

describe('the lifecycle a record carries', () => {
  it('replaces the generation it supersedes', async () => {
    const peer = await makePeer();
    const first = record({ name: 'First.Name-A' });
    serve(first);
    await syncPeerRecords(peer);

    const second = record({
      name: 'Second.Name-A',
      'bt:infohash_v1': (first as unknown as Record<string, string>)['bt:infohash_v1'],
      'trackarr:replaces': first.id,
    });
    serve(second);
    await syncPeerRecords(peer);

    const rows = await mirrored(peer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Second.Name-A');
    expect(rows[0]!.recordId).toBe(second.id);
  });

  it('applies a withdrawal as a statement', async () => {
    const peer = await makePeer();
    const r = record();
    serve(r);
    await syncPeerRecords(peer);
    expect(await mirrored(peer.id)).toHaveLength(1);

    const hash = (r as unknown as Record<string, string>)['bt:infohash_v1']!;
    serve(tombstone(r.id, hash));
    const out = await syncPeerRecords(peer);

    expect(out.withdrawn).toBeGreaterThan(0);
    expect(await mirrored(peer.id)).toHaveLength(0);
  });

  it('refuses a forged withdrawal', async () => {
    // Otherwise anyone able to reach us could empty the mirror.
    const peer = await makePeer();
    const r = record();
    serve(r);
    await syncPeerRecords(peer);

    const hash = (r as unknown as Record<string, string>)['bt:infohash_v1']!;
    const forged = JSON.parse(JSON.stringify(tombstone(r.id, hash)));
    forged['trackarr:issuer'] = 'did:key:zSomebodyElse';
    // Alongside, not instead: if the partner simply stopped publishing the
    // record, its absence would retire it and the forgery would prove nothing.
    alsoServe(forged);

    const out = await syncPeerRecords(peer);
    expect(out.rejected).toBe(1);
    expect(await mirrored(peer.id)).toHaveLength(1);
  });
});

describe('the sync loop', () => {
  it('is idempotent — the same record twice is one row', async () => {
    const peer = await makePeer();
    const r = record();
    serve(r);
    await syncPeerRecords(peer);
    serve(r);
    await syncPeerRecords(peer);

    expect(await mirrored(peer.id)).toHaveLength(1);
  });

  it('settles in a single exchange when nothing has changed', async () => {
    // The steady state, and the case the watermark was cheap for. One
    // request, one `skip` back, nothing fetched — and unlike the watermark,
    // the two sides have PROVEN they agree rather than assumed it.
    const peer = await makePeer();
    for (let i = 0; i < 5; i++) alsoServe(record());
    await syncPeerRecords(peer);

    partner.calls = [];
    const out = await syncPeerRecords(peer);

    expect(out.rounds).toBe(1);
    expect(out.ingested).toBe(0);
    expect(partner.calls).toEqual(['/api/federation/reconcile']);
  });

  it('converges without being told where to start', async () => {
    // No watermark is exchanged and none is stored. The partner publishes a
    // hundred records to a mirror that holds none, and the difference is
    // worked out from fingerprints alone.
    const peer = await makePeer();
    for (let i = 0; i < 100; i++) alsoServe(record());

    const out = await syncPeerRecords(peer);

    expect(out.ingested).toBe(100);
    expect(await mirrored(peer.id)).toHaveLength(100);
    // Logarithmic, not linear: a hundred records is a handful of exchanges.
    expect(out.rounds).toBeLessThan(5);
  });

  it('notices a record it somehow missed, on the next pass', async () => {
    // The failure a forward-only cursor could never recover from. Delete a
    // mirrored row behind the sync's back — a bug, a crash mid-page, a
    // partner that served a short page — and the next run must find it.
    const peer = await makePeer();
    for (let i = 0; i < 40; i++) alsoServe(record());
    await syncPeerRecords(peer);

    const [victim] = await mirrored(peer.id);
    await db
      .delete(schema.remoteTorrents)
      .where(eq(schema.remoteTorrents.id, victim!.id));

    const out = await syncPeerRecords(peer);

    expect(out.ingested).toBe(1);
    expect(await mirrored(peer.id)).toHaveLength(40);
  });

  it('drops what the partner has stopped publishing', async () => {
    // An absence IS a withdrawal. No tombstone was sent here — the record is
    // simply not in the partner's set any more, and that is enough.
    const peer = await makePeer();
    const keep = record();
    const drop = record();
    serve(keep, drop);
    await syncPeerRecords(peer);
    expect(await mirrored(peer.id)).toHaveLength(2);

    serve(keep);
    const out = await syncPeerRecords(peer);

    expect(out.withdrawn).toBe(1);
    const left = await mirrored(peer.id);
    expect(left).toHaveLength(1);
    expect(left[0]!.remoteId).toBe(keep.id);
  });

  it('records a transport failure without throwing', async () => {
    const peer = await makePeer();
    partner.status = 503;

    const out = await syncPeerRecords(peer);
    expect(out.error).toContain('503');

    const [state] = await db
      .select()
      .from(schema.federationSyncState)
      .where(eq(schema.federationSyncState.peerId, peer.id));
    expect(state!.lastStatus).toBe('error');
  });

  it('keeps two partners\' copies of one record apart', async () => {
    // They are two places to fetch the same statement, not one row. Collapsing
    // them would erase a source along with its address.
    const a = await makePeer();
    const b = await makePeer();
    const r = record();

    serve(r);
    await syncPeerRecords(a);
    serve(r);
    await syncPeerRecords(b);

    expect(await mirrored(a.id)).toHaveLength(1);
    expect(await mirrored(b.id)).toHaveLength(1);
  });
});

describe('where a release belongs', () => {
  // The grouped catalogue stands on season and episode: a release with no
  // position does not merely lose a label, it falls out of its group.

  it('takes the position the record carries', async () => {
    const peer = await makePeer();
    serve(record());

    await syncPeerRecords(peer);

    const [row] = await mirrored(peer.id);
    expect(row!.season).toBe(2);
    expect(row!.episode).toBe(3);
  });

  it('re-derives it from the name when the record carries none', async () => {
    // The issuer may simply never have parsed. Re-parsing costs a handful of
    // regexes over a string we are storing anyway, and it is the same parser
    // the local catalogue uses — so a release looks the same whichever side
    // of the federation it came from.
    const peer = await makePeer();
    serve(record({
            name: 'Another.Show.S04E11.2160p.WEB-DL',
            'trackarr:season': null,
            'trackarr:episode': null,
          }));

    await syncPeerRecords(peer);

    const [row] = await mirrored(peer.id);
    expect(row!.season).toBe(4);
    expect(row!.episode).toBe(11);
  });

  it('reads a season pack as a season with no episode', async () => {
    const peer = await makePeer();
    serve(record({
            name: 'Another.Show.S04.COMPLETE.1080p.WEB-DL',
            'trackarr:season': null,
            'trackarr:episode': null,
          }));

    await syncPeerRecords(peer);

    const [row] = await mirrored(peer.id);
    expect(row!.season).toBe(4);
    expect(row!.episode).toBeNull();
  });

  it('leaves a film with no position', async () => {
    const peer = await makePeer();
    serve(record({
            name: 'Some.Film.2024.1080p.BluRay',
            'trackarr:season': null,
            'trackarr:episode': null,
          }));

    await syncPeerRecords(peer);

    const [row] = await mirrored(peer.id);
    expect(row!.season).toBeNull();
    expect(row!.episode).toBeNull();
  });

  it('keeps a position the issuer corrected by hand', async () => {
    // The issuer saw the upload form: a human may have fixed what the parser
    // guessed, and that correction is the better answer. The fallback must
    // not overrule it.
    const peer = await makePeer();
    serve(record({
            name: 'Show.S09E09.1080p-NTb',
            'trackarr:season': 1,
            'trackarr:episode': 2,
          }));

    await syncPeerRecords(peer);

    const [row] = await mirrored(peer.id);
    expect(row!.season).toBe(1);
    expect(row!.episode).toBe(2);
  });
});

describe('containing a hostile issuer', () => {
  // Signatures move the threat, they do not remove it. Anyone can mint a
  // keypair, so "a valid record" is a statement about authorship and not about
  // restraint: an issuer may sign a name the length of a novel, or a million
  // records. These are the bounds that hold regardless of the proof.

  it('truncates oversized fields instead of rejecting them', async () => {
    const peer = await makePeer();
    serve(record({
            name: 'N'.repeat(5_000),
            content: 'D'.repeat(80_000),
            'trackarr:tags': Array.from({ length: 400 }, (_, i) => `tag-${i}`),
          }));

    await syncPeerRecords(peer);

    const [row] = await mirrored(peer.id);
    expect(row!.name.length).toBe(1_000);
    expect(row!.description!.length).toBe(20_000);
    expect(row!.tags).toHaveLength(50);
  });

  it('clamps absurd counters to what the column can hold', async () => {
    const peer = await makePeer();
    serve(record({ 'trackarr:size': 1e30 }));

    await syncPeerRecords(peer);

    const [row] = await mirrored(peer.id);
    expect(Number(row!.size)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });

  it('refuses to go past the per-partner row cap', async () => {
    // Last-resort guard: past 100 000 mirrored rows we stop pulling from this
    // partner. A proof does not entitle anybody to unbounded disk — minting a
    // million valid records is no harder than minting one.
    const peer = await makePeer();
    await db.execute(sql`
      INSERT INTO remote_torrents (id, peer_id, remote_id, info_hash, name, size)
      SELECT gen_random_uuid()::text, ${peer.id}, 'bulk-' || g, lpad(g::text, 40, '0'),
             'Bulk ' || g, 0
      FROM generate_series(1, 100000) g
    `);
    serve(record());

    const out = await syncPeerRecords(peer);

    expect(out.ingested).toBe(0);
    expect(partner.calls).toHaveLength(0); // we do not even call the partner
    const [state] = await db
      .select()
      .from(schema.federationSyncState)
      .where(eq(schema.federationSyncState.peerId, peer.id));
    expect(state!.lastError).toMatch(/row cap/i);
  });
});

describe('telling followers about a partner they follow', () => {
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

  it('stays silent on the very first run', async () => {
    // The first run pulls the partner's entire catalogue. Notifying on it
    // would fire thousands of alerts at once for releases that are not new.
    const peer = await makePeer();
    const user = await makeUser();
    await follow(user, peer.id, 'RemoteUp');
    serve(...Array.from({ length: 5 }, () => record()));

    await syncPeerRecords(peer);

    expect(await notices(user)).toHaveLength(0);
  });

  it('tells the follower from the next run onwards', async () => {
    const peer = await makePeer();
    const user = await makeUser();
    await follow(user, peer.id, 'RemoteUp');
    serve(record());
    await syncPeerRecords(peer);

    serve(record());
    await syncPeerRecords(peer);

    const received = await notices(user);
    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe('federated_followed_upload');
    expect((received[0]!.payload as Record<string, unknown>).uploaderName).toBe(
      'RemoteUp',
    );
  });

  it('does not ring twice for a record it already had', async () => {
    // The distinction rests on `xmax = 0`: only a real INSERT counts as new.
    // A partner re-serving its stream must not re-notify anybody.
    const peer = await makePeer();
    const user = await makeUser();
    await follow(user, peer.id, 'RemoteUp');
    const same = record();
    serve(same);
    await syncPeerRecords(peer);
    serve(same);
    await syncPeerRecords(peer);
    serve(same);
    await syncPeerRecords(peer);

    expect(await notices(user)).toHaveLength(0);
  });

  it('does not tell a follower about a different uploader', async () => {
    const peer = await makePeer();
    const user = await makeUser();
    await follow(user, peer.id, 'SomebodyElse');
    serve(record());
    await syncPeerRecords(peer);
    serve(record());
    await syncPeerRecords(peer);

    expect(await notices(user)).toHaveLength(0);
  });

  it('caps the burst a partner can trigger', async () => {
    // A partner minting 60 valid records from a followed uploader must not be
    // able to trigger 60 notifications — and as many emails. The records are
    // genuine; the flood is the problem.
    const peer = await makePeer();
    const user = await makeUser();
    await follow(user, peer.id, 'RemoteUp');
    serve(record());
    await syncPeerRecords(peer);

    alsoServe(...Array.from({ length: 60 }, () => record()));
    await syncPeerRecords(peer);

    expect(await notices(user)).toHaveLength(25);
  });
});

describe('the switch', () => {
  it('pulls nothing while federation is off', async () => {
    const peer = await makePeer();
    await db
      .update(schema.federationConfig)
      .set({ enabled: false })
      .where(eq(schema.federationConfig.id, 'singleton'));
    serve(record());

    await syncPeerRecords(peer);

    expect(partner.calls).toHaveLength(0);
    expect(await mirrored(peer.id)).toHaveLength(0);
  });
});

describe('who wrote it, once it has travelled', () => {
  it('keeps the author as a name, not as a caption', async () => {
    // The display name arrives too, and stays a display name. What makes
    // "everything this person published" answerable across partners is the
    // DID, because it is the same string on every instance holding the record.
    const peer = await makePeer();
    const author = 'did:key:z6MkAuthorOfTheseThings';
    serve(record({ attributedTo: author }));

    await syncPeerRecords(peer);

    const [row] = await mirrored(peer.id);
    expect(row!.authorDid).toBe(author);
    expect(row!.uploaderName).toBe('RemoteUp');
    // The signer and the author are different facts about the same record.
    expect(row!.issuer).not.toBe(author);
  });

  it('recognises one remote author across two partners', async () => {
    // The reason the author is a DID and not a name. Two partners mirroring
    // the same person's work must agree on who that person is without either
    // of them having to ask the other.
    const a = await makePeer('A');
    const b = await makePeer('B');
    const author = 'did:key:z6MkTheSamePersonBothTimes';

    serve(record({ attributedTo: author }));
    await syncPeerRecords(a);
    serve(record({ attributedTo: author }));
    await syncPeerRecords(b);

    const rows = [...(await mirrored(a.id)), ...(await mirrored(b.id))];
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.authorDid))).toEqual(new Set([author]));
  });

  it('leaves the author null rather than inventing one', async () => {
    const peer = await makePeer();
    serve(record({ attributedTo: null }));

    await syncPeerRecords(peer);

    expect((await mirrored(peer.id))[0]!.authorDid).toBeNull();
  });
});

describe('the set the two sides actually compare', () => {
  // The defect this file did not catch, and the review did.
  //
  // Reconciliation used to compare the MIRROR against what a partner served.
  // The mirror only holds torrents, so a tombstone — or an identity assertion,
  // or a revocation — was permanently missing from our side: fetched again on
  // every tick, ingested to no effect, still missing. With `ingested=0`,
  // `status=ok` and no log line, because nothing about it moved a counter.
  //
  // Every test below drives TWO syncs and asserts the second one is quiet.
  // That is the property that was broken, and asserting a single sync's
  // outcome is exactly what missed it.

  async function sourcedIds(peerId: string): Promise<string[]> {
    const rows = await db
      .select({ id: schema.recordSources.recordId })
      .from(schema.recordSources)
      .where(eq(schema.recordSources.peerId, peerId));
    return rows.map((r) => r.id).sort();
  }

  it('holds a tombstone in the compared set, so it is fetched once', async () => {
    const peer = await makePeer();
    const r = record();
    serve(r);
    await syncPeerRecords(peer);

    const hash = (r as unknown as Record<string, string>)['bt:infohash_v1']!;
    serve(tombstone(r.id, hash));
    const first = await syncPeerRecords(peer);
    expect(first.withdrawn).toBe(1);

    // The second pass must find nothing to do. Before the fix it fetched the
    // tombstone again here, and would have gone on doing so forever.
    partner.calls = [];
    const second = await syncPeerRecords(peer);
    expect(second.ingested).toBe(0);
    expect(second.withdrawn).toBe(0);
    expect(second.rounds).toBe(1);
    expect(partner.calls).toEqual(['/api/federation/reconcile']);
  });

  it('settles after an identity assertion, which has no mirror row at all', async () => {
    const peer = await makePeer();
    const person = signRecord(
      {
        '@context': CONTEXT,
        type: 'Person',
        'trackarr:subject': 'did:key:z6MkTheirMember',
        alsoKnownAs: [],
        'trackarr:evidence': [],
        published: '2026-05-01T00:00:00.000Z',
        'trackarr:issuer': issuer.did,
        'trackarr:replaces': null,
      } as never,
      { privateKeyPem: issuer.privateKeyPem, did: issuer.did },
    );
    serve(person);

    await syncPeerRecords(peer);
    partner.calls = [];
    const second = await syncPeerRecords(peer);

    expect(second.rounds).toBe(1);
    expect(partner.calls).toEqual(['/api/federation/reconcile']);
    expect(await sourcedIds(peer.id)).toEqual([person.id]);
  });

  it('forgets a source when the partner stops serving it', async () => {
    // Otherwise the record stays in the set we compare and the next round
    // reports it missing again — the same defect, pointing the other way.
    const peer = await makePeer();
    const keep = record();
    const drop = record();
    serve(keep, drop);
    await syncPeerRecords(peer);
    expect(await sourcedIds(peer.id)).toHaveLength(2);

    serve(keep);
    await syncPeerRecords(peer);
    expect(await sourcedIds(peer.id)).toEqual([keep.id]);

    partner.calls = [];
    const third = await syncPeerRecords(peer);
    expect(third.rounds).toBe(1);
    expect(third.withdrawn).toBe(0);
  });

  it('picks up what it already knew about when relaying is switched on', async () => {
    // A defect a live mesh found and this file did not. Storage is
    // conditional, so an instance with relaying off holds a partner's records
    // as associations and no bytes. Reconciliation then agrees with the
    // partner forever — correctly, the sets DO match — so flipping the switch
    // would have carried only what happened to arrive afterwards, while the
    // interface said "carrying partners' records and handing them on".
    const peer = await makePeer();
    for (let i = 0; i < 3; i++) alsoServe(record());
    await syncPeerRecords(peer);
    expect(await sourcedIds(peer.id)).toHaveLength(3);
    expect(await db.select().from(schema.catalogRecords)).toHaveLength(0);

    await db
      .update(schema.federationConfig)
      .set({ relayEnabled: true })
      .where(eq(schema.federationConfig.id, 'singleton'));

    await syncPeerRecords(peer);
    const held = await db.select().from(schema.catalogRecords);
    expect(held).toHaveLength(3);
    expect(held.every((r) => r.origin === 'ingested')).toBe(true);

    // And it converges: the next pass asks for nothing, or turning the switch
    // on would re-fetch the partner's catalogue on every tick from then on —
    // the very shape of defect this describe block exists for.
    partner.calls = [];
    const after = await syncPeerRecords(peer);
    expect(after.ingested).toBe(0);
    expect(partner.calls).toEqual(['/api/federation/reconcile']);
  });

  it('asks for nothing extra while relaying stays off', async () => {
    // The backfill must not fire on an instance that never opted in, or the
    // storage split buys nothing and every instance pays for a relay it does
    // not run.
    const peer = await makePeer();
    for (let i = 0; i < 3; i++) alsoServe(record());
    await syncPeerRecords(peer);

    partner.calls = [];
    const second = await syncPeerRecords(peer);
    expect(second.ingested).toBe(0);
    expect(partner.calls).toEqual(['/api/federation/reconcile']);
    expect(await db.select().from(schema.catalogRecords)).toHaveLength(0);
  });

  it('does not mirror our own records handed back by a relay', async () => {
    // Guaranteed the moment anybody relays for us: a relay serves what it took
    // in first-hand, and what it took in first-hand includes ours. Left alone,
    // an instance mirrors its whole catalogue once per relay — its own
    // releases listed as somebody else's, its row cap spent on what it already
    // has. A three-instance mesh showed exactly that, and nothing complained.
    const config = (await db.select().from(schema.federationConfig).limit(1))[0]!;
    const ourDid = didKeyFromPublicKey(config.publicKey!);
    const ours = signRecord(
      {
        ...(JSON.parse(JSON.stringify(record())) as Record<string, unknown>),
        proof: undefined,
        id: undefined,
        'trackarr:issuer': ourDid,
      } as never,
      { privateKeyPem: getPrivateKeyPem(config)!, did: ourDid },
    );

    // Minted here first, because that is the situation: we published it, a
    // relay took it in, and now the relay is handing it back to us.
    await db.insert(schema.catalogRecords).values({
      id: ours.id,
      torrentId: randomUUID(),
      infoHash: (ours as unknown as Record<string, string>)['bt:infohash_v1']!,
      issuer: ourDid,
      kind: 'torrent',
      body: ours as unknown as Record<string, unknown>,
      contentHash: ours.id,
      origin: 'local',
    });

    // The relay is a partner, and it countersigns — so this record IS admitted.
    // What must not happen is the mirror row, not the admission.
    const peer = await makePeer('Relay');
    serve(ours);
    const out = await syncPeerRecords(peer);

    expect(out.rejected).toBe(0);
    expect(await mirrored(peer.id)).toHaveLength(0);

    // But the source IS noted, or the record stays permanently missing from
    // our side of the comparison and is re-fetched on every tick forever —
    // the exact defect this table was added to fix.
    expect(await sourcedIds(peer.id)).toEqual([ours.id]);

    partner.calls = [];
    const second = await syncPeerRecords(peer);
    expect(second.rounds).toBe(1);
    expect(partner.calls).toEqual(['/api/federation/reconcile']);
  });

  it('still repairs a mirror row lost behind its back', async () => {
    // Comparing the mirror gave this for free and cost the bug above. Now it
    // is a deliberate step, so it needs a deliberate test.
    const peer = await makePeer();
    for (let i = 0; i < 5; i++) alsoServe(record());
    await syncPeerRecords(peer);

    const [victim] = await mirrored(peer.id);
    await db
      .delete(schema.remoteTorrents)
      .where(eq(schema.remoteTorrents.id, victim!.id));

    const out = await syncPeerRecords(peer);
    expect(out.ingested).toBe(1);
    expect(await mirrored(peer.id)).toHaveLength(5);
  });
});

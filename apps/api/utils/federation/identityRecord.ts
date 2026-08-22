/**
 * Publishing "our member is also that person elsewhere".
 *
 * Step 7c let a member prove, to this instance, that they were somebody on a
 * partner. That proof then sat here and helped nobody: the partner does not
 * know, the other partners do not know, and the member's work on the two
 * instances stays two unrelated bodies of work.
 *
 * This publishes the link, as a record like any other. It reconciles, relays
 * and outlives us exactly the way a torrent record does — which is the whole
 * point, because the case that matters is the one where the instance holding
 * the account is gone.
 *
 * ## Why an assertion and not a re-attribution
 *
 * The obvious move looks simpler: once Nova proves she was `did:key:X` on A,
 * attribute her uploads HERE to `X` too, and her catalogue is one catalogue.
 *
 * It is the wrong move, for three reasons that only show up later. A member
 * with proven accounts on two partners has two remote identifiers and no rule
 * says which one wins. This instance would be signing records under an
 * identifier whose key it does not hold and never did. And the link itself
 * would become invisible — a reader would see records under `X` issued by two
 * instances and have no way to learn why, or to check.
 *
 * So the identifiers stay distinct and the RELATION is published: our member
 * is `did:key:LOCAL`, also known as `did:key:X`, and here is the document that
 * proved it. Nothing is claimed under anybody else's key, several aliases
 * compose without a tie-break, and a reader can verify the link instead of
 * believing it. It is `alsoKnownAs`, which is the field ActivityPub and DID
 * documents already use for exactly this.
 *
 * ## The evidence travels with the assertion
 *
 * A partner's word that two identifiers are one person is worth precisely as
 * much as the document it saw. Carrying that document inside the record costs
 * a couple of kilobytes and buys the difference between "B says so" and
 * "anybody can check": the evidence is self-verifying, so a third instance
 * confirms the link without trusting B and without asking A.
 */
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { canonicalBytes } from './jcs';
import { createHash, randomUUID } from 'node:crypto';
import { CONTEXT, signRecord, type SignedRecord } from './record';
import { verifyIdentity } from './identityDoc';
import { ensureUserDid } from './userIdentity';
import type { MintContext } from './catalogRecord';

/** What one member's identity record says. Nothing else may influence its id. */
export interface IdentityProjection {
  subjectDid: string;
  /** Sorted. An unsorted array would mint a new record on every sweep. */
  alsoKnownAs: string[];
  /** The documents that proved them, in the same order as `alsoKnownAs`. */
  evidence: Array<Record<string, unknown>>;
  /**
   * When the most recent link was proven.
   *
   * Not "now": a timestamp that moves on its own would change the record's
   * content address on every sweep and republish it forever. The newest
   * verification is stable, and moves exactly when the assertion changes.
   */
  provenAt: Date;
}

export function projectIdentity(
  p: IdentityProjection,
  issuerDid: string,
): Record<string, unknown> {
  return {
    '@context': CONTEXT,
    type: 'Person',
    'trackarr:subject': p.subjectDid,
    // AS2's own field for "the same person, under another identifier".
    alsoKnownAs: [...p.alsoKnownAs].sort(),
    'trackarr:evidence': p.evidence,
    published: p.provenAt.toISOString(),
    'trackarr:issuer': issuerDid,
    'trackarr:replaces': null,
  };
}

/**
 * What this instance can say about its members' other names.
 *
 * Only links proven by key. A bio-proven link is a conversation we had with a
 * partner that is not reproducible by anybody else — publishing it would be
 * asking every reader to take our word for something we cannot show them.
 */
export async function loadIdentityProjections(
  userIds?: string[],
): Promise<Map<string, IdentityProjection>> {
  const rows = await db
    .select({
      localUserId: schema.federatedIdentities.localUserId,
      subjectDid: schema.federatedIdentities.subjectDid,
      verifiedAt: schema.federatedIdentities.verifiedAt,
      evidence: schema.federatedIdentities.evidence,
    })
    .from(schema.federatedIdentities)
    .where(
      userIds?.length
        ? and(
            eq(schema.federatedIdentities.method, 'key'),
            eq(schema.federatedIdentities.status, 'verified'),
            inArray(schema.federatedIdentities.localUserId, userIds),
          )
        : and(
            eq(schema.federatedIdentities.method, 'key'),
            eq(schema.federatedIdentities.status, 'verified'),
          ),
    )
    .orderBy(asc(schema.federatedIdentities.subjectDid));

  const byUser = new Map<string, IdentityProjection>();
  for (const r of rows) {
    if (!r.subjectDid || !r.evidence) continue;
    const existing = byUser.get(r.localUserId);
    const at = r.verifiedAt ?? new Date(0);
    if (existing) {
      existing.alsoKnownAs.push(r.subjectDid);
      existing.evidence.push(r.evidence);
      if (at > existing.provenAt) existing.provenAt = at;
    } else {
      byUser.set(r.localUserId, {
        // Filled by the caller, which is the only place that may mint a key.
        subjectDid: '',
        alsoKnownAs: [r.subjectDid],
        evidence: [r.evidence],
        provenAt: at,
      });
    }
  }
  return byUser;
}

function fingerprint(doc: Record<string, unknown>): string {
  return `sha256:${createHash('sha256').update(canonicalBytes(doc)).digest('hex')}`;
}

/**
 * Mint the identity records that have changed, and retire the ones that have
 * nothing left to say.
 *
 * Same discipline as the catalogue sweep, and for the same reason: the record
 * is addressed by its content, so a projection that varies between two sweeps
 * over unchanged data republishes itself forever. Everything that goes in is
 * either stable or moves exactly when the assertion does.
 */
export async function mintIdentityRecords(
  ctx: MintContext,
): Promise<{ minted: number; withdrawn: number }> {
  const projections = await loadIdentityProjections();
  let minted = 0;

  for (const [userId, projection] of projections) {
    projection.subjectDid = await ensureUserDid(userId);
    const draft = projectIdentity(projection, ctx.did);
    const contentHash = fingerprint(draft);

    const [current] = await db
      .select()
      .from(schema.catalogRecords)
      .where(
        and(
          eq(schema.catalogRecords.kind, 'identity'),
          eq(schema.catalogRecords.torrentId, userId),
          isNull(schema.catalogRecords.supersededAt),
          eq(schema.catalogRecords.origin, 'local'),
        ),
      )
      .limit(1);

    if (current?.contentHash === contentHash) continue;

    const signed = signRecord(
      { ...draft, 'trackarr:replaces': current?.id ?? null } as never,
      { privateKeyPem: ctx.privateKeyPem, did: ctx.did },
    ) as SignedRecord;

    await db.transaction(async (tx) => {
      if (current) {
        await tx
          .update(schema.catalogRecords)
          .set({ supersededAt: new Date() })
          .where(eq(schema.catalogRecords.id, current.id));
      }
      await tx
        .insert(schema.catalogRecords)
        .values({
          id: signed.id,
          // The subject, in the column that means "what this is about". Not a
          // torrent id — the column is deliberately not a foreign key, which
          // is what makes it usable for a record about something else.
          torrentId: userId,
          infoHash: null,
          issuer: ctx.did,
          kind: 'identity',
          body: signed as unknown as Record<string, unknown>,
          contentHash,
          supersedes: current?.id ?? null,
        })
        .onConflictDoNothing({ target: schema.catalogRecords.id });
    });
    minted++;
  }

  // A member who unlinked everything: the assertion is no longer true and has
  // to be retired, not merely stop being refreshed. Silence is not a retraction
  // to anybody who already holds the record.
  const live = await db
    .select({ id: schema.catalogRecords.id, subject: schema.catalogRecords.torrentId })
    .from(schema.catalogRecords)
    .where(
      and(
        eq(schema.catalogRecords.kind, 'identity'),
        isNull(schema.catalogRecords.supersededAt),
        // Ours only: retiring a partner's assertion about its own members is
        // not ours to do.
        eq(schema.catalogRecords.origin, 'local'),
      ),
    );
  let withdrawn = 0;
  for (const row of live) {
    if (row.subject && projections.has(row.subject)) continue;
    await db
      .update(schema.catalogRecords)
      .set({ supersededAt: new Date() })
      .where(eq(schema.catalogRecords.id, row.id));
    withdrawn++;
  }

  return { minted, withdrawn };
}

/**
 * Take in a partner's identity assertion.
 *
 * The record's own proof has already been checked by the ingest — that is what
 * says the partner really published this. What is checked HERE is the part the
 * partner cannot vouch for on its own: each piece of evidence must be a valid
 * identity document whose subject is the alias being claimed. Without that, a
 * partner could assert any two identifiers were one person, and every instance
 * downstream would repeat it.
 *
 * An alias with no usable evidence is dropped and the rest are kept: one bad
 * entry is not a reason to lose a member's real links.
 */
export async function ingestIdentityRecord(
  peerId: string,
  recordId: string,
  issuer: string,
  body: Record<string, unknown>,
): Promise<number> {
  const subject = body['trackarr:subject'];
  if (typeof subject !== 'string' || !subject.startsWith('did:key:')) return 0;

  const aliases = Array.isArray(body.alsoKnownAs) ? body.alsoKnownAs : [];
  const evidence = Array.isArray(body['trackarr:evidence'])
    ? (body['trackarr:evidence'] as unknown[])
    : [];

  // Index the evidence by the identifier it actually proves, rather than
  // trusting it to line up positionally with the alias list — a partner that
  // shuffled one of them would otherwise have every alias attested by the
  // wrong document.
  const proven = new Map<string, Record<string, unknown>>();
  for (const doc of evidence) {
    const v = verifyIdentity(doc);
    if (v.ok && v.subject) proven.set(v.subject, doc as Record<string, unknown>);
  }

  let kept = 0;
  for (const alias of aliases) {
    if (typeof alias !== 'string' || !alias.startsWith('did:key:')) continue;
    const doc = proven.get(alias);
    if (!doc) continue;
    await db
      .insert(schema.remoteIdentityLinks)
      .values({
        id: randomUUID(),
        peerId,
        issuer,
        subjectDid: subject,
        aliasDid: alias,
        evidence: doc,
        recordId,
      })
      .onConflictDoUpdate({
        target: [
          schema.remoteIdentityLinks.peerId,
          schema.remoteIdentityLinks.subjectDid,
          schema.remoteIdentityLinks.aliasDid,
        ],
        set: { evidence: doc, recordId, issuer },
      });
    kept++;
  }

  // Anything this partner used to assert for this subject and no longer does.
  // An assertion that stopped being made has stopped being true.
  const keep = aliases.filter(
    (a): a is string => typeof a === 'string' && proven.has(a),
  );
  const stale = await db
    .select({ id: schema.remoteIdentityLinks.id, alias: schema.remoteIdentityLinks.aliasDid })
    .from(schema.remoteIdentityLinks)
    .where(
      and(
        eq(schema.remoteIdentityLinks.peerId, peerId),
        eq(schema.remoteIdentityLinks.subjectDid, subject),
      ),
    );
  const drop = stale.filter((r) => !keep.includes(r.alias)).map((r) => r.id);
  if (drop.length) {
    await db
      .delete(schema.remoteIdentityLinks)
      .where(inArray(schema.remoteIdentityLinks.id, drop));
  }

  return kept;
}

/**
 * Every identifier that is the same person as this one.
 *
 * Walks the links in both directions and transitively: A says our member is
 * also X, B says its member X is also Y, so all three are one person. Bounded
 * by `maxHops` because a cycle of mutual assertions is trivial to create and
 * would otherwise be walked forever.
 *
 * Includes the identifier it was asked about, so a caller can use the result
 * as a set without special-casing the empty answer.
 */
export async function aliasesOf(
  did: string,
  maxHops = 3,
): Promise<Set<string>> {
  const seen = new Set<string>([did]);
  let frontier = [did];

  for (let hop = 0; hop < maxHops && frontier.length; hop++) {
    // Succession, in both directions. A rotation is not a different person:
    // the issuer that endorsed both identifiers said so, which is the same
    // authority the endorsement itself rests on.
    //
    // This connects IDENTIFIERS, for the purpose of gathering a body of work.
    // It deliberately does not resurrect the CLAIMS a revocation tore down —
    // those came down because the account that made them might be whoever
    // took the file, and succession says nothing about that.
    const succ = await db
      .select({
        did: schema.revokedIdentities.did,
        succeededBy: schema.revokedIdentities.succeededBy,
      })
      .from(schema.revokedIdentities)
      .where(inArray(schema.revokedIdentities.did, frontier));
    const preceded = await db
      .select({
        did: schema.revokedIdentities.did,
        succeededBy: schema.revokedIdentities.succeededBy,
      })
      .from(schema.revokedIdentities)
      .where(inArray(schema.revokedIdentities.succeededBy, frontier));

    const rows = await db
      .select({
        subjectDid: schema.remoteIdentityLinks.subjectDid,
        aliasDid: schema.remoteIdentityLinks.aliasDid,
      })
      .from(schema.remoteIdentityLinks)
      .where(
        // Either end: the relation is symmetric even though the assertion is
        // one-directional. "Our member is also X" and "we are the instance X
        // came from" describe the same person.
        inArray(schema.remoteIdentityLinks.subjectDid, frontier),
      );
    const back = await db
      .select({
        subjectDid: schema.remoteIdentityLinks.subjectDid,
        aliasDid: schema.remoteIdentityLinks.aliasDid,
      })
      .from(schema.remoteIdentityLinks)
      .where(inArray(schema.remoteIdentityLinks.aliasDid, frontier));

    const next: string[] = [];
    const add = (d: string | null) => {
      if (d && !seen.has(d)) {
        seen.add(d);
        next.push(d);
      }
    };
    for (const r of [...rows, ...back]) {
      add(r.subjectDid);
      add(r.aliasDid);
    }
    for (const r of [...succ, ...preceded]) {
      add(r.did);
      add(r.succeededBy);
    }
    frontier = next;
  }

  return seen;
}

/**
 * Every identifier one of OUR members answers to, anywhere.
 *
 * Starts from what we know first-hand — their local identifier, and the ones
 * they proved to us — then walks the partners' assertions outward from all of
 * them. Our own links are not in the alias graph: that table holds what other
 * instances asserted, and we are not a partner to ourselves.
 */
export async function identitiesOfUser(userId: string): Promise<Set<string>> {
  const mine = await db
    .select({ subjectDid: schema.federatedIdentities.subjectDid })
    .from(schema.federatedIdentities)
    .where(
      and(
        eq(schema.federatedIdentities.localUserId, userId),
        eq(schema.federatedIdentities.status, 'verified'),
      ),
    );

  // Every key this member has ever held here, not only the live one. A
  // rotation retires an identifier; it does not un-write the work published
  // under it, and a member who rotates must not watch their own catalogue stop
  // being theirs.
  const held = await db
    .select({ did: schema.userSigningKeys.did })
    .from(schema.userSigningKeys)
    .where(eq(schema.userSigningKeys.userId, userId));

  const roots = [
    ...(held.length ? held.map((r) => r.did) : [await ensureUserDid(userId)]),
    ...mine.map((r) => r.subjectDid).filter((d): d is string => !!d),
  ];

  const all = new Set<string>(roots);
  for (const root of roots) {
    for (const d of await aliasesOf(root)) all.add(d);
  }
  return all;
}

// ─────────────────────────────────────────────────────────────────────────────
// Withdrawing an identifier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "That key is no longer our member", published so it can travel.
 *
 * The recourse a member has when their exported identity file gets out.
 * Nothing can un-leak a key — whoever holds it can sign with it forever — so
 * this does not try. It withdraws the instance's endorsement, which is the
 * half that made the key worth anything to anybody else, and it does so as a
 * record: it reconciles, it relays, and it outlives us.
 *
 * Only the issuing instance may revoke. A self-revocation signed by the key
 * itself would look tidier and would be a gift to a thief: they hold the key
 * too, so they could revoke the real member's identifier and lock them out of
 * proving anything. Revocation removes a capability, so the party that granted
 * it is the right one to remove it — and it is the party every reader already
 * trusts about that identifier.
 *
 * AS2 `Undo`, because that is what it is: undoing the endorsement asserted
 * earlier. `trackarr:succeededBy` names the key that took over, so a reader
 * can see a person continued rather than vanished — it transfers nothing.
 */
export function projectRevocation(
  did: string,
  succeededBy: string | null,
  revokedAt: Date,
  issuerDid: string,
): Record<string, unknown> {
  return {
    '@context': CONTEXT,
    type: 'Undo',
    object: did,
    'trackarr:succeededBy': succeededBy,
    published: revokedAt.toISOString(),
    'trackarr:issuer': issuerDid,
    'trackarr:replaces': null,
  };
}

/**
 * Publish a revocation for every key retired here and not yet announced.
 *
 * Once published a revocation is never superseded and never withdrawn. An
 * identifier that stopped being a member does not start again — and a
 * retraction of a retraction would be a way to un-say the one thing a member
 * had to be able to say.
 */
export async function mintRevocations(
  ctx: MintContext,
): Promise<{ minted: number }> {
  const retired = await db
    .select({
      did: schema.userSigningKeys.did,
      succeededBy: schema.userSigningKeys.succeededBy,
      revokedAt: schema.userSigningKeys.revokedAt,
    })
    .from(schema.userSigningKeys)
    .where(isNotNull(schema.userSigningKeys.revokedAt));

  let minted = 0;
  for (const key of retired) {
    const draft = projectRevocation(
      key.did,
      key.succeededBy,
      key.revokedAt!,
      ctx.did,
    );
    const contentHash = fingerprint(draft);

    const [already] = await db
      .select({ id: schema.catalogRecords.id })
      .from(schema.catalogRecords)
      .where(
        and(
          eq(schema.catalogRecords.kind, 'revocation'),
          eq(schema.catalogRecords.contentHash, contentHash),
        ),
      )
      .limit(1);
    if (already) continue;

    const signed = signRecord(draft as never, {
      privateKeyPem: ctx.privateKeyPem,
      did: ctx.did,
    }) as SignedRecord;

    await db
      .insert(schema.catalogRecords)
      .values({
        id: signed.id,
        torrentId: key.did,
        infoHash: null,
        issuer: ctx.did,
        kind: 'revocation',
        body: signed as unknown as Record<string, unknown>,
        contentHash,
      })
      .onConflictDoNothing({ target: schema.catalogRecords.id });
    minted++;
  }

  return { minted };
}

/**
 * Take in a partner's revocation, and act on it.
 *
 * Acting on it is the point, and it is where this differs from every other
 * kind of ingestion: recording that we heard would leave the leaked key still
 * proving things. So everything the identifier was used for comes down —
 * assertions other instances made with it, and any claim a local account
 * proved with it.
 *
 * That last part is deliberately blunt. The local account that proved the old
 * identifier may be the member; it may equally be whoever found their file.
 * There is no way to tell from here, and the member can re-prove with an
 * export only they can now obtain. Leaving the link standing on the chance
 * that it is genuine would mean a revocation changed nothing for the one case
 * it exists to fix.
 *
 * Only the instance that issued the identifier may withdraw it. A partner
 * revoking somebody else's key would otherwise be able to unpick any link in
 * the federation.
 */
export async function ingestRevocation(
  peerId: string,
  recordId: string,
  issuer: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  const did = body.object;
  if (typeof did !== 'string' || !did.startsWith('did:key:')) return false;

  // Recorded against the ISSUER, not against the identifier. A withdrawal is
  // only worth anything from whoever issued the identifier — and since a claim
  // is only ever accepted on a known partner's endorsement, "did the endorser
  // withdraw it?" is both the sufficient question and the exact one.
  //
  // Recorded even when we have never heard of the identifier, which is the case
  // worth being ready for: a leaked file is used by whoever finds it, whenever
  // they find it, and that may be long after its instance gave up on it.
  await db
    .insert(schema.revokedIdentities)
    .values({
      id: randomUUID(),
      did,
      issuer,
      succeededBy: asStr(body['trackarr:succeededBy']),
      recordId,
    })
    .onConflictDoUpdate({
      target: [schema.revokedIdentities.issuer, schema.revokedIdentities.did],
      set: { succeededBy: asStr(body['trackarr:succeededBy']), recordId },
    });

  // Bring down what THIS issuer's endorsement was holding up, and nothing
  // else. Another partner's assertions about the same identifier are that
  // partner's to withdraw.
  await db
    .delete(schema.remoteIdentityLinks)
    .where(
      and(
        eq(schema.remoteIdentityLinks.issuer, issuer),
        eq(schema.remoteIdentityLinks.aliasDid, did),
      ),
    );
  await db
    .delete(schema.remoteIdentityLinks)
    .where(
      and(
        eq(schema.remoteIdentityLinks.issuer, issuer),
        eq(schema.remoteIdentityLinks.subjectDid, did),
      ),
    );

  // A local member proved this identifier on the partner that has now
  // withdrawn it. The link comes down, bluntly: the account that proved it may
  // be the member, and may equally be whoever found their file. There is no
  // way to tell from here, and the member can re-prove from a fresh export.
  // Leaving it standing on the chance it is genuine would mean a withdrawal
  // changed nothing for the one case it exists to fix.
  await db
    .delete(schema.federatedIdentities)
    .where(
      and(
        eq(schema.federatedIdentities.peerId, peerId),
        eq(schema.federatedIdentities.subjectDid, did),
      ),
    );

  return true;
}

/** Whether the instance that endorsed an identifier has since withdrawn it. */
export async function isRevoked(did: string, issuer: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.revokedIdentities.id })
    .from(schema.revokedIdentities)
    .where(
      and(
        eq(schema.revokedIdentities.did, did),
        eq(schema.revokedIdentities.issuer, issuer),
      ),
    )
    .limit(1);
  return !!row;
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.length ? v : null;
}

/**
 * POST /api/me/identity/export — the member takes their identity with them.
 *
 * Returns the member's `did:key`, the private key behind it, and a signed
 * "this is me" document endorsed by this instance. Together those are what
 * another instance needs to recognise the same person, and what nobody else
 * can produce.
 *
 * ## A POST, for a read
 *
 * Because it is not a read. It hands over a private key, and the request that
 * does that should not be something a browser can be tricked into issuing by a
 * link, cache on a proxy, or sit in anybody's history. It is also the moment
 * the key is provisioned for a member who has never published — the one place
 * key material is created for somebody who did not upload anything, and
 * deliberately so: a member asking to leave with their identity needs one.
 *
 * ## What this cannot undo
 *
 * Once exported, the key is out. There is no revocation here and no re-import:
 * a key this server has held can never afterwards become the member's private
 * property, and pretending otherwise by accepting one back would be worse than
 * not offering it. The response says as much, in words, inside the file — the
 * interface that produced it will not be in front of them later; the file will.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import {
  ensureFederationIdentity,
  getPrivateKeyPem,
} from '~~/utils/federation/config';
import { didKeyFromPublicKey } from '~~/utils/federation/did';
import {
  endorseIdentity,
  signIdentity,
  PORTABILITY_NOTE,
} from '~~/utils/federation/identityDoc';
import {
  ensureUserDid,
  getUserPrivateKeyPem,
  hasCustody,
} from '~~/utils/federation/userIdentity';

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  // The strictest bucket available. Handing over key material is not something
  // anyone needs to do in a loop, and a hammered endpoint here is a signal.
  await rateLimit(event, RATE_LIMITS.auth);

  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
    columns: { id: true, username: true },
  });
  if (!me) throw createError({ statusCode: 404, message: 'No such member' });

  // The instance has to be able to endorse, or the export is a key and an
  // unsupported claim. Provisioning the identity does not switch federation
  // on; it only means this instance can sign as itself.
  const config = await ensureFederationIdentity();
  const instancePrivateKeyPem = getPrivateKeyPem(config);
  if (!instancePrivateKeyPem || !config.publicKey) {
    throw createError({
      statusCode: 503,
      message: 'This instance has no signing identity yet',
    });
  }

  const did = await ensureUserDid(me.id);
  const instanceDid = didKeyFromPublicKey(config.publicKey);
  const claim = {
    did,
    username: me.username,
    instanceUrl: config.publicUrl ?? null,
    instanceDid,
  };

  // A member who holds their own key gets the half we are entitled to assert
  // and nothing more. We cannot sign as them — that is what custody means —
  // so their browser adds the subject proof over the same bytes.
  if (await hasCustody(me.id)) {
    return {
      ok: true,
      custody: 'member' as const,
      identity: {
        did,
        /** Endorsed, unsigned by the subject. Incomplete until they sign it. */
        document: endorseIdentity(claim, instancePrivateKeyPem),
        note: PORTABILITY_NOTE,
      },
    };
  }

  const keys = await getUserPrivateKeyPem(me.id);
  if (!keys) {
    throw createError({ statusCode: 500, message: 'Identity unavailable' });
  }

  const document = signIdentity(
    claim,
    {
      subjectPrivateKeyPem: keys.privateKeyPem,
      instancePrivateKeyPem,
    },
  );

  return {
    ok: true,
    custody: 'instance' as const,
    /** Everything below is the file. Keeping it one object keeps it one file. */
    identity: {
      did: keys.did,
      publicKeyPem: keys.publicKeyPem,
      privateKeyPem: keys.privateKeyPem,
      document,
      note: PORTABILITY_NOTE,
    },
  };
});

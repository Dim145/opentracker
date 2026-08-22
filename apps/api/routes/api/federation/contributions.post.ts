/**
 * POST /api/federation/contributions  — inbound, S2S.
 *
 * A partner delivers signed contribution attestations about OUR members it
 * served bytes to (credit model / M4). Each is verified against the sending
 * peer's key and honoured at most once, within the per-member daily cap. Off
 * unless the operator enabled crediting (`federation_credit_enabled`).
 *
 * Gated on the `accounts` channel, like every other economy-touching exchange.
 */
import { verifyInboundS2S } from '~~/utils/federation/inbound';
import { applyContributionAttestation } from '~~/utils/federation/credit';

const MAX_ATTESTATIONS = 500;

export default defineEventHandler(async (event) => {
  // 'accept' direction: crediting a member on a partner's word is authorised by
  // `acceptsFromThem.accounts` (we accept this peer's account assertions), NOT by
  // `sharesWithThem.accounts` (we let this peer read our reputation) — two
  // opposite trust decisions that must not collapse into one flag.
  const { peer, rawBody } = await verifyInboundS2S(event, 'accounts', {
    post: true,
    direction: 'accept',
  });

  let body: unknown;
  try {
    body = JSON.parse(rawBody || '{}');
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid JSON' });
  }
  const attestations = (body as { attestations?: unknown })?.attestations;
  if (!Array.isArray(attestations)) {
    throw createError({ statusCode: 400, message: 'attestations must be an array' });
  }
  if (attestations.length > MAX_ATTESTATIONS) {
    throw createError({ statusCode: 413, message: 'Too many attestations' });
  }

  let applied = 0;
  let creditedBytes = 0;
  for (const record of attestations) {
    const r = await applyContributionAttestation({ record, peer });
    if (r.applied) {
      applied += 1;
      creditedBytes += r.bytes;
    }
  }

  return { received: attestations.length, applied, creditedBytes };
});

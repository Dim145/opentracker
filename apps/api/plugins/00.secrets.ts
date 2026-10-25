/**
 * Boot-time secret validation.
 *
 * `validateRequiredSecrets` existed but was never invoked — defined
 * and dead (audit finding). Wire it into a low-numbered startup
 * plugin so a deployment that forgot a security-critical secret
 * fails fast and loud at boot rather than silently running with a
 * broken auth/crypto surface.
 *
 * We assert the two secrets the Getting Started guide explicitly
 * tells operators to generate (and that have no usable default):
 *   - NUXT_SESSION_SECRET — seals session cookies + channel secrets
 *   - IP_HASH_SECRET       — keys IP fingerprints + the UDP conn-id HMAC
 *
 * DATABASE_URL / REDIS are validated by their own clients (and carry
 * dev defaults), so they're intentionally not listed here.
 */
import { readOptionalSecret, validateRequiredSecrets } from '~~/utils/secrets';

export default defineNitroPlugin(() => {
  try {
    validateRequiredSecrets(['NUXT_SESSION_SECRET', 'IP_HASH_SECRET']);
    // The session refuses a secret under 32 characters, but only when the
    // first session is opened: a short one booted cleanly and then failed every
    // sign-in. Refused here, where the operator is looking.
    if ((readOptionalSecret('NUXT_SESSION_SECRET') ?? '').length < 32) {
      throw new Error('NUXT_SESSION_SECRET must be at least 32 characters (`openssl rand -hex 32`).');
    }
  } catch (err) {
    // Re-throw so the process exits non-zero — a missing security
    // secret must not boot into a half-working state.
    console.error('[Secrets] startup validation failed:', (err as Error).message);
    throw err;
  }
});

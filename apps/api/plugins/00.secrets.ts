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
import { validateRequiredSecrets } from '~~/utils/secrets';

export default defineNitroPlugin(() => {
  try {
    validateRequiredSecrets(['NUXT_SESSION_SECRET', 'IP_HASH_SECRET']);
  } catch (err) {
    // Re-throw so the process exits non-zero — a missing security
    // secret must not boot into a half-working state.
    console.error('[Secrets] startup validation failed:', (err as Error).message);
    throw err;
  }
});

/**
 * Docker secrets, read once and exposed under their plain names.
 *
 * `*_FILE` is how a secret arrives from a Docker or Kubernetes secret mount,
 * and `utils/secrets` reads that form — but only the boot validation went
 * through it. The session, the credential and channel keys, and the login's
 * fake-salt key all read the plain variable, so a deployment using
 * `NUXT_SESSION_SECRET_FILE` passed the validation and then failed at its first
 * session. Materialised here, before any other plugin runs (the file name sorts
 * first), every reader sees the same value.
 */
import { readOptionalSecret } from '~~/utils/secrets';

const FILE_BACKED = [
  'NUXT_SESSION_SECRET',
  'IP_HASH_SECRET',
  'CREDENTIAL_ENCRYPTION_KEY',
  'CREDENTIAL_ENCRYPTION_KEY_PREVIOUS',
  'CHANNEL_ENCRYPTION_KEY',
] as const;

export default defineNitroPlugin(() => {
  for (const key of FILE_BACKED) {
    if (process.env[key] || !process.env[`${key}_FILE`]) continue;
    const value = readOptionalSecret(key);
    if (value) process.env[key] = value;
  }
});

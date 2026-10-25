/**
 * Drives `utils/credentialRewrap`: account secrets still in plaintext, or only
 * under the previous key, re-encrypted under the current one without waiting
 * for their owners to log in. The module says why that matters.
 */
import { rewrapCredentialsTick } from '~~/utils/credentialRewrap';
import { withCronLock } from '~~/utils/cronLock';

const SWEEP_INTERVAL_MS = 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;

export default defineNitroPlugin(() => {
  const run = async () => {
    try {
      await withCronLock('credential_rewrap:lock', 5 * 60, async () => {
        const { processed, rewritten } = await rewrapCredentialsTick();
        if (rewritten > 0) {
          console.log(`[Credentials] re-encrypted ${rewritten} secret(s) over ${processed} account(s)`);
        }
      });
    } catch (err) {
      console.warn('[Credentials] re-encryption sweep failed:', (err as Error).message);
    }
  };

  setTimeout(() => {
    void run();
    setInterval(run, SWEEP_INTERVAL_MS);
  }, FIRST_RUN_DELAY_MS);
});

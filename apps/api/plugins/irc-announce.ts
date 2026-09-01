/**
 * Keeps the announce bot in the state the settings describe.
 *
 * A timer rather than a one-shot connect, because three separate things need
 * the same tick: taking the lease (or renewing it), noticing a configuration
 * change another instance saved, and retrying after a failure. The client
 * itself has no reconnect loop for exactly this reason — one place decides when
 * to try again, and its interval is the backoff.
 *
 * The interval is the lease renewal, not a poll of the settings: at 15 s a
 * 45-second lease survives two missed ticks, which is what makes a garbage
 * collection pause or a slow query a non-event rather than a handover.
 *
 * Nothing here throws. A tick that cannot read Redis or the settings leaves the
 * bot as it was and tries again — an announce channel is a convenience, and it
 * must not be able to take an API instance down with it.
 */
import { LEASE_RENEW_MS, reconcile, shutdownAnnouncer } from '~~/utils/irc/announcer';
import { getIrcEnabled } from '~~/utils/irc/settings';

export default defineNitroPlugin(async (nitro) => {
  // The first look is deliberately quiet: the overwhelmingly common case is an
  // instance with no IRC configured at all, and it should say nothing.
  try {
    if (await getIrcEnabled()) {
      console.log(
        `[IRC] Announce enabled — reconciling every ${LEASE_RENEW_MS / 1000}s`
      );
    }
  } catch {
    // Settings unreadable at boot: the tick will say so if it persists.
  }

  const tick = async () => {
    try {
      await reconcile();
    } catch (err) {
      console.warn('[IRC] reconcile failed:', (err as Error).message);
    }
  };

  void tick();
  const timer = setInterval(tick, LEASE_RENEW_MS);
  timer.unref?.();

  // Release the lease on the way out rather than letting it expire: a rolling
  // restart otherwise leaves the channel unattended for up to a full TTL.
  nitro.hooks.hook('close', async () => {
    clearInterval(timer);
    await shutdownAnnouncer();
  });
});

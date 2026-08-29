/**
 * Tell the relay fleet how to behave.
 *
 * The nodes cannot work this out themselves: a node knows it exists, not
 * how many of itself there are, and the per-node connection ceiling is the
 * target divided by that count. So the API counts the live registrations
 * and publishes the result on a channel every node is listening to.
 *
 * Short interval on purpose. The number that matters most is the one
 * recomputed when the fleet SHRINKS — a node dies, its connections move to
 * the survivors, and the survivors need a raised ceiling before the
 * reconnections arrive, not a minute later.
 *
 * No cron lock, unlike the other periodic plugins here. Two replicas
 * publishing the same computed configuration is harmless — the nodes
 * simply apply the same value twice — and the lock would add a failure
 * mode (a stuck lock stops the fleet adapting) to guard against nothing.
 */
import { broadcastFleetConfig } from '~~/utils/messaging/relay';

const INTERVAL_MS = Number(
  process.env.MESSAGING_FLEET_INTERVAL_MS ?? 15_000
);

export default defineNitroPlugin(() => {
  if (!process.env.MESSAGING_SERVICE_URL) return;

  const tick = async () => {
    try {
      await broadcastFleetConfig();
    } catch (err) {
      // A publish that fails is not an outage: every node keeps the
      // configuration it last had, and its own defaults before that.
      console.warn('[messaging] fleet broadcast failed:', (err as Error).message);
    }
  };

  // Not immediately: at plugin init Valkey is still connecting, and the
  // first tick reliably failed with "Stream isn't writeable". It recovered
  // on the next interval, so the only cost was a warning in the log every
  // boot — but a warning that always fires is one nobody reads when it
  // means something.
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref?.();
  const first = setTimeout(tick, 2_000);
  first.unref?.();
});

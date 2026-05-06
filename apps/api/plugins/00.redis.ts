import { connectRedis } from '~~/utils/server';

/**
 * Wait for Redis to be ready before any other plugin or route runs.
 * The shared client uses `lazyConnect: true` so without this, the first
 * route/plugin to touch Redis would throw "Stream isn't writeable" until
 * the connection finishes setting up.
 *
 * Filename starts with `00.` so Nitro loads it before stats-collector.
 */
export default defineNitroPlugin(async () => {
  await connectRedis();
});

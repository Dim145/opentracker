/**
 * Standalone tracker entrypoint.
 * Runs the BitTorrent tracker (HTTP only) in its own process,
 * separate from the Nuxt frontend and the Nitro API.
 */

import { connectRedis } from './redis';
import { initTracker, stopTracker } from './tracker';

async function main() {
  // Make sure Redis is reachable before we start accepting peer announces.
  await connectRedis();
  initTracker();
}

main().catch((err) => {
  console.error('[Tracker] Fatal error during startup:', err);
  process.exit(1);
});

const shutdown = async (signal: string) => {
  console.log(`[Tracker] Received ${signal}, shutting down...`);
  await stopTracker();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

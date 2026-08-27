import { getSetting, setSetting } from '~~/utils/server';

// Settings keys for Torznab
export const TORZNAB_SETTINGS = {
  ENABLED: 'torznab_enabled',
  RATE_LIMIT_SEARCH: 'torznab_rate_limit_search',
  RATE_LIMIT_DOWNLOAD: 'torznab_rate_limit_download',
  RATE_LIMIT_WINDOW: 'torznab_rate_limit_window',
  ENABLE_LOGGING: 'torznab_enable_logging',
  ALLOWED_CATEGORIES: 'torznab_allowed_categories',
  INCLUDE_FEDERATED: 'torznab_include_federated',
} as const;

const DEFAULTS = {
  enabled: true,
  rateLimitSearch: 30, // requests per window
  rateLimitDownload: 20, // requests per window
  rateLimitWindow: 60, // seconds
  enableLogging: true,
  allowedCategories: [] as string[], // empty = all allowed
  includeFederated: false, // off by default — see the getter for why
};

export async function getTorznabEnabled(): Promise<boolean> {
  // Default on so a fresh install can talk to *arr stacks before the
  // operator visits the settings panel.
  const value = await getSetting(TORZNAB_SETTINGS.ENABLED);
  return value !== 'false';
}

export async function setTorznabEnabled(enabled: boolean): Promise<void> {
  await setSetting(TORZNAB_SETTINGS.ENABLED, enabled ? 'true' : 'false');
}

export async function getTorznabRateLimitSearch(): Promise<number> {
  const value = await getSetting(TORZNAB_SETTINGS.RATE_LIMIT_SEARCH);
  return value ? parseInt(value, 10) : DEFAULTS.rateLimitSearch;
}

export async function setTorznabRateLimitSearch(limit: number): Promise<void> {
  await setSetting(TORZNAB_SETTINGS.RATE_LIMIT_SEARCH, limit.toString());
}

export async function getTorznabRateLimitDownload(): Promise<number> {
  const value = await getSetting(TORZNAB_SETTINGS.RATE_LIMIT_DOWNLOAD);
  return value ? parseInt(value, 10) : DEFAULTS.rateLimitDownload;
}

export async function setTorznabRateLimitDownload(
  limit: number
): Promise<void> {
  await setSetting(TORZNAB_SETTINGS.RATE_LIMIT_DOWNLOAD, limit.toString());
}

export async function getTorznabRateLimitWindow(): Promise<number> {
  const value = await getSetting(TORZNAB_SETTINGS.RATE_LIMIT_WINDOW);
  return value ? parseInt(value, 10) : DEFAULTS.rateLimitWindow;
}

export async function setTorznabRateLimitWindow(window: number): Promise<void> {
  await setSetting(TORZNAB_SETTINGS.RATE_LIMIT_WINDOW, window.toString());
}

export async function getTorznabEnableLogging(): Promise<boolean> {
  const value = await getSetting(TORZNAB_SETTINGS.ENABLE_LOGGING);
  return value !== 'false';
}

export async function setTorznabEnableLogging(enabled: boolean): Promise<void> {
  await setSetting(TORZNAB_SETTINGS.ENABLE_LOGGING, enabled ? 'true' : 'false');
}

export async function getTorznabAllowedCategories(): Promise<string[]> {
  const value = await getSetting(TORZNAB_SETTINGS.ALLOWED_CATEGORIES);
  if (!value) return DEFAULTS.allowedCategories;
  try {
    return JSON.parse(value);
  } catch {
    return DEFAULTS.allowedCategories;
  }
}

export async function setTorznabAllowedCategories(
  categories: string[]
): Promise<void> {
  await setSetting(
    TORZNAB_SETTINGS.ALLOWED_CATEGORIES,
    JSON.stringify(categories)
  );
}

/**
 * Whether the Torznab/RSS feeds fold in federated (mirrored) releases.
 *
 * Off by default, and deliberately. A mirrored release is metadata plus an
 * infohash — no `.torrent` we hold. We can hand out a magnet, which resolves
 * for anything with a reachable swarm, but a release on a partner's PRIVATE
 * swarm is only fetchable by a member of that partner. So for an *arr stack this
 * is honestly useful only for content that is publicly seedable, or once the
 * data-sharing backbone (request/fill, cross-seed, webseed) makes a partner's
 * release retrievable from here. An operator who understands that turns it on;
 * nobody gets un-grabbable results in their automation by default.
 */
export async function getTorznabIncludeFederated(): Promise<boolean> {
  const value = await getSetting(TORZNAB_SETTINGS.INCLUDE_FEDERATED);
  return value === 'true';
}

export async function setTorznabIncludeFederated(enabled: boolean): Promise<void> {
  await setSetting(TORZNAB_SETTINGS.INCLUDE_FEDERATED, enabled ? 'true' : 'false');
}

export async function getTorznabRateLimitOptions(type: 'search' | 'download') {
  const [window, searchLimit, downloadLimit] = await Promise.all([
    getTorznabRateLimitWindow(),
    getTorznabRateLimitSearch(),
    getTorznabRateLimitDownload(),
  ]);

  return {
    windowSec: window,
    maxRequests: type === 'search' ? searchLimit : downloadLimit,
    prefix: type === 'search' ? 'torznab:search' : 'torznab:dl',
    progressive: true,
  };
}

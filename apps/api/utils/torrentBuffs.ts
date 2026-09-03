/**
 * What a torrent actually costs right now — the site-wide bonus event and the
 * torrent's own buff, resolved into one pair of factors.
 *
 * The rule is the same one the Go tracker applies on the announce path
 * (`internal/bonus.Best`): the member gets the better of the two on each axis,
 * never the product. Two implementations of one rule is a drift risk, and the
 * mitigation is that this is the ONLY place the API expresses it — Torznab, the
 * torrent detail route and the listing all call in here rather than each doing
 * their own `Math.min`.
 *
 * If you change the rule, change `apps/tracker/internal/bonus/bonus.go` in the
 * same commit. The tests on both sides assert the same table of cases.
 */

/** Basis points ×100, as stored. */
export interface Multipliers {
  download: number;
  upload: number;
}

export const IDENTITY: Multipliers = { download: 100, upload: 100 };

/** The columns this needs from a torrent row. */
export interface BuffableTorrent {
  downloadMultiplier: number;
  uploadMultiplier: number;
  multipliersUntil: Date | null;
}

/**
 * The torrent's own buff, neutralised when it has lapsed.
 *
 * The announce path gets this from SQL; here it is done in TypeScript because
 * the rows are already in memory and re-reading them to let Postgres do the
 * comparison would be a query for an `if`.
 */
export function torrentMultipliers(
  torrent: BuffableTorrent,
  now: Date = new Date()
): Multipliers {
  const lapsed =
    torrent.multipliersUntil !== null && torrent.multipliersUntil <= now;
  if (lapsed) return IDENTITY;
  return {
    download: torrent.downloadMultiplier,
    upload: torrent.uploadMultiplier,
  };
}

/**
 * The better of two multiplier sets, axis by axis.
 *
 * Download: lower wins (0 is freeleech). Upload: higher wins (200 is double
 * credit). Neither side can make the other worse, so an operator granting a
 * buff never has to check what else is running first.
 */
export function best(a: Multipliers, b: Multipliers): Multipliers {
  return {
    download: Math.min(a.download, b.download),
    upload: Math.max(a.upload, b.upload),
  };
}

/**
 * The pair a consumer should be told about, as plain factors rather than basis
 * points — which is what Torznab's `downloadvolumefactor` /
 * `uploadvolumefactor` want.
 */
export function volumeFactors(
  torrent: BuffableTorrent,
  siteWide: Multipliers,
  now: Date = new Date()
): { downloadVolumeFactor: number; uploadVolumeFactor: number } {
  const m = best(siteWide, torrentMultipliers(torrent, now));
  return {
    downloadVolumeFactor: m.download / 100,
    uploadVolumeFactor: m.upload / 100,
  };
}

/**
 * A short label for the buff a torrent carries on its own, or null when it
 * carries none. Site-wide events are announced elsewhere and are not this
 * function's business — a member seeing "Freeleech" on one torrent among a
 * hundred should be able to trust that it means *this* one.
 */
export function buffLabel(
  torrent: BuffableTorrent,
  now: Date = new Date()
): 'freeleech' | 'silverleech' | 'double-upload' | 'custom' | null {
  const m = torrentMultipliers(torrent, now);
  if (m.download === 100 && m.upload === 100) return null;
  if (m.download === 0 && m.upload === 100) return 'freeleech';
  if (m.download === 50 && m.upload === 100) return 'silverleech';
  if (m.download === 100 && m.upload === 200) return 'double-upload';
  return 'custom';
}

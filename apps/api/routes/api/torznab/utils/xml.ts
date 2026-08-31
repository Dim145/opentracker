/**
 * Torznab XML Response Builders
 * Utilities for building XML responses conforming to Torznab specification
 */

const escapeXml = (str: string): string =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Wrap arbitrary (uploader-controlled) text in a CDATA section safely.
// A literal `]]>` inside the content would otherwise close the section
// early and let the value inject sibling XML (spoofed <enclosure>, feed
// corruption) into the torznab/RSS output consumed by *Arr indexers
// (finding M5). Splitting the terminator into two CDATA sections keeps
// the bytes intact while making them inert.
const cdata = (str: string): string =>
  `<![CDATA[${String(str ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

// ============================================================================
// Torznab Error Response
// ============================================================================
export interface TorznabError {
  code: number;
  description: string;
}

export function buildErrorXml(error: TorznabError): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<error code="${error.code}" description="${escapeXml(error.description)}"/>`;
}

// Error codes per Torznab spec
export const TORZNAB_ERRORS = {
  INCORRECT_CREDENTIALS: {
    code: 100,
    description: 'Incorrect user credentials',
  },
  ACCOUNT_SUSPENDED: { code: 101, description: 'Account suspended' },
  INSUFFICIENT_PRIVILEGES: {
    code: 102,
    description: 'Insufficient privileges',
  },
  MISSING_PARAMETER: { code: 200, description: 'Missing parameter' },
  INCORRECT_PARAMETER: { code: 201, description: 'Incorrect parameter' },
  NO_SUCH_FUNCTION: { code: 300, description: 'No such function' },
  INTERNAL_ERROR: { code: 500, description: 'Internal error' },
  API_DISABLED: { code: 910, description: 'API disabled' },
} as const;

// ============================================================================
// Capabilities Response
// ============================================================================
export interface TorznabCategory {
  id: number;
  name: string;
  subcats?: TorznabCategory[];
}

export interface CapsConfig {
  serverVersion: string;
  serverTitle: string;
  maxLimit: number;
  defaultLimit: number;
  categories: TorznabCategory[];
}

export function buildCapsXml(config: CapsConfig): string {
  const buildSubcats = (subcats: TorznabCategory[] = []): string =>
    subcats
      .map((s) => `      <subcat id="${s.id}" name="${escapeXml(s.name)}"/>`)
      .join('\n');

  const buildCategories = (cats: TorznabCategory[]): string =>
    cats
      .map((c) => {
        const subcatsXml = c.subcats?.length
          ? `\n${buildSubcats(c.subcats)}\n    `
          : '';
        return `    <category id="${c.id}" name="${escapeXml(c.name)}">${subcatsXml}</category>`;
      })
      .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server version="${escapeXml(config.serverVersion)}" title="${escapeXml(config.serverTitle)}"/>
  <limits max="${config.maxLimit}" default="${config.defaultLimit}"/>
  <registration available="no" open="no"/>

  <searching>
    <search available="yes" supportedParams="q,imdbid,tmdbid,tvdbid"/>
    <tv-search available="yes" supportedParams="q,season,ep,tvdbid,imdbid,tmdbid"/>
    <movie-search available="yes" supportedParams="q,imdbid,tmdbid"/>
    <audio-search available="no"/>
    <book-search available="no"/>
  </searching>

  <categories>
${buildCategories(config.categories)}
  </categories>
</caps>`;
}

// ============================================================================
// Search Response (RSS with Torznab extensions)
// ============================================================================
export interface TorznabItem {
  title: string;
  guid: string;
  link: string;
  commentsUrl: string;
  pubDate: Date;
  size: number;
  description?: string;
  categoryName?: string;
  categoryId: number;
  seeders: number;
  leechers: number;
  grabs: number;
  downloadUrl: string;
  downloadVolumeFactor?: number; // 0 = freeleech, 1 = normal
  uploadVolumeFactor?: number; // 1 = normal, 2 = double upload
  /**
   * The v1 infohash, hex. Spec'd as an enumerated Torznab attribute and read
   * by Prowlarr to match a release against a client's existing torrents
   * without downloading the .torrent first. We already have it — it is the
   * `guid` of every local item — so emitting it costs nothing and saves the
   * consumer a round trip.
   */
  infoHash?: string;
  /**
   * What the site will require of this release once it is grabbed.
   *
   * Both are spec'd for exactly this: a tracker stating its seeding
   * requirements per torrent so the client can honour them by itself. We
   * enforce a minimum ratio (announce-time gate) and a hit-and-run seed time
   * (a sanction, after the fact) and until now told nobody in advance — the
   * member found out when the gate closed or the sanction landed. The same
   * two numbers, sent through the channel Sonarr / Radarr already read, turn
   * hit-and-run from a trap into a contract.
   *
   * Omitted (rather than sent as 0) when the site does not impose them, since
   * a stated 0 and an absent value are the same instruction and the shorter
   * one cannot be misread as "seed for zero seconds".
   */
  minimumRatio?: number;
  /** Seconds. */
  minimumSeedTime?: number;
  // Torznab predefined external-id attributes (issue #47). Sonarr /
  // Radarr / Lidarr use these to match a release against their own
  // library. We pass them through as-is — IMDb keeps its `tt` prefix,
  // TMDb / TVDB are bare digits.
  imdbId?: string;
  tmdbId?: string;
  tvdbId?: string;
}

export interface TorznabFeed {
  title: string;
  description: string;
  link: string;
  selfUrl: string;
  items: TorznabItem[];
}

export function buildSearchXml(feed: TorznabFeed): string {
  const items = feed.items
    .map((item) => {
      const attrs = [
        `      <torznab:attr name="category" value="${item.categoryId}"/>`,
        `      <torznab:attr name="size" value="${item.size}"/>`,
        `      <torznab:attr name="seeders" value="${item.seeders}"/>`,
        `      <torznab:attr name="peers" value="${item.leechers}"/>`,
        `      <torznab:attr name="grabs" value="${item.grabs}"/>`,
        `      <torznab:attr name="downloadvolumefactor" value="${item.downloadVolumeFactor ?? 1}"/>`,
        `      <torznab:attr name="uploadvolumefactor" value="${item.uploadVolumeFactor ?? 1}"/>`,
      ];

      if (item.infoHash) {
        attrs.push(
          `      <torznab:attr name="infohash" value="${escapeXml(item.infoHash)}"/>`
        );
      }
      // `> 0` and not `!= null`: a site with no ratio requirement stores 0,
      // and forwarding that would read as a requirement of zero rather than
      // as the absence of one.
      if (item.minimumRatio && item.minimumRatio > 0) {
        attrs.push(
          `      <torznab:attr name="minimumratio" value="${item.minimumRatio}"/>`
        );
      }
      if (item.minimumSeedTime && item.minimumSeedTime > 0) {
        attrs.push(
          `      <torznab:attr name="minimumseedtime" value="${item.minimumSeedTime}"/>`
        );
      }

      if (item.imdbId) {
        attrs.push(
          `      <torznab:attr name="imdbid" value="${escapeXml(item.imdbId)}"/>`
        );
      }
      if (item.tmdbId) {
        attrs.push(
          `      <torznab:attr name="tmdbid" value="${escapeXml(item.tmdbId)}"/>`
        );
      }
      if (item.tvdbId) {
        attrs.push(
          `      <torznab:attr name="tvdbid" value="${escapeXml(item.tvdbId)}"/>`
        );
      }

      return `    <item>
      <title>${escapeXml(item.title)}</title>
      <guid>${escapeXml(item.guid)}</guid>
      <link>${escapeXml(item.link)}</link>
      <comments>${escapeXml(item.commentsUrl)}</comments>
      <pubDate>${item.pubDate.toUTCString()}</pubDate>
      <size>${item.size}</size>
      <description>${cdata(item.description ?? '')}</description>
      ${item.categoryName ? `<category>${escapeXml(item.categoryName)}</category>` : ''}
${attrs.join('\n')}
      <enclosure url="${escapeXml(item.downloadUrl)}" length="${item.size}" type="application/x-bittorrent"/>
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <title>${escapeXml(feed.title)}</title>
    <description>${escapeXml(feed.description)}</description>
    <link>${escapeXml(feed.link)}</link>
    <language>en-us</language>
    <atom:link href="${escapeXml(feed.selfUrl)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;
}

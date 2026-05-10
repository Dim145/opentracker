import { db, schema } from '@trackarr/db';
import { getStats } from '~~/utils/server';
import { desc, eq, and, or, isNull, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { requireSessionOrApikey } from '~~/utils/adminAuth';
import { adultCategoryIds } from '~~/utils/adultContent';

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
});

/**
 * GET /api/rss/latest
 * RSS feed for latest torrents. Private tracker — requires either a
 * browser session or `?apikey=<passkey>` for *Arr-style readers.
 * Non-accepted rows (pending / changes_requested / rejected) are
 * excluded so the feed never exposes content awaiting moderation or
 * already turned down.
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireSessionOrApikey(event);
  const query = querySchema.parse(getQuery(event));

  // Build the where so feeds for users who haven't opted into XXX
  // skip those entries entirely. requireSessionOrApikey already
  // surfaces showAdultContent on the user record.
  const conditions = [
    eq(schema.torrents.isActive, true),
    eq(schema.torrents.moderationStatus, 'accepted'),
  ];
  if (!user.showAdultContent) {
    const adultIds = await adultCategoryIds();
    if (adultIds.length > 0) {
      conditions.push(
        or(
          isNull(schema.torrents.categoryId),
          notInArray(schema.torrents.categoryId, adultIds)
        )!
      );
    }
  }

  const torrents = await db.query.torrents.findMany({
    where: and(...conditions),
    with: {
      category: true,
      uploader: {
        columns: { username: true },
      },
    },
    orderBy: [desc(schema.torrents.createdAt)],
    limit: query.limit,
  });

  // Get stats from Redis
  const enriched = await Promise.all(
    torrents.map(async (t) => ({
      ...t,
      stats: await getStats(t.infoHash),
    }))
  );

  // Build RSS XML
  const baseUrl = getRequestURL(event).origin;
  const rss = buildRSSFeed({
    title: 'Trackarr - Latest Torrents',
    link: baseUrl,
    description: 'Latest torrent uploads on Trackarr',
    items: enriched.map((t) => ({
      title: t.name,
      link: `${baseUrl}/torrents/${t.infoHash}`,
      description: buildItemDescription(t),
      category: t.category?.name,
      pubDate: new Date(t.createdAt).toUTCString(),
      guid: t.infoHash,
    })),
  });

  setHeader(event, 'Content-Type', 'application/rss+xml; charset=utf-8');
  setHeader(event, 'Cache-Control', 'public, max-age=300'); // 5min cache
  return rss;
});

interface RSSItem {
  title: string;
  link: string;
  description: string;
  category?: string;
  pubDate: string;
  guid: string;
}

interface RSSFeed {
  title: string;
  link: string;
  description: string;
  items: RSSItem[];
}

function buildRSSFeed(feed: RSSFeed): string {
  // `&` MUST run first — otherwise the &amp; we just emitted gets
  // rewritten into &amp;amp; on the next pass. The other four chars
  // are independent. ES2021 `replaceAll` makes the literal-string
  // intent explicit (no global-regex / per-char-class confusion).
  const escapeXml = (str: string) =>
    str
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

  const items = feed.items
    .map(
      (item) => `
    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <description><![CDATA[${item.description}]]></description>
      ${item.category ? `<category>${escapeXml(item.category)}</category>` : ''}
      <pubDate>${item.pubDate}</pubDate>
      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>
    </item>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(feed.title)}</title>
    <link>${escapeXml(feed.link)}</link>
    <description>${escapeXml(feed.description)}</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(feed.link)}/api/rss/latest" rel="self" type="application/rss+xml"/>${items}
  </channel>
</rss>`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function buildItemDescription(torrent: any): string {
  const parts = [
    `Size: ${formatBytes(torrent.size)}`,
    `Seeders: ${torrent.stats.seeders}`,
    `Leechers: ${torrent.stats.leechers}`,
    `Completed: ${torrent.stats.completed}`,
  ];

  if (torrent.uploader?.username) {
    parts.push(`Uploader: ${torrent.uploader.username}`);
  }

  if (torrent.description) {
    parts.push('', torrent.description.slice(0, 500));
  }

  return parts.join('\n');
}

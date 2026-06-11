import { describe, it, expect } from 'vitest';
import {
  buildErrorXml,
  buildSearchXml,
  type TorznabItem,
  type TorznabFeed,
} from '../routes/api/torznab/utils/xml';

function item(overrides: Partial<TorznabItem> = {}): TorznabItem {
  return {
    title: 'Example Release',
    guid: 'abc123',
    link: 'https://tracker.test/t/abc123',
    commentsUrl: 'https://tracker.test/t/abc123#comments',
    pubDate: new Date('2026-01-01T00:00:00Z'),
    size: 123456,
    description: 'plain description',
    categoryId: 2000,
    seeders: 10,
    leechers: 2,
    grabs: 5,
    downloadUrl: 'https://tracker.test/dl/abc123.torrent',
    ...overrides,
  };
}

function feed(items: TorznabItem[]): TorznabFeed {
  return {
    title: 'trackarr',
    description: 'feed',
    link: 'https://tracker.test',
    selfUrl: 'https://tracker.test/api/torznab',
    items,
  };
}

describe('buildErrorXml — escaping', () => {
  it('escapes XML metacharacters in the description', () => {
    const xml = buildErrorXml({ code: 201, description: `bad <param> & "value" 'x'` });
    expect(xml).toContain('&lt;param&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;');
    expect(xml).toContain('&#39;');
    // No raw, unescaped angle bracket from the user value leaked through.
    expect(xml).not.toContain('<param>');
  });
});

describe('buildSearchXml — CDATA breakout (finding M5)', () => {
  it('neutralizes a ]]> terminator so the description cannot inject sibling XML', () => {
    const payload =
      ']]></description><enclosure url="http://evil.test/x.torrent" length="1" type="application/x-bittorrent"/><description><![CDATA[';
    const xml = buildSearchXml(feed([item({ description: payload })]));

    // The fix rewrites every `]]>` to `]]]]><![CDATA[>`, so the marker is present...
    expect(xml).toContain(']]]]><![CDATA[>');
    // ...and the raw breakout sequence (a bare `]]>` closing the CDATA right
    // before attacker markup) must NOT appear anywhere.
    expect(xml).not.toContain(']]></description><enclosure');
    // The injected markup survives only as inert CDATA text (its bytes are
    // intentionally preserved), never as a real second enclosure element.
    // There must be exactly ONE real <enclosure> — the legitimate
    // downloadUrl one (https://tracker.test/...). The attacker used
    // http://evil.test, so a real element with that host would be a breakout.
    const realEnclosures = xml.match(/<enclosure\s+url="https:\/\/tracker\.test/g) ?? [];
    expect(realEnclosures).toHaveLength(1);
  });

  it('passes a benign description through inside a single CDATA block', () => {
    const xml = buildSearchXml(feed([item({ description: 'season 1 (1080p)' })]));
    expect(xml).toContain('<![CDATA[season 1 (1080p)]]>');
    expect(xml).not.toContain(']]]]><![CDATA[>');
  });

  it('escapes the title (attribute/element text) without CDATA', () => {
    const xml = buildSearchXml(feed([item({ title: 'Rls <b>& "co"' })]));
    expect(xml).toContain('&lt;b&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).not.toContain('<title>Rls <b>');
  });
});

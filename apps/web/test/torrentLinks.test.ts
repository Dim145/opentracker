import { describe, it, expect } from 'vitest';
import { torrentHashesIn } from '../app/utils/torrentLinks';

const HASH = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

describe('torrentHashesIn', () => {
  it('finds a bare path', () => {
    expect(torrentHashesIn(`look at /torrents/${HASH} please`)).toEqual([HASH]);
  });

  it('finds a full URL, because that is how people paste', () => {
    expect(torrentHashesIn(`https://tracker.example.com/torrents/${HASH}`)).toEqual([HASH]);
  });

  it('lowercases, so the same torrent is not fetched twice', () => {
    expect(torrentHashesIn(`/torrents/${HASH.toUpperCase()}`)).toEqual([HASH]);
  });

  it('deduplicates', () => {
    expect(torrentHashesIn(`/torrents/${HASH} and again /torrents/${HASH}`)).toEqual([HASH]);
  });

  it('keeps the order it found them in', () => {
    expect(torrentHashesIn(`/torrents/${OTHER} then /torrents/${HASH}`)).toEqual([OTHER, HASH]);
  });

  // A message full of links must not become a message full of requests.
  it('caps how many it will resolve', () => {
    const many = ['a', 'b', 'c', 'd', 'e']
      .map((c) => `/torrents/${c.repeat(40)}`)
      .join(' ');
    expect(torrentHashesIn(many)).toHaveLength(3);
  });

  // Anything looser starts matching commit SHAs, and every false positive
  // costs the reader a request that 404s.
  it('ignores anything that is not a 40-hex infohash', () => {
    expect(torrentHashesIn('/torrents/not-a-hash')).toEqual([]);
    expect(torrentHashesIn(`/torrents/${'a'.repeat(39)}`)).toEqual([]);
    expect(torrentHashesIn(`/torrents/${'z'.repeat(40)}`)).toEqual([]);
  });

  it('ignores a path that only looks similar', () => {
    expect(torrentHashesIn(`/torrent/${HASH}`)).toEqual([]);
    expect(torrentHashesIn(`/other/torrents/${HASH}`)).toEqual([]);
  });

  it('handles nothing at all', () => {
    expect(torrentHashesIn(null)).toEqual([]);
    expect(torrentHashesIn('')).toEqual([]);
  });
});

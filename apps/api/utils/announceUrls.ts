/**
 * The announce URLs a member's `.torrent` carries — one builder for both
 * download routes, so a file grabbed through Torznab and one clicked on the
 * site advertise the same trackers. Torznab used to write `announce` alone, so a
 * torrent fetched by an *arr app never got the UDP tier even where it was served.
 */

/**
 * Whether the tracker serves BEP 15, read exactly as the tracker reads it
 * (`getEnvDefault("TRACKER_UDP_ENABLED", "true") == "true"` in
 * `apps/tracker/internal/config`): unset or empty means on, and anything but
 * the literal `true` means off. The API, the public stats and the `.torrent`
 * files only agree with the listener if the deployment hands this process the
 * same variable — the packaged Compose file and Helm chart now do.
 */
export function trackerUdpEnabled(): boolean {
  const v = process.env.TRACKER_UDP_ENABLED;
  return (v ? v : 'true') === 'true';
}

export interface AnnounceConfig {
  /** `NUXT_PUBLIC_TRACKER_HTTP_URL`. */
  httpUrl: string;
  /** `NUXT_PUBLIC_TRACKER_UDP_URL`, possibly empty. */
  udpUrl: string;
  /** `trackerUdpEnabled()`. */
  udpEnabled: boolean;
}

/**
 * `announce` and the BEP 12 `announce-list` for one member.
 *
 * HTTP (always present): `…/announce?passkey=…` — the canonical form every BT
 * client understands.
 *
 * UDP (BEP 15), only when the tracker serves it AND a URL is configured: the
 * passkey goes in as a trailing path segment — `udp://host:6969/announce/PASSKEY`
 * — because BEP 15 has no passkey field and the UDP tracker pulls it out of the
 * BEP 41 URL_DATA option that libtorrent, qBittorrent and Transmission send for
 * the path. Advertising a UDP endpoint nobody serves is worse than leaving it
 * out: a client that prefers UDP backs off the working HTTP tracker every
 * announce, which breaks ratio in subtle ways.
 *
 * HTTP and UDP sit in their own tiers so a client announces to both rather than
 * treating one as the other's fallback — how every multi-protocol tracker we
 * cribbed from (opentrackr, AnimeBytes…) advertises itself.
 */
export function personalAnnounceUrls(
  passkey: string,
  cfg: AnnounceConfig,
): { announce: string; tiers: string[][] } {
  const httpUrl = new URL(cfg.httpUrl);
  httpUrl.searchParams.set('passkey', passkey);
  const announce = httpUrl.toString();
  const tiers: string[][] = [[announce]];

  if (cfg.udpEnabled && cfg.udpUrl) {
    try {
      const udpUrl = new URL(cfg.udpUrl);
      // A trailing slash on the configured path would double the separator.
      const basePath = udpUrl.pathname.replace(/\/+$/, '') || '/announce';
      udpUrl.pathname = `${basePath}/${passkey}`;
      tiers.push([udpUrl.toString()]);
    } catch {
      // A misconfigured UDP URL must not cost the member their download.
      console.warn('[download] invalid trackerUdpUrl, skipping UDP announce-list entry:', cfg.udpUrl);
    }
  }

  return { announce, tiers };
}

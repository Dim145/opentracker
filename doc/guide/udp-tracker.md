# UDP Tracker (BEP 15)

The Go tracker speaks **two protocols** off the same backend: HTTP (BEP 3) on
`8080/tcp` and UDP (BEP 15) on `6969/udp`. Both share the wire-agnostic
announce processor — passkey resolution, ratio gate, dedup, deltas with
bonus-event multipliers, peer upsert, HnR / seed-time bookkeeping all live
in exactly one place.

## Why UDP

A UDP announce is roughly **6×–8× cheaper** on the wire than the HTTP
equivalent (≈100 bytes vs 600–1500), there's no TCP setup, no headers, no
bencode round-trip, and the response is a tight binary peer list. That's
why every public tracker (`opentrackr`, `openbittorrent`, …) prefers UDP and
why every modern BT client (qBittorrent, Transmission, Deluge, libtorrent,
µTorrent, BiglyBT) talks it natively.

When the homepage's **Protocol health** tile shows `UDP — Online`, peers
will pick this transport whenever a tier of the announce-list advertises it.

## Protocol summary

BEP 15 is a stateless, two-step handshake over UDP:

```
1. CONNECT        client ──── magic + action(0) + tx_id ────► server
                  client ◄──── action(0) + tx_id + connection_id ─── server

2. ANNOUNCE       client ──── connection_id + action(1) + tx_id +
                              info_hash + peer_id + counters + ... ────► server
                  client ◄──── action(1) + tx_id + interval + counts +
                              compact peer list (6B/peer) ─── server
```

The `connection_id` is the only piece of cross-request state. Trackarr
issues it as `HMAC-SHA256(IP_HASH_SECRET, ip || epoch_minute)` folded to
8 bytes, and validates it against the current minute and the previous one
— so the worst-case validity window is just under 2 minutes (per BEP 15)
and the server keeps **no per-id memory**.

The same `IP_HASH_SECRET` keys both the connection-id HMAC and the existing
IP-hash fingerprint, so adding UDP didn't add a new required env var.

## The passkey problem (and how Trackarr solves it)

Trackarr is a **private** tracker — every announce must carry a passkey.
BEP 15's announce body has no field for one. Two approaches in the wild:

- Stuff the passkey into the 20-byte `peer_id` field (fragile, clients
  control their own peer_id).
- Use the **BEP 41 URL_DATA option** — clients append the path and query
  of the original tracker URL as a TLV trailer to the announce packet.

Trackarr uses BEP 41. When a `.torrent` advertises
`udp://tracker.example.com:6969/announce/PASSKEY`, libtorrent /
qBittorrent / Transmission / Deluge transparently send the
`/announce/PASSKEY` segment as URL_DATA. The server parses it and pulls
the passkey out.

Both URL shapes are accepted:

| URL form                                                         | Where the passkey is read from |
| ---------------------------------------------------------------- | ----------------------------- |
| `udp://host:6969/announce/PASSKEY` *(recommended)*               | Trailing path segment         |
| `udp://host:6969/announce?passkey=PASSKEY`                       | Query parameter               |
| `udp://host:6969/announce` *(no passkey)*                        | Rejected — `Passkey required` |

The literal tokens `announce` and `scrape` are **never** treated as a
passkey, so a bare `/announce` URL never accidentally authorises.

## .torrent files include UDP automatically

When a user clicks **Download** on `/torrents/[hash]`, the API personalises
the file's announce list:

- **Tier 0** — `http://host/announce?passkey=…` *(always)*
- **Tier 1** — `udp://host:6969/announce/…` *(only when `TRACKER_UDP_ENABLED`
  is true on the tracker AND `NUXT_PUBLIC_TRACKER_UDP_URL` is set)*

Each tier is a separate BEP 12 list, which means clients try them
**independently** rather than treating UDP as a fallback for HTTP. If you
disable UDP at any point, the next `.torrent` download stops advertising
it — clients won't waste announces on a dead endpoint.

## Operator configuration

```bash
# Tracker (apps/tracker)
TRACKER_UDP_PORT=6969          # Default. The de-facto BEP 15 port.
TRACKER_UDP_ENABLED=true       # Default. Set to "false" to disable the listener.

# Web / API (NUXT_PUBLIC_*) — surfaced in /api/runtime-config and
# /api/torrents/[hash]/download
NUXT_PUBLIC_TRACKER_UDP_URL=udp://tracker.example.com:6969/announce
```

`TRACKER_UDP_ENABLED` is read by **three** processes:

1. `apps/tracker` — controls the listener.
2. `apps/api` — `/api/stats/public` reports the matrix; the homepage tile
   reflects reality.
3. `apps/api` — `/api/torrents/[hash]/download` only adds the UDP tier
   when this is true.

So flipping the env var in one place keeps all three honest.

### Reverse-proxy reality

UDP can't go through Caddy (no L4 reverse-proxy in the default stack), so
the tracker container binds `6969/udp` directly on the host. Both compose
files (`docker-compose.local.yml`, `docker-compose.prod.yml`) already map
the port:

```yaml
ports:
  - "6969:6969/udp"
```

If you front the host with a firewall, **explicitly allow UDP/6969**;
otherwise clients just see timeouts and silently fall back to HTTP.

### IP plumbing

UDP gives you the source address straight off the socket; there's no
`X-Forwarded-For` to consider. The 4-byte IPv4 field BEP 15 lets clients
fill in is **deliberately ignored** — trusting it would let any peer
register on behalf of arbitrary IPv4 addresses (the classic source-spoofing
attack on UDP trackers).

## Observability

Every UDP rejection logs once at `info` (or `warn` for parse failures)
with enough context for an operator to diagnose:

```
INFO udp connection_id rejected   remote=203.0.113.42:54321
INFO udp announce missing passkey remote=203.0.113.42:54321
                                   url_data=/announce
                                   hint=client must use udp://host:port/announce/PASSKEY or ?passkey=PASSKEY
INFO udp announce rejected         remote=203.0.113.42:54321
                                   reason=Invalid passkey
WARN udp announce parse failed     remote=203.0.113.42:54321 size=42 err=…
```

Successful announces only log at `debug`. To turn that on, set
`TRACKER_DEBUG=true` on the tracker container.

The tracker's slog handler **redacts any 32+-char hex run** before
emitting, so a passkey that lands in `url_data` won't end up in the logs
verbatim.

## Anti-DDoS guarantees

UDP trackers are a classic reflection target — a small spoofed announce
can elicit a much larger response. Trackarr's mitigations:

| Risk                              | Mitigation                                                    |
| --------------------------------- | ------------------------------------------------------------- |
| Spoofed-source connect packets    | `connection_id` is HMAC-bound to the source IP                |
| Replay across vantage points      | Connection IDs validate only against the issuing IP           |
| Long-lived hijacked connection IDs | ~2-minute validity window (current + previous epoch minute)   |
| Reflection amplification          | Connect-then-announce handshake — no announce without a valid id |
| Bot scanners                      | `info`-level logging with remote address; correlate with rate-limit metrics |

The handshake means a spoofed-source packet can never elicit a peer-list
response — only a 16-byte connect reply, which is **smaller** than the
incoming packet, so reflection nets the attacker a negative gain.

## Disabling UDP

```bash
# In your .env / compose env
TRACKER_UDP_ENABLED=false
```

Restart the tracker container. The listener will stay down, the homepage
tile will read `UDP — Offline`, the next `.torrent` download won't include
a UDP tier, and clients that were already announcing on UDP will time out
once and fall back to HTTP.

## Troubleshooting

### qBittorrent: "Tracker error — tracker sent a failure message"

Most common cause: the URL has no passkey. Use the `.torrent` file
generated from the site (which already bakes the passkey path), or
manually rewrite the URL to
`udp://host:6969/announce/<your-passkey>`.

The tracker logs the rejection with the URL data echoed back, so
`docker compose logs tracker | grep "udp announce"` gives you the
remote IP and the URL data the client actually sent.

### "Connection ID expired"

The client cached a `connection_id` from more than ~2 minutes ago. This
isn't an error in steady state — clients re-handshake transparently —
but if you see it in bursts, check that the system clock on the tracker
host hasn't jumped (the bucket window is wall-clock based).

### Announces succeed on HTTP but not UDP

Verify in this order:

1. **Listener is up** — `docker compose logs tracker` shows
   `tracker udp listening addr=:6969`.
2. **Port is open** — `nc -uvz host 6969` from another machine.
3. **`.torrent` advertises UDP** — `bencode-cli decode` the file and
   look for the `announce-list`. If only HTTP is there, redownload after
   confirming `TRACKER_UDP_ENABLED=true` and `NUXT_PUBLIC_TRACKER_UDP_URL`
   are both set on the API container.
4. **Firewall** — corporate / ISP NAT sometimes drops outbound UDP/6969.
   Test from a different network.

## Implementation reference

| Concern                                  | File                                              |
| ---------------------------------------- | ------------------------------------------------- |
| Listener / dispatch / packet pool        | `apps/tracker/internal/udp/server.go`             |
| BEP 15 wire-format parser + BEP 41 walker | `apps/tracker/internal/udp/parse.go`              |
| BEP 15 response encoders                 | `apps/tracker/internal/udp/encode.go`             |
| Stateless connection-id HMAC             | `apps/tracker/internal/udp/connid.go`             |
| Wire-agnostic announce processor (shared with HTTP) | `apps/tracker/internal/server/handler.go` (`Server.ProcessAnnounce`) |
| `.torrent` URL personalisation           | `apps/api/routes/api/torrents/[hash]/download.get.ts` |
| Protocol matrix surfaced to the UI       | `apps/api/routes/api/stats/public.get.ts`         |

The package ships **17 unit tests** covering the parser shapes, BEP 41
fragmentation, connection-id validity windows, the IPv4-in-16 stability
trick (so a peer that announces from `1.2.3.4` and again from
`::ffff:1.2.3.4` keeps the same id), and the anti-spoofing guard.

/**
 * The site's one announce bot: what holds the connection, and what decides
 * whether a release is announced.
 *
 * ## One connection for the whole fleet
 *
 * Every other periodic job here takes a Redis lock per tick and does its sweep.
 * A connection cannot work that way — it is held, not performed — so this takes
 * the same lock as a LEASE: whichever instance wins connects and renews every
 * fifteen seconds; the others do nothing. If the leader dies, the key expires
 * and the next instance to tick takes over.
 *
 * The reason this matters is not efficiency. Three instances, three
 * connections, three bots in the channel, and every release announced three
 * times — to autobrr, which would then grab it three times.
 *
 * ## Announcing is not on the upload's path
 *
 * `announceRelease` returns immediately. It resolves what it needs from the
 * database, hands a line to the queue and stops; a channel that is down, a
 * server that is throttling, an operator who mistyped the host — none of it can
 * slow down or fail an upload. The failure mode of an announce is a missing
 * line, and that has to stay true.
 *
 * ## What is never announced
 *
 * A release that is not accepted and live; an adult release unless the operator
 * turned that on; the name of a member who uploads anonymously. The first is
 * what the channel is for, the second is the operator's decision, and the third
 * is the same rule the catalogue, the feeds and the federated catalogue already
 * apply — this is simply one more surface that must not be the exception.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { redis } from '~~/utils/server';
import { adultCategoryIds } from '~~/utils/adultContent';
import { concealsUploader } from '~~/utils/uploaderVisibility';
import { IDENTITY, volumeFactors } from '~~/utils/torrentBuffs';
import { getActiveSnapshot } from '~~/utils/bonusEvents';
import { getFederationConfig } from '~~/utils/federation/config';
import { IrcClient, type IrcStatus } from './client';
import {
  freeleechPercent,
  humanSize,
  renderAnnounce,
  type AnnounceFields,
} from './format';
import {
  getIrcConfig,
  getIrcEnabled,
  ircConfigReady,
  type IrcAnnounceConfig,
} from './settings';

const LEASE_KEY = 'irc_announce:leader';
/**
 * Where a rendered line is handed to whichever instance holds the connection.
 *
 * Without this the feature worked only on a single-instance deployment, and
 * failed in a way no test would show: `announceRelease` runs in the process that
 * served the upload, and only the LEASE HOLDER has a client — so on three
 * instances roughly two thirds of accepted releases were dropped silently. The
 * fix for announcing three times had produced announcing once in three.
 *
 * Publishing unconditionally, including from the leader itself, keeps one path:
 * every line is rendered where the release was accepted and said where the
 * socket is.
 */
const LINE_CHANNEL = 'irc_announce:line';
const LEASE_TTL_S = 45;
export const LEASE_RENEW_MS = 15_000;

let client: IrcClient | null = null;
let leaseOwner: string | null = null;
let subscriber: ReturnType<typeof redis.duplicate> | null = null;
let activeSignature = '';
let lastError: string | null = null;
/** Kept for the admin console when this instance is not the leader. */
let lastStatus: IrcStatus | null = null;

/** Changing any of these means the connection has to be rebuilt. */
function signatureOf(config: IrcAnnounceConfig): string {
  return JSON.stringify([
    config.host,
    config.port,
    config.tls,
    config.nick,
    config.serverPassword,
    config.saslUser,
    config.saslPassword,
    config.perform,
    config.channel,
    config.channelKey,
  ]);
}

/**
 * This process's lease identity, minted once at load.
 *
 * `pid:hostname` was not enough: `HOSTNAME` is provided by the container
 * runtime rather than by anything here, and the `'local'` fallback plus two
 * containers running the API as pid 1 gives two instances the SAME token — at
 * which point the compare-and-renew below succeeds against the other one's key
 * and both hold the lease. Every other lock in this codebase uses
 * `pid:Date.now()`; this adds a uuid because two containers can start in the
 * same millisecond.
 */
const LEASE_OWNER = `${process.pid}:${Date.now()}:${randomUUID()}`;

function owner(): string {
  return LEASE_OWNER;
}

/**
 * Take or renew the lease.
 *
 * `SET NX` to take it; a compare-and-renew to keep it. The renew is a Lua
 * script because "check the owner then extend" as two commands is the classic
 * way to extend a lock another instance has already taken.
 */
const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('expire', KEYS[1], ARGV[2])
end
return 0
`;

async function holdLease(): Promise<boolean> {
  const me = owner();
  if (leaseOwner === me) {
    const kept = await redis.eval(RENEW_SCRIPT, 1, LEASE_KEY, me, String(LEASE_TTL_S));
    if (kept === 1) return true;
    // Lost it — the process was paused long enough for the key to expire and
    // somebody else took over. Drop the connection rather than run a second bot.
    leaseOwner = null;
    stop('lost the lease');
    return false;
  }
  const taken = await redis.set(LEASE_KEY, me, 'EX', LEASE_TTL_S, 'NX');
  if (taken !== 'OK') return false;
  leaseOwner = me;
  return true;
}

async function releaseLease(): Promise<void> {
  if (leaseOwner !== owner()) return;
  const me = leaseOwner;
  leaseOwner = null;
  try {
    // Same compare-then-act problem in the other direction: only delete a key
    // that is still ours.
    await redis.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`,
      1,
      LEASE_KEY,
      me
    );
  } catch {
    // The lease expires by itself; a failure here costs at most one TTL of
    // nobody announcing.
  }
}

function stop(reason: string): void {
  if (client) {
    lastStatus = client.status();
    client.close(reason);
    client = null;
  }
  activeSignature = '';
}

/**
 * Listen for lines published by the other instances.
 *
 * Started once and left running: a subscriber that came and went with the lease
 * would drop whatever arrived during the handover. Lines that arrive while this
 * instance is not the one holding the connection are dropped here instead —
 * cheap, and it means exactly one instance speaks.
 */
function ensureSubscriber(): void {
  if (subscriber) return;
  try {
    // The shared client runs with `enableOfflineQueue: false` for the hot
    // request paths, which is the wrong default for a long-lived idle
    // subscriber — same override the settings invalidator uses.
    subscriber = redis.duplicate({ lazyConnect: false, enableOfflineQueue: true });
    subscriber.on('error', (err: Error) => {
      console.warn('[IRC] line subscriber error:', err.message);
    });
    subscriber.on('message', (channel: string, message: string) => {
      if (channel !== LINE_CHANNEL) return;
      // `client` is only non-null on the holder, so this is the fence.
      if (!client || leaseOwner !== owner()) return;
      client.say(message);
    });
    void subscriber.subscribe(LINE_CHANNEL);
  } catch (err) {
    subscriber = null;
    console.warn('[IRC] could not subscribe to the line channel:', (err as Error).message);
  }
}

/**
 * Bring the connection in line with the settings. Called by the plugin on a
 * timer, and by the admin routes after a save so a change lands immediately.
 */
export async function reconcile(): Promise<void> {
  let enabled = false;
  let config: IrcAnnounceConfig | null = null;
  try {
    enabled = await getIrcEnabled();
    if (enabled) config = await getIrcConfig();
  } catch (err) {
    lastError = (err as Error).message;
    stop('configuration unreadable');
    return;
  }

  if (!enabled || !config || !ircConfigReady(config)) {
    if (client) stop('announcing disabled');
    await releaseLease();
    return;
  }

  // Before the lease: whoever ends up holding it needs the subscription, and an
  // instance that never wins still pays nothing for one idle connection.
  ensureSubscriber();

  if (!(await holdLease())) return;

  const signature = signatureOf(config);
  if (client && signature === activeSignature) {
    const status = client.status();
    lastStatus = status;
    // A client that has given up is not restarted here on purpose: `error` is
    // terminal for one socket, and the next tick builds a fresh one. That makes
    // the retry cadence the plugin's interval — a bounded, visible backoff
    // rather than a reconnect loop inside the client.
    if (status.state === 'error') {
      lastError = status.lastError;
      stop('retrying');
    }
    return;
  }

  stop('reconfigured');
  activeSignature = signature;
  lastError = null;
  client = new IrcClient(
    {
      host: config.host,
      port: config.port,
      tls: config.tls,
      nick: config.nick,
      realname: config.realname,
      serverPassword: config.serverPassword || undefined,
      saslUser: config.saslUser || undefined,
      saslPassword: config.saslPassword || undefined,
      perform: config.perform,
      channel: config.channel,
      channelKey: config.channelKey || undefined,
    },
    {
      onState: (status) => {
        lastStatus = status;
        if (status.state === 'error') lastError = status.lastError;
        if (status.state === 'ready') {
          console.log(
            `[IRC] Announcing in ${config!.channel} on ${config!.host} as ${status.nick}`
          );
        }
      },
    }
  );
  client.connect();
}

/** Everything the admin console shows about the bot. */
export function ircStatus(): IrcStatus & { leader: boolean } {
  const status = client?.status() ?? lastStatus;
  return {
    state: status?.state ?? 'idle',
    nick: status?.nick ?? '',
    since: status?.since ?? null,
    lastError: status?.lastError ?? lastError,
    queued: status?.queued ?? 0,
    sent: status?.sent ?? 0,
    dropped: status?.dropped ?? 0,
    leader: leaseOwner === owner(),
  };
}

/** Say one arbitrary line — the admin console's test button, and nothing else. */
export async function saySomething(line: string): Promise<boolean> {
  // Through the channel like an announce, so the admin console of an instance
  // that does not hold the connection can still test it.
  try {
    const heard = await redis.publish(LINE_CHANNEL, line);
    return heard > 0;
  } catch {
    return false;
  }
}

export async function shutdownAnnouncer(): Promise<void> {
  stop('shutting down');
  if (subscriber) {
    try {
      await subscriber.unsubscribe(LINE_CHANNEL);
      subscriber.disconnect();
    } catch {
      // Going away regardless.
    }
    subscriber = null;
  }
  await releaseLease();
}

/**
 * Where a release page lives, as an absolute address when we have one.
 *
 * The bot has no request to take an origin from, so: what the operator typed,
 * then the federation identity's public URL for the instances that already
 * declared one, then nothing — and "nothing" yields a path rather than a
 * guessed hostname. A path is honest and still useful; a wrong hostname sends
 * every member of the channel somewhere else.
 */
async function siteBase(config: IrcAnnounceConfig): Promise<string> {
  if (config.siteUrl) return config.siteUrl.replace(/\/+$/, '');
  try {
    const federation = await getFederationConfig();
    if (federation?.publicUrl) return federation.publicUrl.replace(/\/+$/, '');
  } catch {
    // Federation is optional and may not be configured at all.
  }
  return '';
}

export interface AnnounceCandidate {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  categoryId: string | null;
  uploaderId: string | null;
  downloadMultiplier: number | null;
  uploadMultiplier: number | null;
  multipliersUntil: Date | null;
}

/**
 * Announce one accepted release. Fire-and-forget by contract.
 *
 * The caller has the torrent it just accepted, so nothing here re-reads it. The
 * three extra lookups are the ones the caller cannot know: the category name,
 * the tags, and whether the uploader is anonymous.
 */
export async function announceRelease(
  torrent: AnnounceCandidate
): Promise<void> {
  // Deliberately NOT `if (!client) return`: this runs on whichever instance
  // served the upload, which is usually not the one holding the socket.
  let config: IrcAnnounceConfig;
  try {
    if (!(await getIrcEnabled())) return;
    config = await getIrcConfig();
  } catch {
    return;
  }

  // The adult gate, before anything else is spent on the release.
  if (!config.announceAdult && torrent.categoryId) {
    const adult = await adultCategoryIds();
    if (adult.includes(torrent.categoryId)) return;
  }

  const [category] = torrent.categoryId
    ? await db
        .select({ name: schema.categories.name })
        .from(schema.categories)
        .where(eq(schema.categories.id, torrent.categoryId))
        .limit(1)
    : [];

  const tagRows = await db
    .select({ name: schema.tags.name })
    .from(schema.torrentTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.torrentTags.tagId))
    .where(eq(schema.torrentTags.torrentId, torrent.id));

  let uploader = 'anonymous';
  if (torrent.uploaderId) {
    const [row] = await db
      .select({
        username: schema.users.username,
        anonymousUploads: schema.users.anonymousUploads,
      })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.id, torrent.uploaderId),
          eq(schema.users.isBanned, false)
        )
      )
      .limit(1);
    // `concealsUploader` rather than a fresh comparison: one definition of who
    // may be named, shared with the detail page, the feeds and federation.
    if (row && !concealsUploader(row.anonymousUploads)) uploader = row.username;
  }

  // The same computation the Torznab feed publishes, from the same function:
  // the better of the site-wide event and the torrent's own buff, with an
  // expired `multipliers_until` already neutralised. Announcing a figure the
  // feed contradicts would be worse than announcing none — a member racing on
  // the channel and a member polling the feed have to see one tracker.
  const activeEvent = await getActiveSnapshot();
  const siteWide = activeEvent
    ? {
        download: activeEvent.downloadMultiplier,
        upload: activeEvent.uploadMultiplier,
      }
    : IDENTITY;
  const { downloadVolumeFactor, uploadVolumeFactor } = volumeFactors(
    {
      // The columns are nullable and the scale is percent: a row with nothing
      // set means "no buff", which is 100 on both axes rather than 0. Getting
      // this wrong would announce every release as freeleech.
      downloadMultiplier: torrent.downloadMultiplier ?? 100,
      uploadMultiplier: torrent.uploadMultiplier ?? 100,
      multipliersUntil: torrent.multipliersUntil,
    },
    siteWide
  );

  const site = await siteBase(config);
  const fields: AnnounceFields = {
    name: torrent.name,
    category: category?.name ?? 'uncategorised',
    size: humanSize(torrent.size),
    freeleechPercent: freeleechPercent(downloadVolumeFactor),
    uploadFactor: String(Number(uploadVolumeFactor.toFixed(2))),
    tags: tagRows.length ? tagRows.map((t) => t.name).join(', ') : '-',
    uploader,
    // No key in the URL, which is the industry convention and the only safe
    // choice: a line in a channel is seen by everybody in it, so a personalised
    // download link would hand every member the credentials of one. The client
    // appends its own read key — that is what the generated definition's
    // `downloadurl` template is for.
    url: `${site}/torrents/${torrent.infoHash}`,
    infoHash: torrent.infoHash,
  };

  const line = renderAnnounce(config.template, fields);

  /**
   * Once per release, not once per approval.
   *
   * The moderation edge is `pending → accepted`, and an ordinary edit sends an
   * accepted torrent back to `pending` — so a member editing their own release
   * and a moderator re-approving it announced the same thing again, and every
   * autobrr in the channel grabbed it a second time. A key per infohash, kept
   * for a fortnight, is enough: an announce is only interesting while the
   * release is new, and a fortnight is well past that.
   */
  try {
    const first = await redis.set(
      `irc_announce:said:${torrent.infoHash}`,
      '1',
      'EX',
      1_209_600,
      'NX'
    );
    if (first !== 'OK') return;
  } catch {
    // Redis unavailable: announce rather than stay silent. A duplicate line is
    // a nuisance; a missing one is the feature not working.
  }

  /**
   * Published, never said directly — see `LINE_CHANNEL`. This also closes a
   * narrower bug: the guard at the top of this function ran eight awaits ago,
   * and `reconcile()` nulls `client` on any tick where the socket is in error,
   * so `client.say(...)` here could throw on null exactly during an IRC outage.
   */
  try {
    await redis.publish(LINE_CHANNEL, line);
  } catch (err) {
    // A line is not worth an exception on the upload path.
    console.warn('[IRC] could not publish an announce:', (err as Error).message);
  }
}

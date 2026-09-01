/**
 * The staff audit log — how a row gets written, and how a route sharpens it.
 *
 * ## Two halves
 *
 * **The floor** is a Nitro `afterResponse` hook (`plugins/audit-log.ts`). It
 * sees every request, and for a mutating one under `/api/admin/**` or
 * `/api/mod/**` by an authenticated staffer it writes a row: who, what method,
 * what path, what status, when. No route has to do anything, so coverage is a
 * property of the plumbing rather than of somebody remembering — which is the
 * whole reason the previous per-route logs (the one on the route that reads
 * private mail, the moderation thread, the report tombstone) each covered
 * exactly one surface.
 *
 * **The ceiling** is `auditDetail(event, …)`. A route that knows more than the
 * URL does — which member, which setting, from what to what — calls it, and the
 * hook merges what it said over the derived values. Optional everywhere: a
 * route that never calls it still appears in the log.
 *
 * ## What is never recorded
 *
 * Request bodies, wholesale. They carry passwords, panic passwords, channel
 * tokens and 2FA secrets, and a log that swallowed them would be a credential
 * store with a listing page. A route wanting a diff passes exactly the fields
 * it means, through `changes`.
 *
 * Query strings are stripped from `path` for the same reason: `?q=` on a member
 * search is somebody's name.
 *
 * ## Failure is silent, and that is deliberate
 *
 * A failed audit write must never fail the request that caused it. A moderator
 * whose ban went through and whose log row did not is recoverable; a ban that
 * 500s because the log table is full is an outage. The write is best-effort,
 * after the response, and logs its own failure to stderr where the operator's
 * log shipper will see it.
 */
import type { H3Event } from 'h3';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@trackarr/db';
import { hashIP } from './crypto';
import { getClientIP } from './rateLimit';

/** What a route may add to its own audit row. Every field is optional. */
export interface AuditDetail {
  /** Stable dotted key, e.g. `user.ban`. Overrides the derived action. */
  action?: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  /** `{ field: { from, to } }`, or whatever shape reads clearest. */
  changes?: Record<string, unknown>;
}

/**
 * Attach (or extend) the audit detail for the request in flight.
 *
 * Merges rather than replaces, so a route can name its action early — before a
 * guard can throw — and fill in the target once it has loaded it. Called on a
 * request the hook will not log (a GET, a non-staff path), it is a no-op that
 * costs one property write.
 */
export function auditDetail(event: H3Event, detail: AuditDetail): void {
  const existing = (event.context.auditDetail ?? {}) as AuditDetail;
  event.context.auditDetail = {
    ...existing,
    ...detail,
    changes: detail.changes
      ? { ...(existing.changes ?? {}), ...detail.changes }
      : existing.changes,
  };
}

/**
 * `POST /api/admin/users/3f2b.../ban` → `admin.users.ban`.
 *
 * A fallback, and it has to be a decent one: most routes will never call
 * `auditDetail`, so this is what the listing shows for them, and it is what the
 * action filter groups on. An identifier left in the name would make every row
 * its own category and the filter useless.
 *
 * `paramValues` is how that is done exactly rather than by guessing: h3 knows
 * which segments matched a route parameter, so those are removed by value. An
 * end-to-end run is what showed the guessing was not enough on its own —
 * `DELETE /api/admin/federation/peers/does-not-exist` produced
 * `admin.federation.peers.does-not-exist.delete`, because a slug-shaped peer id
 * looks exactly like a sub-resource name.
 *
 * The shape heuristics stay as a fallback for a call site with no params to
 * hand (a test, a route matched without them).
 */
export function deriveAction(
  method: string,
  path: string,
  paramValues: readonly string[] = []
): string {
  /**
   * Route parameters are dropped by POSITION, not by value.
   *
   * By value, any segment that happened to equal a parameter's value went too —
   * so a member called `mutes` turned `mod/room/mutes/:username` into
   * `mod.room.delete`, and an admin filtering the register by action key would
   * never see those lines. Usernames are 3–20 characters with no reserved list,
   * so `mod`, `room` and `mutes` are all registrable.
   *
   * The positions come from the values: a parameter's value appears exactly
   * where the router matched it, and taking the FIRST unclaimed occurrence of
   * each value is what makes this positional rather than a set membership test.
   */
  const segments = path.replace(/^\/api\//, '').split('/').filter(Boolean);
  const dropped = new Set<number>();
  for (const value of paramValues.filter(Boolean)) {
    const at = segments.findIndex((seg, i) => seg === value && !dropped.has(i));
    if (at >= 0) dropped.add(at);
  }
  const parts = segments
    .filter((_, i) => !dropped.has(i))
    // Identifier-shaped: a UUID, a 40-hex infohash, a long opaque id, or a
    // bare number. `slug`-shaped segments are kept — they name things.
    .filter(
      (p) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p) &&
        !/^[0-9a-f]{32,}$/i.test(p) &&
        !/^\d+$/.test(p) &&
        p.length < 40
    );

  const verb =
    {
      POST: 'create',
      PUT: 'update',
      PATCH: 'update',
      DELETE: 'delete',
    }[method.toUpperCase()] ?? method.toLowerCase();

  const tail = parts[parts.length - 1];
  // A route whose last segment is already a verb (`ban`, `unban`, `revoke`,
  // `panic`) reads worse with one appended: `admin.users.ban.create`.
  const tailIsVerb =
    !!tail &&
    /^(ban|unban|revoke|suspend|block|approve|reject|resolve|withdraw|panic|test|send|retry|rotate|reset|refresh|validate|cancel|fill|close|reopen|assign|pin|unpin|lock|unlock|promote|demote|clear|sweep|flush|import|export)$/.test(
      tail
    );

  const base = parts.join('.') || 'unknown';
  return tailIsVerb ? base : `${base}.${verb}`;
}

/** Methods that change something. A GET is not audited. */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Is this a request the audit log is for?
 *
 * Staff consoles only. Member-facing mutations are not staff actions and
 * logging them would turn a register of authority into a record of everybody's
 * browsing — which the privacy toggles elsewhere in this codebase exist to
 * prevent.
 */
/**
 * Member-facing paths where a staff member exercises a staff power.
 *
 * The console prefixes are not the whole story, and "who did what, across the
 * whole console" was too generous a claim: a moderator deletes a torrent
 * through `DELETE /api/torrents/:hash`, a comment through
 * `/api/torrents/comments/:id`, moderates the forum through `/api/forum/...`,
 * and removes a message through the messaging routes. Every one of those is an
 * act of authority against somebody else's content, and none of them left a row.
 *
 * Matched only when the ACTOR is staff, which is what keeps the register from
 * becoming a log of everybody's activity — the thing the predicate above is
 * careful to avoid. A moderator deleting their own comment is audited too, and
 * that is the right side to err on: the register records what authority did,
 * and it cannot know intent.
 */
const STAFF_REACH: readonly RegExp[] = [
  /^\/api\/torrents\/[^/]+$/,
  /^\/api\/torrents\/[^/]+\/(tags|federate-swarm|index)$/,
  /^\/api\/torrents\/comments\/[^/]+$/,
  /^\/api\/forum\//,
  /^\/api\/messaging\/room\/messages\/[^/]+$/,
  /^\/api\/messaging\/conversations\/[^/]+\/messages\/[^/]+$/,
  /^\/api\/requests\/[^/]+\/comments\/[^/]+$/,
  /^\/api\/tickets\/[^/]+\//,
];

export function isAuditable(
  method: string,
  path: string,
  actorIsStaff = false
): boolean {
  if (!MUTATING.has(method.toUpperCase())) return false;
  if (path.startsWith('/api/admin/') || path.startsWith('/api/mod/')) return true;
  return actorIsStaff && STAFF_REACH.some((re) => re.test(path));
}

/**
 * The values h3 bound to route parameters for this request, if any.
 *
 * Defensive about the shape: this reads `event.context` from inside a hook
 * that runs after the response, and a missing or oddly-typed `params` must
 * degrade to "no params" rather than throw inside the log.
 */
function routeParamValues(event: H3Event): string[] {
  const params = event.context?.params;
  if (!params || typeof params !== 'object') return [];
  return Object.values(params as Record<string, unknown>).filter(
    (v): v is string => typeof v === 'string' && v.length > 0
  );
}

export interface AuditActor {
  id: string;
  username: string;
  isAdmin?: boolean;
  isModerator?: boolean;
  isOwner?: boolean;
}

/** `owner` outranks `admin` outranks `moderator`. */
function roleOf(actor: AuditActor): string {
  if (actor.isOwner) return 'owner';
  if (actor.isAdmin) return 'admin';
  if (actor.isModerator) return 'moderator';
  // Reached only if a staff route ever stops being staff-gated. Recorded as
  // what it is rather than silently promoted.
  return 'member';
}

/**
 * Write one row. Never throws.
 *
 * `statusCode` is recorded whatever it is, failures included: a run of 403s
 * from one account is a signal, and a log that kept only the successes would
 * hide exactly the attempts worth seeing.
 */
export async function writeAuditEntry(
  event: H3Event,
  actor: AuditActor,
  statusCode: number
): Promise<void> {
  const detail = (event.context.auditDetail ?? {}) as AuditDetail;
  // `event.path` carries the query string; the audit row must not.
  const path = (event.path ?? '').split('?')[0] ?? '';
  const method = (event.method ?? 'GET').toUpperCase();

  let ipHash: string | null = null;
  try {
    const ip = getClientIP(event);
    ipHash = ip ? hashIP(ip) : null;
  } catch {
    // An unresolvable client IP is not a reason to lose the entry.
  }

  try {
    await db.insert(schema.auditLog).values({
      id: randomUUID(),
      actorId: actor.id,
      actorName: actor.username,
      actorRole: roleOf(actor),
      action: detail.action ?? deriveAction(method, path, routeParamValues(event)),
      method,
      path,
      targetType: detail.targetType ?? null,
      targetId: detail.targetId ?? null,
      targetLabel: detail.targetLabel ?? null,
      changes: detail.changes ?? null,
      statusCode,
      actorIpHash: ipHash,
    });
  } catch (err) {
    // Loud in the operator's logs, invisible to the request. See the note at
    // the top: a ban that went through with no row is recoverable, a ban that
    // 500s because of its own log entry is not.
    console.error('[Audit] write failed:', (err as Error).message);
  }
}

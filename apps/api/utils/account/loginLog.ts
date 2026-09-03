/**
 * Recording how a session was opened, or refused.
 *
 * One helper called from the four places that authenticate, rather than four
 * copies of an insert. Best-effort by contract: a login must never fail because
 * its own log row did, so everything here is wrapped and swallowed.
 *
 * ## Why failures are recorded
 *
 * The failed attempt is the more useful half. There is no per-account lockout
 * on this site — throttling is entirely per IP, so an attempt spread across
 * addresses meets nothing at all — and this table is what makes such an attempt
 * visible afterwards even though nothing stopped it at the time.
 *
 * ## The User-Agent is truncated
 *
 * At 200 characters. Long enough to tell a browser from a script, short enough
 * that a hostile client cannot use the column as storage.
 */
import { randomUUID } from 'node:crypto';
import type { H3Event } from 'h3';
import { db, schema } from '@trackarr/db';
import { hashIP } from '~~/utils/crypto';
import { getClientIP } from '~~/utils/rateLimit';

export type LoginMethod =
  | 'password'
  | 'passkey'
  | 'totp'
  | 'recovery'
  | 'trusted-device';

export type LoginOutcome = 'success' | 'failed';

const UA_MAX = 200;

export async function recordLogin(
  event: H3Event,
  input: {
    userId: string | null;
    username: string;
    method: LoginMethod;
    outcome: LoginOutcome;
  }
): Promise<void> {
  try {
    let ipHash: string | null = null;
    try {
      const ip = getClientIP(event);
      ipHash = ip && ip !== 'unknown' ? hashIP(ip) : null;
    } catch {
      // An unresolvable address is not a reason to lose the event.
    }

    await db.insert(schema.loginEvents).values({
      id: randomUUID(),
      userId: input.userId,
      username: input.username,
      method: input.method,
      outcome: input.outcome,
      ipHash,
      userAgent: (getHeader(event, 'user-agent') ?? '').slice(0, UA_MAX) || null,
    });
  } catch (err) {
    // Loud in the operator's log, invisible to the member: a login that
    // succeeded and did not get a row is recoverable, a login that 500s
    // because of its own bookkeeping is not.
    console.error('[LoginLog] write failed:', (err as Error).message);
  }
}

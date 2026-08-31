/**
 * The staff audit log's write path.
 *
 * Two Nitro hooks, not one, and the second is there because the first is not
 * enough — which an end-to-end check found rather than a review:
 *
 *   - `afterResponse` fires for a request the handler answered normally.
 *   - `error` fires for one that threw, and `afterResponse` does NOT run for
 *     it. A single-hook version therefore recorded every successful ban and
 *     silently dropped every refusal — the exact rows worth having. A run of
 *     403s from one account is the pattern this register exists to surface,
 *     and it would have been the one thing invisible in it.
 *
 * Both paths go through `record`, which is idempotent: a request that somehow
 * reached both hooks writes one row, not two.
 *
 * The write sits after the response either way, so the insert never delays a
 * reply or fails one.
 *
 * Why a hook rather than a call in each route: there are 243 operations in the
 * generated OpenAPI spec, dozens of them staff mutations, and a convention that
 * every one of them must remember to log itself is a convention that holds
 * until the next route. Here, coverage is structural — a route added tomorrow
 * is audited before it is written. What a route can still do is *sharpen* its
 * entry, by calling `auditDetail`; see `utils/audit.ts`.
 *
 * The gate is deliberately narrow: a mutating method, a path under
 * `/api/admin/` or `/api/mod/`, and an authenticated caller. Everything else —
 * every GET, every member-facing write — is not a staff action and does not
 * belong in a register of authority.
 */
import type { H3Event } from 'h3';
import { isAuditable, writeAuditEntry, type AuditActor } from '~~/utils/audit';

/**
 * One row per request, whichever hook gets here first.
 *
 * `statusOverride` is for the error path: `event.node.res.statusCode` is not
 * always the code that will be sent when a handler threw, so the error's own
 * code is used when there is one.
 */
function record(event: H3Event, statusOverride?: number): void {
  if (!event?.context || event.context.auditWritten) return;

  const method = event.method ?? 'GET';
  const path = (event.path ?? '').split('?')[0] ?? '';
  if (!isAuditable(method, path)) return;

  // Set by `requireAuthSession`. Absent means the request never got past
  // authentication, which is the rate limiter's business and not this
  // register's — there is no actor to name.
  const actor = event.context.auditActor as AuditActor | undefined;
  if (!actor?.id) return;

  event.context.auditWritten = true;

  const statusCode = statusOverride ?? event.node?.res?.statusCode ?? 200;

  // Not awaited: the response has already gone out, and holding the hook open
  // would keep the request's context alive for the length of an INSERT.
  // `writeAuditEntry` swallows its own failures.
  void writeAuditEntry(event, actor, statusCode);
}

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('afterResponse', (event) => {
    record(event);
  });

  nitro.hooks.hook('error', (error, ctx) => {
    if (!ctx?.event) return;
    const status = (error as { statusCode?: number })?.statusCode;
    record(ctx.event, typeof status === 'number' ? status : 500);
  });
});

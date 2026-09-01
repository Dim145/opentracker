/**
 * GET /api/admin/invites/tree?userId=…
 *
 * Who invited this member, and who they invited in turn.
 *
 * The procedure this exists for is standard across the trackers that have had
 * it for decades: an account is banned for cheating, and the first question is
 * who vouched for them — because whoever did is either careless or complicit,
 * and their other invitees are worth a look. The data has always been here;
 * both pages that read it only ever rendered one generation.
 *
 * ## Shape
 *
 * Two walks, both bounded:
 *
 *   - **Ancestors**, one row per generation, up to `MAX_DEPTH`. The chain ends
 *     at a member nobody invited — which on this site means either the first
 *     account or somebody who registered while registration was open. Those
 *     are indistinguishable from missing data, and the response says which
 *     ending it hit rather than letting the reader guess.
 *   - **Descendants**, breadth-first, capped on both depth and total nodes. A
 *     prolific inviter three generations down is a lot of rows, and an
 *     unbounded recursive CTE against a social graph is a query nobody meant
 *     to write.
 *
 * ## Erased accounts
 *
 * An erasure scrubs the username to a tombstone and leaves every invitation row
 * intact, so the EDGES survive an erased inviter perfectly — which is exactly
 * what a genealogy needs. The node is flagged so the page can draw a tombstone
 * rather than a clickable stranger.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { auditDetail, writeAuditEntry } from '~~/utils/audit';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateQuery } from '~~/utils/schemas';

/** How far up, and how far down. */
const MAX_DEPTH = 10;
/** And how many nodes in total, whatever shape the tree turns out to be. */
const MAX_NODES = 400;

const querySchema = z.object({
  userId: z.string().uuid(),
});

interface Node {
  id: string;
  username: string;
  isBanned: boolean;
  /** True when the account has been erased — render a tombstone, not a link. */
  erased: boolean;
  createdAt: Date;
  /** When this member used their invite. Null for a genealogy root. */
  invitedAt: Date | null;
  depth: number;
  children?: Node[];
}

const USER_COLUMNS = {
  id: schema.users.id,
  username: schema.users.username,
  isBanned: schema.users.isBanned,
  deletedAt: schema.users.deletedAt,
  createdAt: schema.users.createdAt,
};

function toNode(
  row: {
    id: string;
    username: string;
    isBanned: boolean;
    deletedAt: Date | null;
    createdAt: Date;
  },
  depth: number,
  invitedAt: Date | null
): Node {
  return {
    id: row.id,
    username: row.username,
    isBanned: row.isBanned,
    erased: row.deletedAt !== null,
    createdAt: row.createdAt,
    invitedAt,
    depth,
  };
}

export default defineEventHandler(async (event) => {
  const session = await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.public);

  const { userId } = validateQuery(event, querySchema);

  const [subject] = await db.select(USER_COLUMNS).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!subject) {
    throw createError({ statusCode: 404, message: 'User not found' });
  }

  // ── Up ─────────────────────────────────────────────────────────────
  const ancestors: Node[] = [];
  let cursor = userId;
  let truncatedUp = false;
  const seen = new Set<string>([userId]);

  for (let depth = 1; depth <= MAX_DEPTH; depth++) {
    const [invite] = await db
      .select({ createdBy: schema.invitations.createdBy, usedAt: schema.invitations.usedAt })
      .from(schema.invitations)
      .where(eq(schema.invitations.usedBy, cursor))
      .limit(1);
    if (!invite) break;

    // A cycle is impossible through registration, but a restored backup or a
    // hand-edited row could produce one, and an unguarded walk would spin.
    if (seen.has(invite.createdBy)) break;
    seen.add(invite.createdBy);

    const [row] = await db
      .select(USER_COLUMNS)
      .from(schema.users)
      .where(eq(schema.users.id, invite.createdBy))
      .limit(1);
    if (!row) break;

    ancestors.push(toNode(row, depth, invite.usedAt));
    cursor = row.id;
  }

  /**
   * Whether the chain actually continues past the tenth generation.
   *
   * This used to be `depth === MAX_DEPTH` inside the loop, which is true as soon
   * as a tenth ancestor is found — so a chain that is EXACTLY ten deep, with the
   * founder at the top, reported itself as truncated. One extra probe answers
   * the question the flag is claiming to answer.
   */
  if (ancestors.length === MAX_DEPTH) {
    const [further] = await db
      .select({ createdBy: schema.invitations.createdBy })
      .from(schema.invitations)
      .where(eq(schema.invitations.usedBy, cursor))
      .limit(1);
    truncatedUp = !!further && !seen.has(further.createdBy);
  }

  // ── Down ───────────────────────────────────────────────────────────
  const root = toNode(subject, 0, null);
  let nodeCount = 1;
  let truncatedDown = false;

  let frontier: Node[] = [root];
  for (let depth = 1; depth <= MAX_DEPTH && frontier.length > 0; depth++) {
    const parentIds = frontier.map((n) => n.id);
    /**
     * Bounded in SQL, not only in the response.
     *
     * `MAX_NODES` was applied while building the answer, so a prolific inviter
     * three generations down still had every one of their redeemed invitations
     * returned to the API first — the whole table, potentially, to produce four
     * hundred nodes. The remaining budget is the limit, plus one so a truncation
     * is still detectable.
     */
    const remaining = MAX_NODES - nodeCount;
    if (remaining <= 0) {
      truncatedDown = true;
      break;
    }
    const invites = await db
      .select({
        createdBy: schema.invitations.createdBy,
        usedBy: schema.invitations.usedBy,
        usedAt: schema.invitations.usedAt,
      })
      .from(schema.invitations)
      .where(
        and(inArray(schema.invitations.createdBy, parentIds), isNotNull(schema.invitations.usedBy))
      )
      .orderBy(schema.invitations.usedAt)
      .limit(remaining + 1);
    if (invites.length === 0) break;
    if (invites.length > remaining) truncatedDown = true;

    /**
     * A member already placed in the tree is not placed again.
     *
     * The upward walk has this guard and the descent did not: `invitations` has
     * no constraint preventing a cycle (A invited B, B invited A after a staff
     * edit), and without the guard the same pair is emitted once per generation
     * until the node budget runs out — bounded, but it renders as a family tree
     * that repeats itself.
     */
    const childIds = [
      ...new Set(invites.map((i) => i.usedBy!).filter((id) => !seen.has(id))),
    ];
    if (childIds.length === 0) break;
    const rows = await db.select(USER_COLUMNS).from(schema.users).where(inArray(schema.users.id, childIds));
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const byParent = new Map(frontier.map((n) => [n.id, n]));

    const next: Node[] = [];
    for (const invite of invites) {
      if (nodeCount >= MAX_NODES) {
        truncatedDown = true;
        break;
      }
      const row = rowById.get(invite.usedBy!);
      const parent = byParent.get(invite.createdBy);
      if (!row || !parent) continue;

      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const node = toNode(row, depth, invite.usedAt);
      (parent.children ??= []).push(node);
      next.push(node);
      nodeCount++;
    }
    if (truncatedDown) break;
    frontier = next;
    if (depth === MAX_DEPTH && next.length > 0) truncatedDown = true;
  }

  /**
   * Logged explicitly, because the hook does not log reads.
   *
   * That is the right default — a register of authority records decisions, not
   * who looked at a page — and this is the one read worth the exception: it is
   * the social graph of the entire site in one response, and the commit that
   * added it claimed it was audited when it was not.
   */
  auditDetail(event, {
    action: 'admin.invites.tree.read',
    targetType: 'user',
    targetId: userId,
    targetLabel: root.username,
  });
  void writeAuditEntry(event, session.user, 200);

  return {
    subject: root,
    /** Nearest first: `ancestors[0]` is who invited the subject. */
    ancestors,
    /**
     * Why the upward walk stopped. `root` means nobody invited them — the
     * first account, or a member who registered while registration was open.
     * Those two are indistinguishable in the data, and saying "root" rather
     * than showing an empty list is what keeps a reader from assuming the
     * record is incomplete.
     */
    ancestorsEnd: truncatedUp ? 'depth-limit' : 'root',
    /**
     * One flag per direction, because the console renders one notice per
     * section.
     *
     * A single `truncatedUp || truncatedDown` meant an up-truncation printed
     * "truncated at 400 members or 10 generations" underneath the DESCENDANT
     * list — telling the operator the branch they can see is incomplete when it
     * is the chain above that is. On a page whose whole job is tracing a
     * filiation, that sends the investigation to the wrong end of the tree.
     * `truncated` stays for anything already reading it.
     */
    truncatedUp,
    truncatedDown,
    truncated: truncatedUp || truncatedDown,
    limits: { maxDepth: MAX_DEPTH, maxNodes: MAX_NODES },
    nodeCount,
  };
});

/**
 * The one badge to show next to a name.
 *
 * One, not a row of them. A message line has room for a name and a
 * marker; five chips push the message off the screen and stop meaning
 * anything individually — which is the state every forum that shows
 * every role ends up in.
 *
 * The order is fixed and staff always wins: owner, then admin, then
 * moderator, then the highest-priority role the operator marked as a
 * public badge. A moderator who also holds "Uploader" reads as a
 * moderator, because that is the fact that changes how you read what
 * they wrote.
 *
 * Hidden roles never surface here. `showAsBadge` is the operator saying
 * this one is public; a role that only grants a permission is not a
 * label anyone asked to wear.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';

export type BadgeKind = 'owner' | 'admin' | 'moderator' | 'role';

export interface Badge {
  kind: BadgeKind;
  /**
   * Only set for `kind: 'role'`. Operator-defined names are not
   * translatable, so they travel as-is; the three staff kinds carry no
   * name and the client localises them.
   */
  name?: string;
  color?: string;
  icon?: string | null;
}

/**
 * Resolve badges for a page of users, in two queries rather than two per
 * user. The caller passes every id on the page at once.
 */
export async function topBadgesFor(
  userIds: string[]
): Promise<Record<string, Badge>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return {};

  const out: Record<string, Badge> = {};

  const flags = await db
    .select({
      id: schema.users.id,
      isOwner: schema.users.isOwner,
      isAdmin: schema.users.isAdmin,
      isModerator: schema.users.isModerator,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, ids));

  const needsRole: string[] = [];
  for (const f of flags) {
    if (f.isOwner) out[f.id] = { kind: 'owner' };
    else if (f.isAdmin) out[f.id] = { kind: 'admin' };
    else if (f.isModerator) out[f.id] = { kind: 'moderator' };
    // Only members without a staff flag need the role lookup — staff
    // already have their answer and the query would be wasted on them.
    else needsRole.push(f.id);
  }

  if (needsRole.length > 0) {
    // `DISTINCT ON` picks the top row per user inside Postgres. Fetching
    // every attached role and sorting in Node would ship a page's worth
    // of rows to throw all but one of each away.
    const rows = await db
      .selectDistinctOn([schema.userRoles.userId], {
        userId: schema.userRoles.userId,
        name: schema.roles.name,
        color: schema.roles.color,
        icon: schema.roles.icon,
      })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(
        and(
          inArray(schema.userRoles.userId, needsRole),
          eq(schema.roles.showAsBadge, true)
        )
      )
      // The first column must lead the ordering for DISTINCT ON; the
      // priority is what actually decides which row survives. `name` is
      // the tie-break, so two roles at the same priority always resolve
      // the same way instead of depending on scan order.
      .orderBy(
        schema.userRoles.userId,
        desc(schema.roles.priority),
        schema.roles.name
      );

    for (const r of rows) {
      out[r.userId] = {
        kind: 'role',
        name: r.name,
        color: r.color,
        icon: r.icon,
      };
    }
  }

  return out;
}

/** Convenience for a single user — same rules, one lookup. */
export async function topBadgeFor(userId: string): Promise<Badge | null> {
  return (await topBadgesFor([userId]))[userId] ?? null;
}

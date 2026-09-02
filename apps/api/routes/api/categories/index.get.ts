import { db, schema } from '@trackarr/db';
import { asc, count, eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const { user: session } = await requireUserSession(event);

  // The session is updated lazily — read the canonical preference
  // from the row so flipping the toggle takes effect on the next
  // request, not just after a re-login.
  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, session.id),
    columns: {
      showAdultContent: true,
      isAdmin: true,
      isModerator: true,
    },
  });
  // Staff (admin / mod) get an opt-in escape hatch: passing
  // `?includeAdult=true` returns the full tree even when their own
  // profile has the toggle off. The Categories admin panel uses this
  // so the operator can curate the XXX subtree without enabling it
  // on their own browsing surface. Regular users always see the
  // tree filtered by their personal preference.
  const isStaff = !!(me?.isAdmin || me?.isModerator);
  const query = getQuery(event);
  const explicitInclude = isStaff && query.includeAdult === 'true';
  const showAdult = me?.showAdultContent === true || explicitInclude;

  const allCategories = await db.query.categories.findMany({
    orderBy: [asc(schema.categories.name)],
    with: {
      subcategories: {
        orderBy: [asc(schema.categories.name)],
      },
    },
  });

  // Filter both the root categories and the nested subcategories so a
  // user with the toggle off never even sees the XXX tree existed.
  const visible = allCategories.filter((c) => showAdult || !c.isAdult);

  // How many torrents sit in each category. Staff only, and only when asked
  // for: it is one grouped scan, and the member-facing callers of this route
  // (the upload form, the filter rail) have no use for it.
  //
  // The admin panel needs it because DELETE refuses a category that still has
  // torrents — without the number, the operator learns that from a 400 after
  // confirming a dialog that had promised the torrents would simply become
  // unclassified.
  let counts = new Map<string, number>();
  if (isStaff && query.withCounts === 'true') {
    const rows = await db
      .select({ categoryId: schema.torrents.categoryId, n: count() })
      .from(schema.torrents)
      .groupBy(schema.torrents.categoryId);
    counts = new Map(
      rows
        .filter((r): r is { categoryId: string; n: number } => !!r.categoryId)
        .map((r) => [r.categoryId, Number(r.n)]),
    );
  }
  const withCount = <T extends { id: string }>(c: T) =>
    counts.size || (isStaff && query.withCounts === 'true')
      ? { ...c, torrentCount: counts.get(c.id) ?? 0 }
      : c;

  const rootCategories = visible
    .filter((c) => c.parentId === null)
    .map((c) => ({
      ...withCount(c),
      subcategories: c.subcategories
        .filter((sc) => showAdult || !sc.isAdult)
        .map(withCount),
    }));

  return rootCategories;
});

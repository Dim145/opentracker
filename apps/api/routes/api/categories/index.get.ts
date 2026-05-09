import { db, schema } from '@trackarr/db';
import { asc, eq } from 'drizzle-orm';

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
  const rootCategories = visible
    .filter((c) => c.parentId === null)
    .map((c) => ({
      ...c,
      subcategories: c.subcategories.filter((sc) => showAdult || !sc.isAdult),
    }));

  return rootCategories;
});

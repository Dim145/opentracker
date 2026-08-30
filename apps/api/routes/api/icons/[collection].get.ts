/**
 * GET /api/icons/:collection.json?icons=a,b,c
 *
 * Icon data, served from this instance.
 *
 * The static frontend has no server of its own — that is the point of
 * it, nginx and 10 MB of RAM instead of Nitro and 150 — so the endpoint
 * `@nuxt/icon` normally talks to does not exist there. Without one, any
 * icon the client bundle does not carry falls back to
 * `api.iconify.design`: an external request the site's own
 * `connect-src 'self'` policy blocks, so the control renders as an empty
 * box and the page quietly reaches for a third party.
 *
 * The icons the application itself draws are all bundled at build time.
 * What cannot be is what an OPERATOR chose and stored in the database —
 * a role's icon, the site logo — because it is not in the source for the
 * bundler to find. This is the endpoint that answers for those.
 *
 * The SPA's nginx already proxies /api to this container, so the request
 * never leaves the origin the browser is already on.
 *
 * The contract mirrors `@nuxt/icon`'s own server route exactly — same
 * path shape, same query, same `getIcons` payload — because the client
 * is theirs and expects it. Bundling the whole of Phosphor into the
 * browser instead would be 9161 icons and roughly 4 MB of JavaScript,
 * to spare two admin fields.
 */
import { getIcons } from '@iconify/utils';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

/**
 * The shape `getIcons` needs. Declared here rather than importing
 * `@iconify/types`, which is a transitive dependency we would otherwise
 * have to pin just for one type.
 */
type IconCollection = Parameters<typeof getIcons>[0];

/**
 * One collection, loaded once and kept.
 *
 * Phosphor is 4.4 MB of JSON. Parsing it per request would make every
 * icon a measurable cost; parsing it once makes it a startup cost that
 * is already paid by the time anybody asks.
 */
let phosphor: IconCollection | null = null;
async function collection(name: string): Promise<IconCollection | null> {
  if (name !== 'ph') return null;
  phosphor ??= (await import('@iconify-json/ph/icons.json', {
    with: { type: 'json' },
  })) as unknown as IconCollection;
  return phosphor;
}

export default defineEventHandler(async (event) => {
  // Its own bucket, not `public`: that counter is shared with search and
  // the catalogue, so an icon would spend a member's browsing budget and
  // then disappear. Bounded all the same — the parameter is
  // attacker-controlled and a long list is a long response.
  await rateLimit(event, RATE_LIMITS.icons);

  const raw = getRouterParam(event, 'collection') ?? '';
  const name = raw.replace(/\.json$/, '');
  if (!name) {
    throw createError({ statusCode: 400, message: 'No collection specified' });
  }

  const query = getQuery(event);
  const names = String(query.icons ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    // Bounded: the client asks for what one page needs, and an unbounded
    // list is a way to make one request cost a whole collection.
    .slice(0, 200);
  if (names.length === 0) {
    throw createError({ statusCode: 400, message: 'No icons specified' });
  }

  const data = await collection(name);
  if (!data) throw createError({ statusCode: 404, message: 'Not found' });

  // Immutable in practice: an icon's path data does not change between
  // releases, and the collection is pinned by the lockfile.
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
  return getIcons(data, names);
});

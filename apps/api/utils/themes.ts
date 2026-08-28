/**
 * Reading themes, and turning them into the stylesheet a browser gets.
 *
 * ## The one decision everything else follows from
 *
 * The served stylesheet carries EVERY enabled theme, not just the active one.
 * That is what keeps switching instantaneous — changing appearance is setting
 * one attribute on `<html>`, exactly as it already is for the two built-ins, with
 * no request and no flash. The alternative (fetch the chosen theme) would make
 * every switch a round trip and put a flash of the old appearance in the middle
 * of it.
 *
 * It costs ~700 bytes gzipped per theme against ~9 KB for `entry.css`, which is
 * why `MAX_ENABLED_THEMES` exists: ten is the point where the trade is still
 * obviously worth it. Past that the honest answer would be lazy loading, and the
 * flash comes back.
 *
 * ## System mode is CSS, not JavaScript
 *
 * `[data-theme="system"]` is emitted twice: once with the operator's chosen
 * light theme, once inside `@media (prefers-color-scheme: dark)` with their
 * chosen dark one. No client hint, no `Vary`, no script, no flash, and it works
 * in every browser that has ever supported the media query.
 *
 * `light-dark()` would have been tidier and cannot do this: it takes colours and
 * images only, and the ambition here is a theme that changes more than colour.
 *
 * ## Two deployment modes, one emitter
 *
 * `apps/web` ships twice — SSR (`front-ssr`) and a static SPA (`front`, nginx,
 * no server at all). The SPA has nothing that can inline a `<style>` at render
 * time, so a route the browser can `<link>` to is the only mechanism that works
 * in both. `/api/*` is same-origin through Caddy in either case, so `style-src
 * 'self'` covers it with no nonce and no `'unsafe-inline'` involvement.
 */
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  BUILT_IN_THEMES,
  SYSTEM_THEME,
  type BuiltInTheme,
} from '@trackarr/shared';
import {
  emittedValue,
  patternImage,
  resolveTokens,
  type TokenMap,
} from '@trackarr/shared/theme';
import { scopeCustomCss } from './themeCss';
import { fontFaceCss } from './fonts';
import { getSetting, setSetting, SETTINGS_KEYS } from './settings';

/** See the module header for why this is ten and not "as many as you like". */
export const MAX_ENABLED_THEMES = 10;

/** Slugs nothing may claim: two are the built-ins, one is the mode. */
export const RESERVED_SLUGS: readonly string[] = [...BUILT_IN_THEMES, SYSTEM_THEME];

export interface ServableTheme {
  id: string;
  slug: string;
  name: string;
  base: BuiltInTheme;
  tokens: Record<string, string>;
  customCss: string | null;
  visibility: string;
  requiredRoles: string[] | null;
}

/** Every theme that may be served, in display order. */
export async function enabledThemes(): Promise<ServableTheme[]> {
  const rows = await db
    .select({
      id: schema.themes.id,
      slug: schema.themes.slug,
      name: schema.themes.name,
      base: schema.themes.base,
      tokens: schema.themes.tokens,
      customCss: schema.themes.customCss,
      visibility: schema.themes.visibility,
      requiredRoles: schema.themes.requiredRoles,
    })
    .from(schema.themes)
    .where(eq(schema.themes.enabled, true))
    .orderBy(asc(schema.themes.position), asc(schema.themes.createdAt))
    .limit(MAX_ENABLED_THEMES);
  return rows.map((r) => ({ ...r, base: r.base as BuiltInTheme }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

/** What an anonymous visitor and a new member get. */
export async function getDefaultTheme(): Promise<string> {
  return (await getSetting(SETTINGS_KEYS.THEME_DEFAULT)) || 'dark';
}

/** The two halves of `system` mode, as slugs. */
export async function getSystemMapping(): Promise<{
  light: string;
  dark: string;
}> {
  return {
    light: (await getSetting(SETTINGS_KEYS.THEME_SYSTEM_LIGHT)) || 'light',
    dark: (await getSetting(SETTINGS_KEYS.THEME_SYSTEM_DARK)) || 'dark',
  };
}

/**
 * The ETag for the served stylesheet.
 *
 * A counter rather than `max(updated_at)`, because a DELETE moves no timestamp —
 * removing a theme has to invalidate the sheet as surely as editing one. And
 * rather than a hash of the output, because hashing means building the CSS to
 * decide whether to build the CSS.
 */
export async function getThemeVersion(): Promise<string> {
  return (await getSetting(SETTINGS_KEYS.THEME_VERSION)) || '1';
}

/**
 * Called by every write path. Cheap, and the eviction is what makes it work
 * across replicas: `setSetting` publishes on the Redis channel the settings
 * cache subscribes to, so the next request on any instance rebuilds.
 */
export async function bumpThemeVersion(): Promise<void> {
  const current = Number(await getThemeVersion());
  const next = Number.isSafeInteger(current) ? current + 1 : 1;
  await setSetting(SETTINGS_KEYS.THEME_VERSION, String(next));
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolution for one viewer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which themes this viewer may actually choose.
 *
 * Role-gated themes are filtered OUT of the list, and out of what `PATCH
 * /api/me` will accept. They are still in the served stylesheet — see the note
 * on `themes.visibility`: this is a perk, not an access control, and the thing
 * that is enforced is that nobody can keep a theme they are not entitled to.
 */
export function choosableFor(
  themes: ServableTheme[],
  roleIds: readonly string[],
): ServableTheme[] {
  const held = new Set(roleIds);
  return themes.filter(
    (t) =>
      t.visibility !== 'roles' ||
      (t.requiredRoles ?? []).some((r) => held.has(r)),
  );
}

/**
 * The theme a viewer ends up with, given what they asked for.
 *
 * Falls back to the site default, then to `dark`. Both hops matter: a member can
 * be holding the slug of a theme that has since been deleted or disabled, and a
 * site whose default was itself deleted must still render.
 */
export function resolvePreference(
  preference: string | null | undefined,
  available: readonly string[],
  siteDefault: string,
): string {
  const ok = (v: string) =>
    v === SYSTEM_THEME ||
    (BUILT_IN_THEMES as readonly string[]).includes(v) ||
    available.includes(v);
  if (preference && ok(preference)) return preference;
  if (ok(siteDefault)) return siteDefault;
  return 'dark';
}

// ─────────────────────────────────────────────────────────────────────────────
// Emission
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `--key: value;` lines for one resolved token map.
 *
 * No escaping is applied and none is needed, which is worth stating plainly
 * rather than leaving to inference: every value here has been through
 * `isValidTokenValue`, which admits three integers, a bare decimal, or one of a
 * closed list. A `}` or a `;` cannot reach this function. That is the whole
 * argument for the RGB-triplet convention being a security property and not
 * just a Tailwind convenience.
 */
function declarations(tokens: TokenMap, indent = '  '): string {
  // `emittedValue` is where a stored name becomes a CSS literal — a font key
  // becomes a stack, a pattern kind becomes a gradient. Applied for every token
  // so there is one place that knows the mapping, shared with the guard test.
  const lines = Object.entries(tokens).map(
    ([key, value]) => `${indent}--${key}: ${emittedValue(key, value)};`,
  );
  // The pattern is the one case that needs a SECOND property rather than a
  // different value: `background-image` cannot be selected from a custom
  // property, so the kind stays readable and the image rides alongside it.
  lines.push(
    `${indent}--bg-pattern-image: ${patternImage(tokens['bg-pattern-kind'])};`,
  );
  return lines.join('\n');
}

function block(selector: string, tokens: TokenMap): string {
  return `${selector} {\n${declarations(tokens)}\n}`;
}

/**
 * The whole stylesheet: one block per enabled theme, plus the two system blocks.
 *
 * The system blocks duplicate the values of the two mapped themes rather than
 * referencing them. ~1.4 KB, in exchange for needing no JavaScript at all — and
 * a CSS-level indirection is not available: custom properties cascade, so
 * `[data-theme=system] { --x: var(--from-other-theme) }` would need the other
 * theme's block to apply to the same element, which it does not.
 *
 * ## The site default also answers to a bare `:root`
 *
 * The default theme's block is emitted as `:root, :root[data-theme='<slug>']`,
 * so a document with NO `data-theme` attribute at all renders the site default.
 *
 * That is not a nicety, it is the whole first paint of the static build. There
 * is no server there to put the attribute in the markup, and the boot script
 * cannot know what the default is — so before this, a visitor with no cookie got
 * the bundle's built-in dark until `/api/branding` came back and JavaScript
 * corrected it. Measured at 383 ms on a local network, which is a black page
 * flipping to a pale one, in front of the visitor.
 *
 * This puts the answer in the one thing that already arrives before the first
 * paint: the render-blocking stylesheet in `<head>`. No request is added,
 * roughly no bytes are added — the selector gains eight characters — and the
 * correct first paint stops depending on JavaScript in EITHER build.
 *
 * Specificity keeps it honest. A bare `:root` is (0,1,0) and
 * `:root[data-theme='x']` is (0,2,0), so anyone who has chosen still wins,
 * including the member whose cookie the boot script applies a moment later.
 */
export function buildThemeCss(
  themes: ServableTheme[],
  mapping: { light: string; dark: string },
  /** The slug an unstyled document falls back to. `system` is allowed. */
  siteDefault: string,
): string {
  const bySlug = new Map(themes.map((t) => [t.slug, t]));

  /** Tokens for a slug, whether it names a built-in or a row. */
  const tokensFor = (slug: string): TokenMap => {
    if ((BUILT_IN_THEMES as readonly string[]).includes(slug)) {
      return resolveTokens(slug as BuiltInTheme, null);
    }
    const t = bySlug.get(slug);
    if (!t) return resolveTokens('dark', null);
    return resolveTokens(t.base, t.tokens);
  };

  const parts: string[] = [
    '/* Generated. Admin-defined themes; see apps/api/utils/themes.ts. */',
  ];

  // `@font-face` for every uploaded face any enabled theme names, before the
  // theme blocks so the declaration exists by the time a `font-family` refers to
  // it. Derived from the token values alone — no query — because the family name
  // is `ot-font-<id>` and the source is `/api/fonts/<id>`, both computed from the
  // id the token carries.
  const faces = fontFaceCss([
    ...themes.map((t) => resolveTokens(t.base, t.tokens)),
    tokensFor(mapping.light),
    tokensFor(mapping.dark),
  ]);
  if (faces) parts.push(faces);

  /**
   * The selector a theme answers to.
   *
   * The site default answers to a bare `:root` as well, so an unstyled document
   * — the static build's first paint — lands on it. See the note above.
   */
  const selectorFor = (slug: string) =>
    slug === siteDefault
      ? `:root, :root[data-theme='${slug}']`
      : `:root[data-theme='${slug}']`;

  for (const t of themes) {
    parts.push(selectorFor(t.slug) + ' {\n' + declarations(resolveTokens(t.base, t.tokens)) + '\n}');
    // The owner's free-form CSS, scoped to this theme. Stored unscoped so it can
    // also be emitted under `[data-theme='system']` below when this theme is one
    // of the halves — see `sanitiseCustomCss`.
    //
    // Not widened to a bare `:root` even when this is the default: the tokens
    // are what the first paint needs, and free-form CSS scoped to nothing at all
    // is a much larger blast radius for a much smaller gain. It applies the
    // moment the attribute lands.
    if (t.customCss) {
      parts.push(scopeCustomCss(t.customCss, t.slug));
    }
  }

  // A built-in as the site default has no row above to widen, so it gets its own
  // bare block. `dark` would work by accident — `main.css` already declares
  // `:root, :root[data-theme="dark"]` — but `light` would not, and relying on
  // one of the two matching the bundle's fallback is the kind of thing that
  // holds until somebody edits `main.css`.
  if ((BUILT_IN_THEMES as readonly string[]).includes(siteDefault)) {
    parts.push(block(':root', tokensFor(siteDefault)));
  }

  /** A mapped theme's custom CSS, so system mode is not a second-class theme. */
  const customFor = (slug: string): string | null =>
    bySlug.get(slug)?.customCss ?? null;

  // System mode. The light branch is unconditional so a browser that reports no
  // preference — or one whose user is in light mode — still gets something.
  parts.push(
    selectorFor(SYSTEM_THEME) + ' {\n' + declarations(tokensFor(mapping.light)) + '\n}',
  );
  const lightCustom = customFor(mapping.light);
  if (lightCustom) parts.push(scopeCustomCss(lightCustom, 'system'));

  const darkParts = [
    '@media (prefers-color-scheme: dark) {',
    `  ${selectorFor(SYSTEM_THEME)} {`,
    declarations(tokensFor(mapping.dark), '    '),
    '  }',
  ];
  // The dark half's custom CSS has to live INSIDE the media query, or it would
  // apply in light mode too — the one place where scoping by selector is not
  // enough on its own.
  const darkCustom = customFor(mapping.dark);
  if (darkCustom) {
    darkParts.push(
      scopeCustomCss(darkCustom, 'system')
        .split('\n')
        .map((l) => '  ' + l)
        .join('\n'),
    );
  }
  darkParts.push('}');
  parts.push(darkParts.join('\n'));

  return parts.join('\n\n') + '\n';
}

/** Everything `/api/theme.css` needs, in one place so the route stays thin. */
export async function themeStylesheet(): Promise<{
  css: string;
  version: string;
}> {
  const [themes, mapping, siteDefault, version] = await Promise.all([
    enabledThemes(),
    getSystemMapping(),
    getDefaultTheme(),
    getThemeVersion(),
  ]);
  return { css: buildThemeCss(themes, mapping, siteDefault), version };
}

/**
 * Point the site default and system mode away from `slug`, which is about to
 * stop being servable — deleted, or disabled.
 *
 * There are two doors into "nothing serves this slug any more" and only one of
 * them used to reset the pointers. Deleting did; disabling did not, so an owner
 * who turned off the theme that happened to be the site default left every
 * anonymous visitor on `<html data-theme='nocturne'>` with no `nocturne` block
 * in the stylesheet — the page falls through to whatever `:root` declares and
 * looks like the theme system is broken. Same for a system half, which quietly
 * resolves to the dark built-in. `PUT /themes/settings` refuses to point AT a
 * disabled theme, which is the same invariant seen from the other side; this is
 * the code that keeps the two doors honest.
 *
 * Writes are conditional, so calling this for a slug nothing references costs
 * three cached reads and no write.
 */
export async function releaseThemeReferences(slug: string): Promise<void> {
  const [siteDefault, system] = await Promise.all([
    getDefaultTheme(),
    getSystemMapping(),
  ]);

  if (siteDefault === slug) {
    await setSetting(SETTINGS_KEYS.THEME_DEFAULT, 'dark');
  }

  // The two halves, and the rule that says they must differ.
  //
  // Resetting one half to its built-in can collide with a half that already
  // points AT that built-in: `light: 'nocturne', dark: 'light'` is a legal
  // mapping, and releasing `nocturne` would leave both halves on `light`, so
  // `system` would resolve to one appearance whichever way the OS is set. That
  // is exactly what the rule exists to prevent, so the two are computed
  // together rather than in independent `if`s — the second reset has to see
  // what the first chose.
  let { light, dark } = system;
  if (light === slug) light = 'light';
  if (dark === slug) dark = 'dark';
  if (light === dark) {
    // Whichever half was NOT just released keeps its value; the other moves to
    // the opposite built-in.
    if (system.light === slug) dark = dark === 'light' ? 'dark' : 'light';
    else light = light === 'dark' ? 'light' : 'dark';
  }
  if (light !== system.light) {
    await setSetting(SETTINGS_KEYS.THEME_SYSTEM_LIGHT, light);
  }
  if (dark !== system.dark) {
    await setSetting(SETTINGS_KEYS.THEME_SYSTEM_DARK, dark);
  }
}

/** Slug shape. Reaches a CSS attribute selector, so it is validated, not trusted. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** The role ids a member holds, for `choosableFor`. */
export async function roleIdsFor(userId: string): Promise<string[]> {
  const rows = await db
    .select({ roleId: schema.userRoles.roleId })
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, userId));
  return rows.map((r) => r.roleId);
}

/**
 * Count the enabled themes and act on the answer, without a window in between.
 *
 * The cap used to be a read then a write, in autocommit: two requests arriving
 * at nine enabled themes both counted nine, both wrote, and the instance ended
 * up with eleven. That is not only one theme over — `enabledThemes()` has a
 * `.limit(MAX_ENABLED_THEMES)` while `PUT /themes/settings` validates against an
 * unlimited query, so the site default could point at the theme that falls off
 * the end and no block for it would be emitted at all.
 *
 * `pg_advisory_xact_lock` rather than a constraint, because the rule is "at most
 * ten rows with `enabled`" and Postgres has no way to express that declaratively.
 * The same lock the ownership transfer takes, on its own key: these two never
 * contend, and sharing a number would make them wait on each other for nothing.
 */
export const THEME_CAP_LOCK = 7415;

export async function withThemeCap<T>(
  wantsEnabled: boolean,
  /** Rows already enabled that this write is not adding — the row being edited. */
  exceptId: string | null,
  run: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    if (wantsEnabled) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${THEME_CAP_LOCK})`);
      const [{ n } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(schema.themes)
        .where(
          exceptId
            ? and(eq(schema.themes.enabled, true), ne(schema.themes.id, exceptId))
            : eq(schema.themes.enabled, true),
        );
      if (Number(n) >= MAX_ENABLED_THEMES) {
        throw createError({
          statusCode: 400,
          message: `At most ${MAX_ENABLED_THEMES} themes can be enabled at once. Disable one first, or create this as a draft.`,
        });
      }
    }
    return run(tx);
  });
}

/**
 * Themes that would be left gated on nobody if this role went away.
 *
 * `themes.required_roles` is a `jsonb` array, so no foreign key can hold it —
 * and a theme reserved to a role that no longer exists is worse than a dangling
 * reference. It is choosable by nobody, invisible to everyone including the
 * admin who made it, and the CHECK constraint cannot see it: the constraint
 * counts array length, not whether the ids resolve.
 *
 * So role deletion is refused while a theme names the role, the same way font
 * deletion is refused while a theme names the face. The admin then decides —
 * widen the theme, point it at another role, or delete it — and nothing changes
 * access implicitly. Silently opening a perk theme to everyone, or silently
 * turning it off for the members holding it, are both worse than a sentence
 * naming what is in the way.
 */
export async function themesRequiringRole(roleId: string): Promise<string[]> {
  const rows = await db
    .select({ name: schema.themes.name, requiredRoles: schema.themes.requiredRoles })
    .from(schema.themes)
    .where(eq(schema.themes.visibility, 'roles'));
  return rows
    .filter((r) => ((r.requiredRoles as string[] | null) ?? []).includes(roleId))
    .map((r) => r.name);
}

/** Guard used by the write paths: is this slug free and allowed? */
export async function slugAvailable(
  slug: string,
  exceptId?: string,
): Promise<boolean> {
  if (!SLUG_PATTERN.test(slug)) return false;
  if (RESERVED_SLUGS.includes(slug)) return false;
  const [row] = await db
    .select({ id: schema.themes.id })
    .from(schema.themes)
    .where(eq(schema.themes.slug, slug))
    .limit(1);
  // Free, or already held by the row being edited — a rename that keeps the
  // same slug must not collide with itself.
  return !row || row.id === exceptId;
}

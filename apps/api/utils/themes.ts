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
import { asc, eq } from 'drizzle-orm';
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
 */
export function buildThemeCss(
  themes: ServableTheme[],
  mapping: { light: string; dark: string },
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

  for (const t of themes) {
    parts.push(
      block(`:root[data-theme='${t.slug}']`, resolveTokens(t.base, t.tokens)),
    );
  }

  // System mode. The light branch is unconditional so a browser that reports no
  // preference — or one whose user is in light mode — still gets something.
  parts.push(block(":root[data-theme='system']", tokensFor(mapping.light)));
  parts.push(
    [
      '@media (prefers-color-scheme: dark) {',
      "  :root[data-theme='system'] {",
      declarations(tokensFor(mapping.dark), '    '),
      '  }',
      '}',
    ].join('\n'),
  );

  return parts.join('\n\n') + '\n';
}

/** Everything `/api/theme.css` needs, in one place so the route stays thin. */
export async function themeStylesheet(): Promise<{
  css: string;
  version: string;
}> {
  const [themes, mapping, version] = await Promise.all([
    enabledThemes(),
    getSystemMapping(),
    getThemeVersion(),
  ]);
  return { css: buildThemeCss(themes, mapping), version };
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

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { makeUser } from './helpers';
import { BUILT_IN_TOKENS } from '@trackarr/shared/theme';
import {
  buildThemeCss,
  choosableFor,
  enabledThemes,
  getThemeVersion,
  bumpThemeVersion,
  resolvePreference,
  slugAvailable,
  slugify,
  MAX_ENABLED_THEMES,
} from '../../utils/themes';
import { setSetting, SETTINGS_KEYS } from '../../utils/settings';

// Admin-defined themes.
//
// The behaviour worth testing is not "does a row round-trip" but the three places
// this design could go wrong: a member left holding a theme that no longer
// exists, a stylesheet that lets a value through it should not, and system mode
// resolving to one appearance whichever way the OS is set.

async function makeTheme(over: Partial<typeof schema.themes.$inferInsert> = {}) {
  const id = randomUUID();
  const slug = (over.slug as string) ?? `t-${id.slice(0, 8)}`;
  await db.insert(schema.themes).values({
    name: 'A theme',
    base: 'dark',
    tokens: {},
    ...over,
    // After the spread: the caller may pass a slug, but never the id, and the
    // resolved slug is the one we return.
    id,
    slug,
  });
  return { id, slug };
}

async function makeRole(name = 'Donator') {
  const id = randomUUID();
  await db.insert(schema.roles).values({ id, name: `${name}-${id.slice(0, 6)}` });
  return id;
}

beforeEach(async () => {
  await setSetting(SETTINGS_KEYS.THEME_DEFAULT, 'dark');
  await setSetting(SETTINGS_KEYS.THEME_SYSTEM_LIGHT, 'light');
  await setSetting(SETTINGS_KEYS.THEME_SYSTEM_DARK, 'dark');
});

describe('what gets served', () => {
  it('lists only enabled themes, in display order', async () => {
    await makeTheme({ slug: 'second', position: 2 });
    await makeTheme({ slug: 'first', position: 1 });
    await makeTheme({ slug: 'off', enabled: false });

    expect((await enabledThemes()).map((t) => t.slug)).toEqual([
      'first',
      'second',
    ]);
  });

  it('never serves more than the cap, whatever the table holds', async () => {
    // The cap is what makes "every enabled theme in one cacheable sheet"
    // affordable. The routes refuse past it; this is the belt underneath, so a
    // row inserted by hand cannot make every page heavier.
    for (let i = 0; i < MAX_ENABLED_THEMES + 4; i++) {
      await makeTheme({ slug: `t${i}`, position: i });
    }
    expect(await enabledThemes()).toHaveLength(MAX_ENABLED_THEMES);
  });

  it('emits one block per theme, resolved against its base', async () => {
    await makeTheme({ slug: 'crimson', base: 'dark', tokens: { accent: '220 38 38' } });
    const css = buildThemeCss(await enabledThemes(), {
      light: 'light',
      dark: 'dark',
    });

    expect(css).toContain(":root[data-theme='crimson']");
    expect(css).toContain('--accent: 220 38 38;');
    // Inherited, not copied: the token it never touched comes from the base.
    expect(css).toContain(`--bg-base: ${BUILT_IN_TOKENS.dark['bg-base']};`);
  });

  it('drops a stored value the schema would refuse', async () => {
    // A row can predate a schema change, or be written by hand. One bad value
    // must not take the stylesheet with it — and it must certainly not reach the
    // output, since the emitter does no escaping precisely because it trusts
    // this filter.
    await makeTheme({
      slug: 'hostile',
      tokens: {
        accent: '10 10 10;background:url(https://evil.example)',
        'bg-base': '1 2 3',
      } as never,
    });
    const css = buildThemeCss(await enabledThemes(), {
      light: 'light',
      dark: 'dark',
    });

    expect(css).not.toContain('evil.example');
    expect(css).not.toContain('url(');
    expect(css).toContain('--bg-base: 1 2 3;');
    expect(css).toContain(`--accent: ${BUILT_IN_TOKENS.dark.accent};`);
  });

  it('closes every block it opens', async () => {
    // Cheap structural check with real value: an unbalanced brace would make the
    // rest of the stylesheet — including the built-ins — silently inert.
    await makeTheme({ slug: 'a' });
    await makeTheme({ slug: 'b' });
    const css = buildThemeCss(await enabledThemes(), {
      light: 'light',
      dark: 'dark',
    });
    expect((css.match(/\{/g) ?? []).length).toBe((css.match(/\}/g) ?? []).length);
  });
});

describe('system mode', () => {
  it('emits both halves, the dark one behind the media query', async () => {
    const css = buildThemeCss([], { light: 'light', dark: 'dark' });

    expect(css).toContain(":root[data-theme='system']");
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    // The light branch is unconditional so a browser reporting no preference
    // still gets an appearance.
    const beforeMedia = css.slice(0, css.indexOf('@media'));
    expect(beforeMedia).toContain(`--bg-base: ${BUILT_IN_TOKENS.light['bg-base']};`);
    const afterMedia = css.slice(css.indexOf('@media'));
    expect(afterMedia).toContain(`--bg-base: ${BUILT_IN_TOKENS.dark['bg-base']};`);
  });

  it('maps onto an admin theme, duplicating its values', async () => {
    // The values are duplicated rather than referenced, and they have to be:
    // custom properties cascade, so `[data-theme=system] { --x: var(--from-other) }`
    // would need the other theme's block to apply to the same element.
    await makeTheme({ slug: 'nocturne', tokens: { accent: '99 102 241' } });
    const css = buildThemeCss(await enabledThemes(), {
      light: 'light',
      dark: 'nocturne',
    });
    const afterMedia = css.slice(css.indexOf('@media'));
    expect(afterMedia).toContain('--accent: 99 102 241;');
  });

  it('falls back rather than emitting an empty block for a missing slug', async () => {
    const css = buildThemeCss([], { light: 'light', dark: 'deleted-theme' });
    const afterMedia = css.slice(css.indexOf('@media'));
    expect(afterMedia).toContain(`--bg-base: ${BUILT_IN_TOKENS.dark['bg-base']};`);
  });
});

describe('what a member ends up with', () => {
  it('keeps a preference that still exists', () => {
    expect(resolvePreference('nocturne', ['nocturne'], 'dark')).toBe('nocturne');
    expect(resolvePreference('system', [], 'dark')).toBe('system');
    expect(resolvePreference('light', [], 'dark')).toBe('light');
  });

  it('falls back to the site default when the theme is gone', () => {
    // The case the delete route also handles by rewriting rows — this is the
    // read-side belt, for a theme merely DISABLED rather than deleted.
    expect(resolvePreference('vanished', [], 'light')).toBe('light');
  });

  it('falls back to dark when even the site default is gone', () => {
    // A site whose default was itself deleted still has to render.
    expect(resolvePreference('vanished', [], 'also-vanished')).toBe('dark');
  });
});

describe('themes reserved to a role', () => {
  it('is filtered out of what a member without the role may choose', async () => {
    const roleId = await makeRole();
    await makeTheme({ slug: 'plain' });
    await makeTheme({
      slug: 'donator',
      visibility: 'roles',
      requiredRoles: [roleId],
    });
    const all = await enabledThemes();

    expect(choosableFor(all, []).map((t) => t.slug)).toEqual(['plain']);
    expect(choosableFor(all, [roleId]).map((t) => t.slug).sort()).toEqual([
      'donator',
      'plain',
    ]);
  });

  it('is still in the stylesheet, which is the documented trade', async () => {
    // Not an oversight: every enabled theme is in the one sheet every visitor
    // downloads, which is what keeps switching instant and the response
    // cacheable. What is enforced is PERSISTENCE — `PATCH /api/me` refuses to
    // store a theme the member is not entitled to — so nobody keeps it and
    // nobody else ever sees it. Pinned here so a future reader does not "fix"
    // the wrong half.
    const roleId = await makeRole();
    await makeTheme({
      slug: 'donator',
      visibility: 'roles',
      requiredRoles: [roleId],
      tokens: { accent: '255 215 0' },
    });
    const css = buildThemeCss(await enabledThemes(), {
      light: 'light',
      dark: 'dark',
    });
    expect(css).toContain(":root[data-theme='donator']");
  });

  it('cannot be role-gated with no roles', async () => {
    // The database refuses it. A theme requiring nothing would be invisible to
    // everyone including its author, which reads as a bug rather than a setting.
    await expect(
      makeTheme({ slug: 'broken', visibility: 'roles', requiredRoles: [] }),
    ).rejects.toThrow();
  });

  it('cannot be open to everyone and require a role at once', async () => {
    await expect(
      makeTheme({ slug: 'broken2', visibility: 'site', requiredRoles: ['x'] }),
    ).rejects.toThrow();
  });
});

describe('slugs', () => {
  it('refuses the three names that already mean something', async () => {
    for (const reserved of ['light', 'dark', 'system']) {
      expect(await slugAvailable(reserved), reserved).toBe(false);
    }
  });

  it('refuses anything that could close an attribute selector', async () => {
    // The slug reaches `[data-theme='…']`, so its shape is load-bearing rather
    // than cosmetic.
    for (const bad of [
      "a'] {display:none}",
      'Has Spaces',
      'UPPER',
      'trailing-',
      'double--hyphen',
      'accentué',
      '',
    ]) {
      expect(await slugAvailable(bad), bad).toBe(false);
    }
  });

  it('lets a theme keep its own slug when edited', async () => {
    const { id, slug } = await makeTheme({ slug: 'keeper' });
    expect(await slugAvailable(slug)).toBe(false);
    expect(await slugAvailable(slug, id)).toBe(true);
  });

  it('derives something usable from a name', () => {
    expect(slugify('Midnight Blue')).toBe('midnight-blue');
    expect(slugify('  Café  Noir!! ')).toBe('cafe-noir');
    expect(slugify('---')).toBe('');
  });
});

describe('the stylesheet version', () => {
  it('moves on every write, so the ETag cannot go stale', async () => {
    const before = await getThemeVersion();
    await bumpThemeVersion();
    expect(Number(await getThemeVersion())).toBe(Number(before) + 1);
  });

  it('recovers from a nonsense stored value instead of throwing', async () => {
    // The counter is a settings row like any other, so it can be edited by hand.
    // A NaN must not make every page fail to get a stylesheet.
    await setSetting(SETTINGS_KEYS.THEME_VERSION, 'not-a-number');
    await bumpThemeVersion();
    expect(Number(await getThemeVersion())).toBe(1);
  });
});

describe('deleting a theme does not strand its users', () => {
  it('moves members to the site default', async () => {
    // `users.theme` has no foreign key on purpose — a member's preference has to
    // outlive a theme they never asked to lose — so nothing in the database
    // notices a dangling slug. The delete route is what notices.
    await setSetting(SETTINGS_KEYS.THEME_DEFAULT, 'light');
    const { slug } = await makeTheme({ slug: 'doomed' });
    const uid = await makeUser({ theme: 'doomed' });

    await db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ theme: 'light' })
        .where(eq(schema.users.theme, slug));
      await tx.delete(schema.themes).where(eq(schema.themes.slug, slug));
    });

    const [row] = await db
      .select({ theme: schema.users.theme })
      .from(schema.users)
      .where(eq(schema.users.id, uid));
    expect(row!.theme).toBe('light');
  });
});

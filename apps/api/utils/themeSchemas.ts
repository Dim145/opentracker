/**
 * Zod shapes for the theme routes, in one place.
 *
 * Separate from `utils/schemas.ts` because the token map needs the shared token
 * schema to validate, and `utils/schemas.ts` is imported by almost every route —
 * pulling the theme vocabulary in there would make it a dependency of the whole
 * application for the benefit of five files.
 *
 * The value-level check is `isValidTokenValue`, NOT a second regex. There are
 * already four hex-colour regexes in this codebase (`hexColourSchema` plus three
 * deliberately stricter call sites), and a fifth written here would drift from
 * the one the CSS emitter trusts. Whatever the emitter will accept is what a
 * route accepts.
 */
import { z } from 'zod';
import { BUILT_IN_THEMES } from '@trackarr/shared';
import { validateTokens } from '@trackarr/shared/theme';
import { SLUG_PATTERN } from './themes';

/**
 * A partial token map: only what diverges from the base.
 *
 * `superRefine` rather than a per-key schema, so an admin pasting an exported
 * theme gets every problem at once instead of fixing twenty-six one round trip
 * at a time.
 */
export const tokenMapSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, ctx) => {
    for (const issue of validateTokens(value)) {
      ctx.addIssue({
        code: 'custom',
        path: [issue.key],
        message:
          issue.reason === 'unknown-key'
            ? `Unknown token "${issue.key}"`
            : `Not a valid value for "${issue.key}"`,
      });
    }
  });

export const slugSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(SLUG_PATTERN, 'Lowercase letters, digits and single hyphens only');

/**
 * The visibility pair, checked together.
 *
 * The database has the same rule as a CHECK constraint. Both exist on purpose:
 * the constraint makes the bad state unrepresentable, and this makes the refusal
 * a sentence an admin can read instead of a 500 from Postgres.
 */
function visibilityShape(required: boolean) {
  return z
  .object({
    visibility: required
      ? z.enum(['site', 'roles'])
      : z.enum(['site', 'roles']).default('site'),
    requiredRoles: z.array(z.string().uuid()).max(20).optional().nullable(),
  })
  .refine(
    (v) => v.visibility === 'site' || (v.requiredRoles?.length ?? 0) > 0,
    {
      message: 'Pick at least one role, or make the theme available to everyone',
      path: ['requiredRoles'],
    },
  )
  .refine((v) => v.visibility === 'roles' || !v.requiredRoles?.length, {
    message: 'A theme available to everyone cannot also require a role',
    path: ['requiredRoles'],
  });
}

/**
 * Create may omit it and get `site`; UPDATE may not.
 *
 * The difference is not symmetry, it is a data-loss bug found in review. The
 * update route writes `visibility` unconditionally — deliberately, because the
 * pair only makes sense together — so a default of `site` turned "the caller
 * did not mention visibility" into "make this theme public", silently
 * un-gating a role-reserved theme on any partial update. Requiring it makes
 * that a 400 instead.
 *
 * A new theme is different: nothing is being downgraded, and `site` is the
 * right answer to a question nobody asked.
 */
const createVisibility = visibilityShape(false);
const updateVisibility = visibilityShape(true);

const themeFields = {
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).optional().nullable(),
  base: z.enum(BUILT_IN_THEMES),
  tokens: tokenMapSchema.optional(),
  enabled: z.boolean().optional(),
  position: z.number().int().min(0).max(999).optional(),
};

/**
 * `slug` is derived from the name on create and then frozen.
 *
 * It is what `users.theme` stores, so letting it change would silently orphan
 * every member holding it — and the alternative (rewriting their rows on rename)
 * makes a cosmetic edit into a write across the user table. Renaming the
 * DISPLAY name is free and is what an admin actually wants.
 */
export const createThemeSchema = z
  .object({
    ...themeFields,
    slug: slugSchema.optional(),
    /** Start from this theme's tokens. `light`/`dark` included. */
    duplicateOf: z.string().max(64).optional(),
  })
  .and(createVisibility);

export const updateThemeSchema = z
  .object({
    ...themeFields,
    name: themeFields.name.optional(),
    base: themeFields.base.optional(),
  })
  // Visibility is always sent as a pair, even on a partial update, because the
  // two fields only make sense together — accepting `visibility: 'roles'` on its
  // own would mean guessing which roles the admin meant.
  .and(updateVisibility);

/**
 * The site default and the two halves of `system` mode.
 *
 * The "not the same theme" rule is here rather than in the database because it
 * spans two settings rows, which a CHECK constraint cannot see. A system mode
 * that resolves to one appearance whichever way the OS is set is not a system
 * mode — it is a confusing way to pick a theme.
 */
export const themeSettingsSchema = z
  .object({
    themeDefault: z.string().max(64).optional(),
    systemLight: z.string().max(64).optional(),
    systemDark: z.string().max(64).optional(),
  })
  .refine((v) => !v.systemLight || !v.systemDark || v.systemLight !== v.systemDark, {
    message: 'The light and dark halves of system mode must be different themes',
    path: ['systemDark'],
  });

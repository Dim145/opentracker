/**
 * PATCH /api/me
 *
 * Update the logged-in user's editable profile + privacy preferences.
 *
 * Editable fields:
 *   - displayName: optional, ≤ 32 chars; falls back to `username` when
 *     null/empty. Stored as null when blank so downstream "do we have a
 *     display name" checks can use a single `?? username` fallback.
 *   - bio: free-form, ≤ 1000 chars. We deliberately don't run any
 *     server-side markdown — the consumers (profile pages) already
 *     render bios as plain text, so HTML/markdown in the column is just
 *     ignored at display time.
 *   - showLastSeen: when false, public profile responses redact the
 *     `lastSeen` timestamp. Moderator/admin views always see it.
 *   - anonymousUploads / hideDownloadHistory / restrictComments: the
 *     three privacy toggles. All three are account-level and take
 *     effect retroactively — they gate read paths and the comment
 *     handler rather than rewriting any stored row, so turning one off
 *     again restores the previous behaviour exactly.
 *
 * Auth: any logged-in user; rate-limited via the standard mutation
 * bucket so a hijacked session can't churn updates faster than the
 * cookie can be invalidated.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { BUILT_IN_THEMES, SYSTEM_THEME } from '@trackarr/shared';
import { choosableFor, enabledThemes, roleIdsFor } from '~~/utils/themes';
import { z } from 'zod';

const bodySchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .max(32, 'Display name must be 32 characters or fewer')
      .nullable()
      .optional(),
    bio: z
      .string()
      .trim()
      .max(1000, 'Bio must be 1000 characters or fewer')
      .nullable()
      .optional(),
    showLastSeen: z.boolean().optional(),
    // Opt-in to the XXX category tree. Defaults false; the toggle in
    // settings.vue flips this and the read paths immediately stop
    // returning adult-tagged categories / torrents.
    showAdultContent: z.boolean().optional(),
    messagingReadReceipts: z.boolean().optional(),
    // Detach the uploader's name from their releases, for other
    // members and for federated peers. Staff still see it.
    anonymousUploads: z.boolean().optional(),
    // Stop serving the member's own snatch list. A display
    // preference: `hnr_tracking` keeps being written either way.
    hideDownloadHistory: z.boolean().optional(),
    // Demand a minimum account age from anyone commenting on this
    // member's uploads.
    restrictComments: z.boolean().optional(),
    // Let a federated partner read this member's reputation (ratio,
    // volumes, member-since) over the `accounts` scope. Off by default.
    shareReputationFederated: z.boolean().optional(),
    /**
     * `system`, a built-in, an admin-defined slug — or `null`.
     *
     * `null` is how a member goes back to following the site default, and it is
     * a real choice rather than a cleared field: they then move whenever the
     * owner changes the default. Distinct from OMITTING the key, which leaves
     * the stored preference untouched like every other field here.
     *
     * A string rather than an enum, because the valid set lives in the database
     * and changes while the process runs — a union would be a reassuring type
     * in front of an unvalidated write. The real check is below, against the
     * themes this member may actually choose, and it is the ONLY place
     * role-gated themes are enforced: the served stylesheet carries every
     * enabled theme, so what is protected is persistence, not visibility.
     */
    theme: z
      .string()
      .max(64)
      .regex(/^[a-z0-9-]+$/, 'Not a theme name')
      .nullable()
      .optional(),
    // Language preference — must match one of the locale bundles
    // shipped under `apps/web/i18n/locales/`. Adding a locale means
    // adding it to this enum AND dropping a JSON file; the DB column
    // is free-form so historical rows referencing a removed locale
    // are still readable (they fall back to `defaultLocale` at boot).
    language: z.enum(['en', 'fr']).optional(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const body = await readValidatedBody(event, bodySchema.parse);

  // Build the SET clause incrementally so omitted keys don't get
  // wiped to null (PATCH semantics).
  const updates: Partial<{
    displayName: string | null;
    bio: string | null;
    showLastSeen: boolean;
    showAdultContent: boolean;
    messagingReadReceipts: boolean;
    anonymousUploads: boolean;
    hideDownloadHistory: boolean;
    restrictComments: boolean;
    shareReputationFederated: boolean;
    theme: string | null;
    language: 'en' | 'fr';
  }> = {};

  if (body.displayName !== undefined) {
    // Coerce empty strings to null so the column is consistent.
    updates.displayName = body.displayName?.trim() || null;
  }
  if (body.bio !== undefined) {
    updates.bio = body.bio?.trim() || null;
  }
  if (body.showLastSeen !== undefined) {
    updates.showLastSeen = body.showLastSeen;
  }
  if (body.messagingReadReceipts !== undefined) {
    updates.messagingReadReceipts = body.messagingReadReceipts;
  }
  if (body.showAdultContent !== undefined) {
    updates.showAdultContent = body.showAdultContent;
  }
  if (body.anonymousUploads !== undefined) {
    updates.anonymousUploads = body.anonymousUploads;
  }
  if (body.hideDownloadHistory !== undefined) {
    updates.hideDownloadHistory = body.hideDownloadHistory;
  }
  if (body.restrictComments !== undefined) {
    updates.restrictComments = body.restrictComments;
  }
  if (body.shareReputationFederated !== undefined) {
    updates.shareReputationFederated = body.shareReputationFederated;
  }
  if (body.theme === null) {
    // Back to following the site default. No entitlement check: "whatever the
    // owner picked" is available to everyone by definition, and the owner is
    // already prevented from defaulting the site to something that does not
    // exist or is not enabled.
    updates.theme = null;
  } else if (body.theme !== undefined) {
    const themes = await enabledThemes();
    const choosable = choosableFor(themes, await roleIdsFor(user.id));
    const allowed = new Set<string>([
      SYSTEM_THEME,
      ...BUILT_IN_THEMES,
      ...choosable.map((t) => t.slug),
    ]);
    if (!allowed.has(body.theme)) {
      throw createError({
        statusCode: 400,
        // Deliberately one message for "no such theme" and "not yours": a
        // reserved theme is a perk, and confirming its existence to somebody
        // who cannot have it is a small unkindness with no upside.
        message: 'That theme is not available to you',
      });
    }
    updates.theme = body.theme;
  }
  if (body.language !== undefined) {
    updates.language = body.language;
  }

  if (Object.keys(updates).length === 0) {
    // Nothing to do — return 200 with current state rather than 400 so
    // an idempotent retry from the client is a no-op.
    return { success: true, updated: 0 };
  }

  const [updated] = await db
    .update(schema.users)
    .set(updates)
    .where(eq(schema.users.id, user.id))
    .returning({
      displayName: schema.users.displayName,
      bio: schema.users.bio,
      showLastSeen: schema.users.showLastSeen,
      showAdultContent: schema.users.showAdultContent,
      anonymousUploads: schema.users.anonymousUploads,
      hideDownloadHistory: schema.users.hideDownloadHistory,
      restrictComments: schema.users.restrictComments,
      shareReputationFederated: schema.users.shareReputationFederated,
      theme: schema.users.theme,
      language: schema.users.language,
    });

  if (!updated) {
    throw createError({ statusCode: 404, message: 'User not found' });
  }

  // Refresh the session in place when display name, theme or language
  // changed so the navbar / theme observer / i18n bootstrapper (which
  // read from the session, not from /api/me) reflect the new value on
  // the next /api/auth/status poll without waiting for a re-login.
  if ('displayName' in updates || 'theme' in updates || 'language' in updates) {
    await setUserSession(event, {
      user: {
        ...user,
        displayName: updated.displayName,
        theme: updated.theme,
        language: updated.language,
      },
      loggedInAt: Date.now(),
    });
  }

  return {
    success: true,
    updated: Object.keys(updates).length,
    displayName: updated.displayName,
    bio: updated.bio,
    showLastSeen: updated.showLastSeen,
    showAdultContent: updated.showAdultContent,
    theme: updated.theme,
    language: updated.language,
  };
});

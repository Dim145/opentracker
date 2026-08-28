/**
 * The two things the theme list and the theme editor both have to do.
 *
 * They live on separate pages now — the editor is `/admin/themes/<id>` because
 * forty-seven fields, a font panel and a CSS editor are not a section of a list
 * — and these two are the only code the split would otherwise have duplicated.
 * Duplicating them is how the list and the editor end up disagreeing about what
 * an error says, or one of them forgetting to refresh the stylesheet.
 */
export function useThemeAdmin() {
  const { t } = useI18n();

  /** The message the API sent, or a generic one. Never the raw exception. */
  function messageOf(e: unknown): string {
    const d = (e as { data?: { message?: string }; message?: string }) ?? {};
    return d.data?.message || d.message || t('admin.themes.saveFailed');
  }

  /**
   * Re-fetch `/api/theme.css` after a write.
   *
   * The response is cached for a minute with an ETag, so a plain reload of the
   * document would very likely serve the previous version. Swapping the `<link>`
   * href with a cache-busting query is the narrow way to make the page show what
   * was just saved without reloading it.
   */
  function reloadThemeStylesheet() {
    if (!import.meta.client) return;
    const link = document.querySelector<HTMLLinkElement>(
      'link[rel="stylesheet"][href^="/api/theme.css"]',
    );
    if (link) link.href = `/api/theme.css?v=${Date.now()}`;
  }

  return { messageOf, reloadThemeStylesheet };
}

/** One theme, as `GET /api/admin/themes` lists it. */
export interface ThemeRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  base: 'light' | 'dark';
  tokens: Record<string, string>;
  enabled: boolean;
  position: number;
  visibility: string;
  requiredRoles: string[] | null;
}

/** A face the owner uploaded, for one of the three font roles. */
export interface UploadedFont {
  id: string;
  family: string;
  role: string;
  bytes: number;
}

export interface ThemeAdminPayload {
  themes: ThemeRow[];
  settings: { themeDefault: string; systemLight: string; systemDark: string };
  maxEnabled: number;
  enabledCount: number;
  roles: Array<{ id: string; name: string }>;
  fonts: UploadedFont[];
}

/** The empty payload both pages start from, so neither renders undefined. */
export function emptyThemeAdminPayload(): ThemeAdminPayload {
  return {
    themes: [],
    settings: { themeDefault: 'dark', systemLight: 'light', systemDark: 'dark' },
    maxEnabled: 10,
    enabledCount: 0,
    roles: [],
    fonts: [],
  };
}

/**
 * A theme being edited, before it is a row.
 *
 * Shared because the LIST creates one too — importing a file and duplicating a
 * theme both hand a partial draft to the editor page through `useState`, and a
 * second definition on that side is how the two would come to disagree.
 */
export interface Draft {
  id: string | null;
  slug: string | null;
  name: string;
  description: string;
  base: 'light' | 'dark';
  tokens: Record<string, string>;
  enabled: boolean;
  visibility: string;
  requiredRoles: string[];
  duplicateOf?: string;
}

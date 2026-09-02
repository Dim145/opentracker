<template>
  <div class="space-y-6">
    <!-- ── Site-wide settings ─────────────────────────────────────── -->
    <div class="card">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <Icon name="ph:palette" class="text-text-muted" />
          <h3 class="text-xs font-bold uppercase tracking-wider text-text-primary">
            {{ $t('admin.themes.settingsTitle') }}
          </h3>
        </div>
      </div>
      <div class="card-body">
        <SettingsGroup
          :label="$t('admin.themes.defaultLabel')"
          :description="$t('admin.themes.defaultDescription')"
        >
          <select v-model="settings.themeDefault" class="input">
            <option value="system">{{ $t('admin.themes.systemOption') }}</option>
            <option v-for="o in pickable" :key="o.slug" :value="o.slug">
              {{ o.name }}
            </option>
          </select>
        </SettingsGroup>

        <SettingsGroup
          :label="$t('admin.themes.systemLabel')"
          :description="$t('admin.themes.systemDescription')"
        >
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block">
              <span class="block text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1">
                <Icon name="ph:sun-bold" /> {{ $t('admin.themes.whenLight') }}
              </span>
              <select v-model="settings.systemLight" class="input">
                <option v-for="o in pickable" :key="o.slug" :value="o.slug">
                  {{ o.name }}
                </option>
              </select>
            </label>
            <label class="block">
              <span class="block text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1">
                <Icon name="ph:moon-stars-bold" /> {{ $t('admin.themes.whenDark') }}
              </span>
              <select v-model="settings.systemDark" class="input">
                <option v-for="o in pickable" :key="o.slug" :value="o.slug">
                  {{ o.name }}
                </option>
              </select>
            </label>
          </div>
          <p v-if="sameSystemHalves" class="mt-2 text-xs text-error">
            {{ $t('admin.themes.systemMustDiffer') }}
          </p>
        </SettingsGroup>

        <div class="flex items-center gap-3 pt-4">
          <button
            class="btn btn-primary btn-sm"
            :disabled="savingSettings || sameSystemHalves"
            @click="saveSettings"
          >
            <Icon name="ph:check-bold" /> {{ $t('common.save') }}
          </button>
          <span v-if="settingsSaved" class="text-xs text-success">
            {{ $t('common.saved') }}
          </span>
          <span v-if="settingsError" class="text-xs text-error">{{ settingsError }}</span>
        </div>
      </div>
    </div>

    <!-- ── The list ───────────────────────────────────────────────── -->
    <div class="card">
      <div class="card-header flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <Icon name="ph:swatches" class="text-text-muted" />
          <h3 class="text-xs font-bold uppercase tracking-wider text-text-primary">
            {{ $t('admin.themes.listTitle') }}
          </h3>
          <span class="text-[10px] font-mono text-text-faint">
            {{ $t('admin.themes.enabledCount', { n: enabledCount, max: maxEnabled }) }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn btn-sm" @click="importFile?.click()">
            <Icon name="ph:upload-simple-bold" /> {{ $t('admin.themes.import') }}
          </button>
          <input
            ref="importFile"
            type="file"
            accept="application/json,.json"
            class="hidden"
            @change="onImport"
          />
          <NuxtLink to="/admin/themes/new" class="btn btn-primary btn-sm">
            <Icon name="ph:plus-bold" /> {{ $t('admin.themes.create') }}
          </NuxtLink>
        </div>
      </div>

      <div class="card-body">
        <p v-if="!themes.length" class="text-sm text-text-muted py-6 text-center">
          {{ $t('admin.themes.empty') }}
        </p>

        <ul v-else class="flex flex-col gap-2">
          <li
            v-for="t in themes"
            :key="t.id"
            class="theme-row"
            :class="{ 'theme-row--off': !t.enabled }"
          >
            <span class="theme-swatches" :title="t.slug">
              <span
                v-for="k in ['bg-base', 'bg-surface', 'accent', 'fg-default']"
                :key="k"
                class="theme-swatch"
                :style="{ background: `rgb(${resolvedFor(t)[k]})` }"
              />
            </span>

            <span class="theme-ident">
              <span class="theme-name">{{ t.name }}</span>
              <code class="theme-slug">{{ t.slug }}</code>
            </span>

            <span class="theme-badges">
              <span class="theme-badge">{{ t.base }}</span>
              <span v-if="t.visibility === 'roles'" class="theme-badge theme-badge--role">
                <Icon name="ph:lock-simple-bold" />
                {{ roleNames(t.requiredRoles) }}
              </span>
              <span
                v-for="w in warningsFor(t)"
                :key="w.pair.what"
                class="theme-badge theme-badge--warn"
                :title="$t('admin.themes.contrastDetail', {
                  what: w.pair.what,
                  ratio: w.ratio,
                  required: w.required,
                })"
              >
                <Icon name="ph:warning-bold" /> {{ w.pair.what }}
              </span>
            </span>

            <span class="theme-actions">
              <NuxtLink
                :to="`/admin/themes/${t.id}`"
                class="theme-act"
                :title="$t('admin.themes.edit')"
              >
                <Icon name="ph:pencil-simple-bold" />
              </NuxtLink>
              <button
                class="theme-act"
                :title="$t('admin.themes.duplicate')"
                @click="duplicate(t.slug, t.name)"
              >
                <Icon name="ph:copy-bold" />
              </button>
              <button class="theme-act" :title="$t('admin.themes.export')" @click="exportOne(t)">
                <Icon name="ph:download-simple-bold" />
              </button>
              <button
                class="theme-act"
                :title="t.enabled ? $t('admin.themes.disable') : $t('admin.themes.enable')"
                @click="toggleEnabled(t)"
              >
                <Icon :name="t.enabled ? 'ph:eye-bold' : 'ph:eye-slash-bold'" />
              </button>
              <button
                class="theme-act theme-act--danger"
                :title="$t('admin.themes.delete')"
                @click="remove(t)"
              >
                <Icon name="ph:trash-bold" />
              </button>
            </span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The theme list, and the two settings that point at one.
 *
 * Editing lives at `/admin/themes/<id>` rather than in a panel below — see
 * `AdminThemeEditor`. What is left here is the part that is genuinely a list:
 * which themes exist, which are on, which is the default, and the writes that
 * are one click rather than a form.
 */
import {
  contrastWarnings,
  resolveTokens,
  validateTokens,
} from '@trackarr/shared/theme';
import {
  emptyThemeAdminPayload,
  useThemeAdmin,
  type Draft,
  type ThemeAdminPayload,
  type ThemeRow,
} from '~/composables/useThemeAdmin';

const { t } = useI18n();
const confirm = useConfirm();
const router = useRouter();
const { messageOf, reloadThemeStylesheet } = useThemeAdmin();

/** Set here, read by the editor page on arrival. See `AdminThemeEditor`. */
const pendingImport = useState<Partial<Draft> | null>('theme-import', () => null);

const { data, refresh } = await useFetch<ThemeAdminPayload>('/api/admin/themes', {
  default: emptyThemeAdminPayload,
});

const themes = computed(() => data.value.themes);
const roles = computed(() => data.value.roles);
const maxEnabled = computed(() => data.value.maxEnabled);
const enabledCount = computed(() => themes.value.filter((x) => x.enabled).length);

/** Every slug an admin may point a setting at: the built-ins plus enabled rows. */
const pickable = computed(() => [
  { slug: 'light', name: 'Light (built-in)' },
  { slug: 'dark', name: 'Dark (built-in)' },
  ...themes.value.filter((x) => x.enabled).map((x) => ({ slug: x.slug, name: x.name })),
]);

function resolvedFor(row: { base: 'light' | 'dark'; tokens: Record<string, string> }) {
  return resolveTokens(row.base, row.tokens);
}
function warningsFor(row: ThemeRow) {
  return contrastWarnings(resolvedFor(row));
}

function roleNames(ids: string[] | null): string {
  if (!ids?.length) return '';
  const byId = new Map(roles.value.map((r) => [r.id, r.name]));
  return ids.map((i) => byId.get(i) ?? '?').join(', ');
}
// ── Site settings ────────────────────────────────────────────────────
const settings = ref({ themeDefault: 'dark', systemLight: 'light', systemDark: 'dark' });

/** Vrai dès que les trois listes déroulantes s'écartent de ce que le serveur a
 *  renvoyé — donc dès que l'opérateur a touché à l'une d'elles. */
const settingsDirty = computed(() => {
  const src = data.value.settings;
  if (!src) return false;
  return (
    settings.value.themeDefault !== src.themeDefault ||
    settings.value.systemLight !== src.systemLight ||
    settings.value.systemDark !== src.systemDark
  );
});

watch(
  () => data.value.settings,
  (s) => {
    // Toute action sur la liste des thèmes (activer, supprimer, importer)
    // appelle `refresh()`, ce qui rejouait cette recopie et remettait les trois
    // listes déroulantes à la valeur enregistrée. Un opérateur qui choisissait
    // son thème par défaut PUIS coupait un thème avant d'enregistrer voyait son
    // choix disparaître — et rien ne le disait, les listes se contentant de
    // revenir en arrière.
    if (!s || settingsDirty.value) return;
    settings.value = { ...s };
  },
  { immediate: true, deep: true },
);
const sameSystemHalves = computed(
  () => settings.value.systemLight === settings.value.systemDark,
);
const savingSettings = ref(false);
const settingsSaved = ref(false);
const settingsError = ref('');

async function saveSettings() {
  savingSettings.value = true;
  settingsError.value = '';
  try {
    await $fetch('/api/admin/themes/settings', { method: 'PUT', body: settings.value });
    settingsSaved.value = true;
    setTimeout(() => (settingsSaved.value = false), 2000);
    await refresh();
  } catch (e) {
    settingsError.value = messageOf(e);
  } finally {
    savingSettings.value = false;
  }
}


async function toggleEnabled(row: ThemeRow) {
  // Couper un thème le retire de TOUS les membres qui l'avaient choisi : ils
  // basculent sur le thème par défaut à leur prochaine page, sans rien avoir
  // demandé. Un clic sur une icône œil de 28 px le faisait sans un mot, à
  // côté d'une suppression qui, elle, demandait confirmation.
  if (row.enabled) {
    const ok = await confirm({
      title: t('admin.themes.disable'),
      message: t('admin.themes.confirmDisable', { name: row.name }),
      confirmText: t('admin.themes.disable'),
      destructive: true,
    });
    if (!ok) return;
  }
  try {
    await $fetch(`/api/admin/themes/${row.id}`, {
      method: 'PUT',
      body: {
        enabled: !row.enabled,
        visibility: row.visibility,
        requiredRoles: row.visibility === 'roles' ? row.requiredRoles : null,
      },
    });
    await refresh();
    await reloadThemeStylesheet();
  } catch (e) {
    settingsError.value = messageOf(e);
  }
}

/**
 * Open the editor on a copy.
 *
 * The copy is not made here: `duplicateOf` tells the create route which theme's
 * tokens to start from, so the duplicate is one POST rather than a client-side
 * clone that could drift from what the server would have produced.
 */
function duplicate(slug: string, name: string) {
  pendingImport.value = {
    name: t('admin.themes.copyOf', { name }),
    duplicateOf: slug,
  };
  void router.push('/admin/themes/new');
}

async function remove(row: ThemeRow) {
  // Le `confirm()` du navigateur : hors thème, non traduit dans ses boutons,
  // et bloquant. Le site a son propre dialogue depuis longtemps ; c'était le
  // dernier appel natif de la console.
  const ok = await confirm({
    title: t('admin.themes.delete'),
    message: t('admin.themes.confirmDelete', { name: row.name }),
    confirmText: t('admin.themes.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await $fetch(`/api/admin/themes/${row.id}`, { method: 'DELETE' });
    await refresh();
    await reloadThemeStylesheet();
  } catch (e) {
    settingsError.value = messageOf(e);
  }
}

// ── Import / export ──────────────────────────────────────────────────
const importFile = ref<HTMLInputElement | null>(null);

function exportOne(row: ThemeRow) {
  // Only what the theme actually says — name, base and its divergences. Exporting
  // the resolved set would produce a file that never tracks the built-ins again
  // when imported, which is the same fork this design exists to avoid.
  const doc = {
    trackarrTheme: 1,
    name: row.name,
    description: row.description,
    base: row.base,
    tokens: row.tokens,
  };
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${row.slug}.trackarr-theme.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function onImport(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  (ev.target as HTMLInputElement).value = '';
  try {
    const doc = JSON.parse(await file.text()) as {
      name?: string;
      description?: string | null;
      base?: 'light' | 'dark';
      tokens?: Record<string, string>;
    };
    // Checked here, not only on save.
    //
    // An imported theme is a file from somewhere else — the guide calls that out
    // as the reason raw CSS is parsed rather than trusted — and the editor puts
    // every token straight onto the live document when preview is on. So a file
    // that never gets saved still reaches `documentElement.style`, and an
    // unchecked value there is the owner's own browser doing what the file says.
    // Review found this reading the other way round: the guide already promised
    // an import is refused with every problem listed at once, and only the save
    // was doing that.
    const problems = validateTokens(doc.tokens ?? {});
    if (problems.length) {
      settingsError.value = t('admin.themes.importInvalid', {
        problems: problems
          .slice(0, 6)
          .map((p) =>
            p.reason === 'unknown-key'
              ? `${p.key} (unknown)`
              : `${p.key} (bad value)`,
          )
          .join(', ') + (problems.length > 6 ? `, +${problems.length - 6}` : ''),
      });
      return;
    }

    // Loaded into the editor rather than saved outright: an imported theme is
    // somebody else's work on somebody else's palette, and the contrast warnings
    // are worth reading before it goes live. The server validates it again on
    // save, so this is convenience as much as it is a check.
    // Handed to the editor page rather than opened in place: the editor is
    // where a theme is read before it goes live, and that is now a route.
    pendingImport.value = {
      name: doc.name || file.name.replace(/\.json$/i, ''),
      description: doc.description ?? '',
      base: doc.base === 'light' ? 'light' : 'dark',
      tokens: doc.tokens ?? {},
    };
    void router.push('/admin/themes/new');
  } catch {
    settingsError.value = t('admin.themes.importFailed');
  }
}

</script>

<style scoped>
.field-label {
  display: block;
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.14em * var(--tracking-scale));
  color: rgb(var(--fg-muted));
  margin-bottom: 0.25rem;
}
.field-help {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.6875rem;
  color: rgb(var(--fg-subtle));
}
.theme-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated) / 0.5);
}
.theme-row--off { opacity: 0.55; }

.theme-swatches { display: flex; flex: none; }
.theme-swatch {
  width: 0.9rem;
  height: 1.6rem;
  border: 1px solid rgb(var(--line-strong));
  margin-left: -1px;
}
.theme-swatch:first-child { border-radius: var(--radius-sm) 0 0 var(--radius-sm); margin-left: 0; }
.theme-swatch:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }

.theme-ident { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.theme-name { font-weight: 600; font-size: 0.875rem; }
.theme-slug {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: rgb(var(--fg-faint));
}
.theme-badges { display: flex; flex-wrap: wrap; gap: 0.3rem; flex: none; }
.theme-badge {
  font-family: var(--font-mono);
  font-size: 0.5938rem;
  text-transform: uppercase;
  letter-spacing: calc(0.08em * var(--tracking-scale));
  padding: 0.15rem 0.4rem;
  border-radius: var(--radius-sm);
  background: rgb(var(--fg-default) / 0.07);
  color: rgb(var(--fg-muted));
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}
.theme-badge--role { color: rgb(var(--info)); background: rgb(var(--info) / 0.12); }
.theme-badge--warn { color: rgb(var(--warning)); background: rgb(var(--warning) / 0.12); }

.theme-actions { display: flex; gap: 0.2rem; flex: none; }
.theme-act {
  padding: 0.3rem;
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-muted));
  transition: background-color var(--dur-2), color var(--dur-2);
}
.theme-act:hover { background: rgb(var(--fg-default) / 0.08); color: rgb(var(--fg-default)); }
.theme-act--danger:hover { color: rgb(var(--danger)); background: rgb(var(--danger) / 0.1); }
</style>

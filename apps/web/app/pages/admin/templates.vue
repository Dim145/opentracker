<template>
  <!--
    Site listing templates — the catalogue every member is offered in the
    upload wizard, next to the built-in default layout.

    Members cannot put anything here. This is the only surface that writes a
    `site` row, and the routes behind it sit behind `requireAdminSession`.

    Structurally the same page as /templates (same cards, same badges, same
    editor modal) because it IS the same object being edited; what differs is
    who it belongs to and therefore what the copy says. The editor is reused
    with `endpoint="/api/admin/templates"` rather than cloned — one grammar
    check, one preview, one variables palette.
  -->
  <div class="admin-page">
    <!-- No title of its own: the admin shell already renders the page's h1 and
         its one-line description for every sub-page (see pages/admin.vue), so
         repeating them here produced a second h1 and said the same thing three
         times. What survives is the part the nav description cannot carry —
         that members have no way in, and that their copies are untouched. -->
    <header class="admin-head">
      <p class="admin-lede">{{ $t('admin.templates.lede') }}</p>
      <button type="button" class="btn btn-sm btn-primary" @click="openCreate">
        <Icon name="ph:plus-bold" class="text-sm" />
        {{ $t('admin.templates.actions.add') }}
      </button>
    </header>

    <!-- Only the first load gets the spinner: `pending` is true on every
         refresh too, and tearing the list down after each save makes the
         page jump on exactly the actions that should feel settled. -->
    <div v-if="pending && !data" class="py-16 flex justify-center">
      <Icon name="ph:circle-notch" class="animate-spin text-2xl text-text-muted" />
    </div>

    <p v-else-if="loadError" class="tplad-empty">
      {{ $t('admin.templates.loadFailed') }}
    </p>

    <p v-else-if="!rows.length" class="tplad-empty">
      {{ $t('admin.templates.empty') }}
    </p>

    <div v-else class="tplad-grid">
      <article v-for="row in rows" :key="row.id" class="tplad-card">
        <div class="tplad-card-top">
          <h2 class="tplad-name">{{ row.name }}</h2>
          <span class="tplad-badge">{{ $t(`templates.categories.${row.category}`) }}</span>
        </div>
        <p v-if="row.description" class="tplad-desc">{{ row.description }}</p>
        <p v-else class="tplad-desc tplad-desc--none">{{ $t('templates.noDescription') }}</p>
        <p class="tplad-meta">
          <span>{{ $t('templates.meta.chars', { n: row.content.length }) }}</span>
          <span aria-hidden="true">·</span>
          <!-- "who put this in front of the whole site", and it survives the
               account being deleted as an explicit unknown rather than as a
               blank. -->
          <span>
            {{
              row.createdBy?.username
                ? $t('admin.templates.meta.addedBy', { name: row.createdBy.username })
                : $t('admin.templates.meta.addedByUnknown')
            }}
          </span>
          <span aria-hidden="true">·</span>
          <span>{{ $t('templates.meta.updated', { date: formatDate(row.updatedAt) }) }}</span>
        </p>
        <div class="tplad-actions">
          <button type="button" class="btn btn-xs btn-ghost" @click="openEdit(row)">
            <Icon name="ph:pencil-simple" class="text-sm" />
            {{ $t('common.edit') }}
          </button>
          <button
            type="button"
            class="btn btn-xs btn-ghost text-error"
            :aria-label="$t('admin.templates.actions.removeNamed', { name: row.name })"
            @click="confirmRemove(row)"
          >
            <Icon name="ph:trash" class="text-sm" />
            {{ $t('common.delete') }}
          </button>
        </div>
      </article>
    </div>

    <TemplateEditorModal
      v-model="editorOpen"
      :template="editing"
      :initial-content="seedContent"
      endpoint="/api/admin/templates"
      @saved="onSaved"
      @delete="onEditorDelete"
    />
  </div>
</template>

<script setup lang="ts">
import { DEFAULT_FICHE_TEMPLATE } from '~/utils/ficheTemplate';
import type { FicheTemplateRow, SiteTemplateRow } from '~/utils/ficheTemplateApi';

definePageMeta({ middleware: 'admin' });

const { t, locale } = useI18n();
const notifications = useNotificationStore();
const confirm = useConfirm();

useHead({ title: () => t('admin.templates.title') });

const { data, pending, refresh, error } = await useFetch<{ data: SiteTemplateRow[] }>(
  '/api/admin/templates',
);

const loadError = computed(() => Boolean(error.value));
const rows = computed(() => data.value?.data ?? []);

// ── Editor ──────────────────────────────────────────────────────
const editorOpen = ref(false);
const editing = ref<FicheTemplateRow | null>(null);
const seedContent = ref('');

/**
 * The editor speaks `FicheTemplateRow`; this route returns `SiteTemplateRow`.
 * Adapting here rather than widening the component's prop keeps the editor's
 * contract honest — it edits a template, and the fields it does not need are
 * filled with the only values a site row can legally hold (no owner, never
 * anybody's personal default, and `canEdit` true because reaching this page
 * already required an admin session).
 */
function asEditorRow(row: SiteTemplateRow): FicheTemplateRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    content: row.content,
    visibility: 'site',
    isDefault: false,
    isMine: false,
    canEdit: true,
    owner: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function openCreate() {
  editing.value = null;
  // A new catalogue entry starts from the built-in layout rather than from an
  // empty box: the point of the catalogue is variations on the house style,
  // and starting from nothing means starting by pasting the default in.
  seedContent.value = DEFAULT_FICHE_TEMPLATE;
  editorOpen.value = true;
}

function openEdit(row: SiteTemplateRow) {
  editing.value = asEditorRow(row);
  seedContent.value = '';
  editorOpen.value = true;
}

async function onSaved() {
  editorOpen.value = false;
  await refresh();
}

/**
 * The editor shows a delete button for any row it considers writable, and it
 * only emits — the parent decides what deleting means. Without this the
 * button was inert, which is worse than absent.
 */
async function onEditorDelete() {
  const row = rows.value.find((r) => r.id === editing.value?.id);
  if (!row) return;
  editorOpen.value = false;
  await confirmRemove(row);
}

// ── Removal ─────────────────────────────────────────────────────
async function confirmRemove(row: SiteTemplateRow) {
  const ok = await confirm({
    title: t('admin.templates.confirm.removeTitle'),
    message: t('admin.templates.confirm.removeMessage', { name: row.name }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await $fetch(`/api/admin/templates/${row.id}`, { method: 'DELETE' });
    notifications.success(t('admin.templates.toasts.removed'));
    await refresh();
  } catch (err: unknown) {
    const e = err as { data?: { message?: string } };
    notifications.error(e?.data?.message || t('admin.templates.toasts.removeFailed'));
  }
}

// ── Formatting ──────────────────────────────────────────────────
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale.value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
</script>

<style scoped>
.admin-page {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.admin-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.admin-lede {
  max-width: 58ch;
  font-size: 0.82rem;
  line-height: 1.6;
  color: rgb(var(--fg-muted));
}

/* Same intrinsic grid as /templates — no breakpoint, and `min(100%, …)` so a
   card never overflows a narrow viewport. */
.tplad-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
  gap: 0.85rem;
}
.tplad-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.9rem 1rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 3px;
  background: rgb(var(--bg-surface));
}
.tplad-card-top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.tplad-name {
  font-size: 0.92rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.tplad-badge {
  padding: 0.05rem 0.35rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 2px;
  font-family: var(--font-mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}
.tplad-desc {
  font-size: 0.8rem;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
}
.tplad-desc--none {
  font-style: italic;
  color: rgb(var(--fg-faint));
}
.tplad-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.45rem;
  font-family: var(--font-mono);
  font-size: 0.66rem;
  color: rgb(var(--fg-faint));
}
.tplad-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.15rem;
}
.tplad-empty {
  padding: 2.5rem 1rem;
  text-align: center;
  font-size: 0.85rem;
  color: rgb(var(--fg-muted));
}
</style>

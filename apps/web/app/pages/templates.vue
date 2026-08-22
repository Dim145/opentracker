<template>
  <!--
    Listing templates — the user's own library.

    Editorial skeleton borrowed from the upload/fiche pages (same eyebrow,
    same oversized title, same back-link) so this reads as part of the
    same account area rather than a bolted-on tool. The card + single
    modal shape is `components/admin/Shop.vue`.

    Three groups, in the order a user needs them: the built-in layout
    (always there, never editable), their own templates, and whatever
    staff have published. The built-in one is a CONSTANT, not a row —
    `DEFAULT_FICHE_TEMPLATE` — so it has no id, cannot be deleted, and
    the only way to change it is to duplicate it first.
  -->
  <div class="upload-page tpl-page">
    <header class="upload-header">
      <NuxtLink to="/settings" class="back-link">
        <Icon name="ph:arrow-left" />
        {{ $t('templates.backToSettings') }}
      </NuxtLink>

      <div class="upload-title-row">
        <div>
          <p class="page-eyebrow">{{ $t('templates.eyebrow') }}</p>
          <h1 class="page-title">
            {{ $t('templates.titleMain') }}
            <span class="page-title-accent">{{ $t('templates.titleAccent') }}</span>
          </h1>
          <p class="tpl-subtitle">{{ $t('templates.subtitle') }}</p>
        </div>

        <div class="tpl-head-actions">
          <span
            v-if="quota"
            class="tpl-quota"
            :class="{ 'tpl-quota--full': quotaFull }"
            :title="$t('templates.quotaTooltip', { max: quota.max })"
          >
            <Icon name="ph:stack" class="text-sm" aria-hidden="true" />
            <span class="tpl-quota-label">{{ $t('templates.quotaLabel') }}</span>
            <span class="tpl-quota-value">{{ quota.used }} / {{ quota.max }}</span>
          </span>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="quotaFull"
            @click="openCreate"
          >
            <Icon name="ph:plus-bold" class="text-sm" />
            {{ $t('templates.actions.new') }}
          </button>
        </div>
      </div>

      <!-- Spelled out in the page rather than left to the disabled buttons'
           `title`: a disabled control takes no focus and fires no hover, so a
           tooltip is the one place the reason can never be read. -->
      <p v-if="quotaFull && quota" class="tpl-quota-note" role="status">
        <Icon name="ph:info" class="text-sm flex-shrink-0" aria-hidden="true" />
        {{ $t('templates.quotaReached', { max: quota.max }) }}
      </p>
    </header>

    <!-- Load failure gets its own state: an empty list and a broken endpoint
         look identical otherwise, and telling a user "you have no templates"
         when the server never answered is a lie. -->
    <p v-if="loadError" class="tpl-load-error" role="alert">
      <Icon name="ph:warning-circle-bold" class="text-base flex-shrink-0" />
      <span>{{ $t('templates.errors.loadFailed') }}</span>
      <button type="button" class="btn btn-xs btn-ghost" @click="reload">
        {{ $t('templates.actions.retry') }}
      </button>
    </p>

    <!-- Only the FIRST load gets the spinner. `pending` is true on every
         refresh too, so keying the skeleton off it tore the whole list down
         and replaced it with a centred spinner after each save, delete and
         publish — a jump on the very actions that should feel settled. Once
         there is data, a refresh happens under the existing rows. -->
    <div v-if="pending && !data" class="py-16 flex justify-center">
      <Icon name="ph:circle-notch" class="animate-spin text-2xl text-text-muted" />
    </div>

    <div v-else class="tpl-groups">
      <!-- ─── 01 · The built-in layout ─────────────────────────── -->
      <section class="form-section" aria-labelledby="tpl-h-builtin">
        <header class="section-head">
          <span class="section-number">01</span>
          <h2 id="tpl-h-builtin" class="section-title">{{ $t('templates.groupBuiltIn') }}</h2>
          <span class="section-rule" />
        </header>
        <div class="section-body">
          <article class="tpl-card tpl-card--builtin" :class="{ 'tpl-card--active': isBuiltInDefault }">
            <div class="tpl-card-top">
              <h3 class="tpl-card-name">{{ $t('templates.builtIn.name') }}</h3>
              <span class="tpl-badge tpl-badge--builtin">
                <Icon name="ph:lock-simple" class="text-[10px]" aria-hidden="true" />
                {{ $t('templates.badges.builtIn') }}
              </span>
              <span v-if="isBuiltInDefault" class="tpl-badge tpl-badge--default">
                <Icon name="ph:star-fill" class="text-[10px]" aria-hidden="true" />
                {{ $t('templates.badges.default') }}
              </span>
            </div>
            <p class="tpl-card-desc">{{ $t('templates.builtIn.description') }}</p>
            <p class="tpl-card-meta">
              <span>{{ $t('templates.meta.chars', { n: builtInLength }) }}</span>
            </p>
            <div class="tpl-card-actions">
              <button type="button" class="btn btn-xs btn-ghost" @click="viewBuiltIn">
                <Icon name="ph:eye" class="text-sm" />
                {{ $t('templates.actions.view') }}
              </button>
              <button
                type="button"
                class="btn btn-xs btn-ghost"
                :disabled="quotaFull"
                @click="duplicateBuiltIn"
              >
                <Icon name="ph:copy" class="text-sm" />
                {{ $t('templates.actions.duplicateToEdit') }}
              </button>
              <button
                v-if="!isBuiltInDefault"
                type="button"
                class="btn btn-xs btn-ghost"
                :disabled="settingDefault"
                @click="useBuiltInDefault"
              >
                <Icon name="ph:star" class="text-sm" />
                {{ $t('templates.actions.setDefault') }}
              </button>
            </div>
          </article>
        </div>
      </section>

      <!-- ─── 02 · Mine ────────────────────────────────────────── -->
      <section class="form-section" aria-labelledby="tpl-h-mine">
        <header class="section-head">
          <span class="section-number">02</span>
          <h2 id="tpl-h-mine" class="section-title">{{ $t('templates.groupMine') }}</h2>
          <span class="section-rule" />
        </header>
        <div class="section-body">
          <div v-if="mine.length === 0" class="tpl-empty">
            <Icon name="ph:brackets-curly" class="tpl-empty-icon" aria-hidden="true" />
            <p class="tpl-empty-title">{{ $t('templates.empty.title') }}</p>
            <p class="tpl-empty-body">{{ $t('templates.empty.body') }}</p>
            <div class="tpl-empty-actions">
              <button
                type="button"
                class="btn btn-primary btn-sm"
                :disabled="quotaFull"
                @click="duplicateBuiltIn"
              >
                <Icon name="ph:copy" class="text-sm" />
                {{ $t('templates.actions.startFromBuiltIn') }}
              </button>
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                :disabled="quotaFull"
                @click="openCreate"
              >
                <Icon name="ph:plus-bold" class="text-sm" />
                {{ $t('templates.actions.new') }}
              </button>
            </div>
          </div>

          <div v-else class="tpl-grid">
            <article
              v-for="row in mine"
              :key="row.id"
              class="tpl-card"
              :class="{ 'tpl-card--active': row.isDefault }"
            >
              <div class="tpl-card-top">
                <h3 class="tpl-card-name">{{ row.name }}</h3>
                <span v-if="row.isDefault" class="tpl-badge tpl-badge--default">
                  <Icon name="ph:star-fill" class="text-[10px]" aria-hidden="true" />
                  {{ $t('templates.badges.default') }}
                </span>
                <span v-if="row.visibility === 'published'" class="tpl-badge tpl-badge--published">
                  <Icon name="ph:seal-check" class="text-[10px]" aria-hidden="true" />
                  {{ $t('templates.badges.published') }}
                </span>
                <span class="tpl-badge">{{ $t(`templates.categories.${row.category}`) }}</span>
              </div>
              <p v-if="row.description" class="tpl-card-desc">{{ row.description }}</p>
              <p v-else class="tpl-card-desc tpl-card-desc--none">
                {{ $t('templates.noDescription') }}
              </p>
              <p class="tpl-card-meta">
                <span>{{ $t('templates.meta.chars', { n: row.content.length }) }}</span>
                <span aria-hidden="true">·</span>
                <span>{{ $t('templates.meta.updated', { date: formatDate(row.updatedAt) }) }}</span>
              </p>
              <div class="tpl-card-actions">
                <button type="button" class="btn btn-xs btn-ghost" @click="openEdit(row)">
                  <Icon name="ph:pencil-simple" class="text-sm" />
                  {{ $t('common.edit') }}
                </button>
                <button
                  type="button"
                  class="btn btn-xs btn-ghost"
                  :disabled="quotaFull"
                  @click="duplicate(row)"
                >
                  <Icon name="ph:copy" class="text-sm" />
                  {{ $t('templates.actions.duplicate') }}
                </button>
                <button
                  v-if="!row.isDefault"
                  type="button"
                  class="btn btn-xs btn-ghost"
                  :disabled="settingDefault"
                  @click="setDefault(row)"
                >
                  <Icon name="ph:star" class="text-sm" />
                  {{ $t('templates.actions.setDefault') }}
                </button>
                <!-- Publishing is a staff action, so the control only exists
                     for staff. A member seeing a button that always 403s is
                     worse than not seeing it: the API refuses either way, but
                     only one of the two teaches them something. -->
                <button
                  v-if="isStaff"
                  type="button"
                  class="btn btn-xs btn-ghost"
                  :disabled="publishing === row.id"
                  :aria-label="
                    row.visibility === 'published'
                      ? $t('templates.actions.unpublishNamed', { name: row.name })
                      : $t('templates.actions.publishNamed', { name: row.name })
                  "
                  @click="togglePublish(row)"
                >
                  <Icon
                    :name="
                      publishing === row.id
                        ? 'ph:circle-notch'
                        : row.visibility === 'published'
                          ? 'ph:seal-warning'
                          : 'ph:seal-check'
                    "
                    :class="publishing === row.id ? 'text-sm animate-spin' : 'text-sm'"
                    aria-hidden="true"
                  />
                  {{
                    row.visibility === 'published'
                      ? $t('templates.actions.unpublish')
                      : $t('templates.actions.publish')
                  }}
                </button>
                <button
                  type="button"
                  class="btn btn-xs btn-ghost text-error"
                  :aria-label="$t('templates.actions.deleteNamed', { name: row.name })"
                  @click="confirmDelete(row)"
                >
                  <Icon name="ph:trash" class="text-sm" />
                  {{ $t('common.delete') }}
                </button>
              </div>
            </article>
          </div>
        </div>
      </section>

      <!-- ─── 03 · Published by staff ──────────────────────────── -->
      <section v-if="published.length" class="form-section" aria-labelledby="tpl-h-published">
        <header class="section-head">
          <span class="section-number">03</span>
          <h2 id="tpl-h-published" class="section-title">{{ $t('templates.groupPublished') }}</h2>
          <span class="section-rule" />
        </header>
        <div class="section-body">
          <p class="section-help">{{ $t('templates.publishedHelp') }}</p>
          <div class="tpl-grid">
            <!-- No "default" badge and no "set as default" action here: the
                 flag lives on the row and these rows are not the caller's, so
                 the only route to using one is the copy that Duplicate makes. -->
            <article v-for="row in published" :key="row.id" class="tpl-card">
              <div class="tpl-card-top">
                <h3 class="tpl-card-name">{{ row.name }}</h3>
                <span class="tpl-badge tpl-badge--published">
                  <Icon name="ph:seal-check" class="text-[10px]" aria-hidden="true" />
                  {{ $t('templates.badges.published') }}
                </span>
                <span class="tpl-badge">{{ $t(`templates.categories.${row.category}`) }}</span>
              </div>
              <p v-if="row.description" class="tpl-card-desc">{{ row.description }}</p>
              <p class="tpl-card-meta">
                <span v-if="row.owner.username">
                  {{ $t('templates.meta.by', { name: row.owner.username }) }}
                </span>
                <span v-if="row.owner.username" aria-hidden="true">·</span>
                <span>{{ $t('templates.meta.chars', { n: row.content.length }) }}</span>
              </p>
              <div class="tpl-card-actions">
                <button type="button" class="btn btn-xs btn-ghost" @click="openView(row)">
                  <Icon name="ph:eye" class="text-sm" />
                  {{ $t('templates.actions.view') }}
                </button>
                <button
                  type="button"
                  class="btn btn-xs btn-ghost"
                  :disabled="quotaFull"
                  @click="duplicate(row)"
                >
                  <Icon name="ph:copy" class="text-sm" />
                  {{ $t('templates.actions.duplicate') }}
                </button>
                <!-- The takedown path. Somebody has to be able to retract a
                     template the whole site reads, and the author may be gone
                     or no longer staff — so any staffer can, on a row they do
                     not own. -->
                <button
                  v-if="isStaff"
                  type="button"
                  class="btn btn-xs btn-ghost text-warning"
                  :disabled="publishing === row.id"
                  :aria-label="$t('templates.actions.unpublishNamed', { name: row.name })"
                  @click="togglePublish(row)"
                >
                  <Icon
                    :name="publishing === row.id ? 'ph:circle-notch' : 'ph:seal-warning'"
                    :class="publishing === row.id ? 'text-sm animate-spin' : 'text-sm'"
                    aria-hidden="true"
                  />
                  {{ $t('templates.actions.unpublish') }}
                </button>
              </div>
            </article>
          </div>
        </div>
      </section>
    </div>

    <TemplateEditorModal
      v-model="editorOpen"
      :template="editing"
      :initial-name="seedName"
      :initial-content="seedContent"
      :readonly="editorReadonly"
      @saved="onSaved"
      @delete="onModalDelete"
      @duplicate="onModalDuplicate"
    />
  </div>
</template>

<script setup lang="ts">
import { DEFAULT_FICHE_TEMPLATE } from '~/utils/ficheTemplate';
import type {
  FicheTemplateListResponse,
  FicheTemplateRow,
} from '~/utils/ficheTemplateApi';

definePageMeta({ title: 'Listing templates' });

const { t, locale } = useI18n();
const notifications = useNotificationStore();
const confirm = useConfirm();

useHead({ title: () => t('templates.pageTitle') });

/**
 * `limit=50` is the route's ceiling and there is no pager here on purpose: a
 * user's own rows are capped by the quota (5 by default), so only the
 * staff-published list could ever overflow — and a site with more than fifty
 * published layouts has a curation problem, not a pagination one.
 */
const { data, pending, refresh, error } = await useFetch<FicheTemplateListResponse>(
  '/api/me/templates',
  { query: { scope: 'all', limit: 50 } },
);

const loadError = computed(() => Boolean(error.value));
const rows = computed(() => data.value?.data ?? []);
/**
 * Unknown and full are two different states, and collapsing them locks the
 * page.
 *
 * Falling back to 0/0 looked conservative — no answer, so promise nothing —
 * but `0 >= 0` reads as full: one failed request disabled every create and
 * duplicate button and told the user they had reached a limit of zero, which
 * is not true of any account. So the fallback is now null, meaning "not
 * known", and nothing is claimed or blocked on it. The cap is enforced in the
 * create endpoint regardless; the worst case is a request that comes back with
 * the real limit in its error, which is a better outcome than a page that
 * refuses to work offline.
 */
const quota = computed(() => data.value?.quota ?? null);
const quotaFull = computed(() => {
  const q = quota.value;
  return q !== null && q.max > 0 && q.used >= q.max;
});
const isBuiltInDefault = computed(() => (data.value?.defaultTemplateId ?? null) === null);

const mine = computed(() => rows.value.filter((r) => r.isMine));
/**
 * Staff-published rows the caller does not own. `scope=all` returns the union,
 * and a row that is both mine and published comes back once — so filtering on
 * `!isMine` here is what keeps it out of this list and in "My templates".
 */
const published = computed(
  () => rows.value.filter((r) => !r.isMine && r.visibility === 'published'),
);

const builtInLength = DEFAULT_FICHE_TEMPLATE.length;

async function reload() {
  await refresh();
}

// ── Editor modal ────────────────────────────────────────────────
const editorOpen = ref(false);
const editing = ref<FicheTemplateRow | null>(null);
const editorReadonly = ref(false);
const seedName = ref('');
const seedContent = ref('');

/**
 * "New" still starts from the built-in source rather than an empty box: the
 * scaffolding is ~40 lines of nested BBCode nobody would retype, and an empty
 * editor is a template that renders nothing. The name is left blank, which is
 * what makes this a create rather than a duplicate.
 */
function openCreate() {
  if (quotaFull.value) return;
  editing.value = null;
  editorReadonly.value = false;
  seedName.value = '';
  seedContent.value = DEFAULT_FICHE_TEMPLATE;
  editorOpen.value = true;
}

function openEdit(row: FicheTemplateRow) {
  editing.value = row;
  editorReadonly.value = false;
  editorOpen.value = true;
}

function openView(row: FicheTemplateRow) {
  editing.value = row;
  editorReadonly.value = true;
  editorOpen.value = true;
}

/**
 * A duplicate opens as a CREATE pre-filled with the source's body, never as an
 * edit of the original: opening the original and saving under a new name would
 * silently overwrite whatever the user copied from.
 */
function duplicate(row: FicheTemplateRow) {
  if (quotaFull.value) return;
  editing.value = null;
  editorReadonly.value = false;
  seedName.value = t('templates.copyOf', { name: row.name });
  seedContent.value = row.content;
  editorOpen.value = true;
}

function duplicateBuiltIn() {
  if (quotaFull.value) return;
  editing.value = null;
  editorReadonly.value = false;
  seedName.value = t('templates.copyOf', { name: t('templates.builtIn.name') });
  seedContent.value = DEFAULT_FICHE_TEMPLATE;
  editorOpen.value = true;
}

function viewBuiltIn() {
  editing.value = null;
  editorReadonly.value = true;
  seedName.value = t('templates.builtIn.name');
  seedContent.value = DEFAULT_FICHE_TEMPLATE;
  editorOpen.value = true;
}

async function onSaved() {
  await refresh();
}

/** The modal's own delete button; the confirm and the request live here. */
function onModalDelete(row: FicheTemplateRow) {
  editorOpen.value = false;
  void confirmDelete(row);
}

/** "Duplicate" from inside the read-only view: close, then reopen as a create. */
function onModalDuplicate(row: FicheTemplateRow | null) {
  const content = row?.content ?? seedContent.value;
  const name = row?.name ?? seedName.value;
  editorOpen.value = false;
  if (quotaFull.value) {
    notifications.error(t('templates.quotaReached', { max: quota.value.max }));
    return;
  }
  nextTick(() => {
    editing.value = null;
    editorReadonly.value = false;
    seedName.value = t('templates.copyOf', { name });
    seedContent.value = content;
    editorOpen.value = true;
  });
}

// ── Delete ──────────────────────────────────────────────────────
async function confirmDelete(row: FicheTemplateRow) {
  const ok = await confirm({
    title: t('templates.confirm.deleteTitle'),
    message: t('templates.confirm.deleteMessage', { name: row.name }),
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await $fetch(`/api/me/templates/${row.id}`, { method: 'DELETE' });
    notifications.success(t('templates.toasts.deleted'));
    await refresh();
  } catch (err: unknown) {
    const e = err as { data?: { message?: string } };
    notifications.error(e?.data?.message || t('templates.errors.deleteFailed'));
  }
}

// ── Publishing (staff) ──────────────────────────────────────────
/**
 * Staff only, and read off the session rather than from the row.
 *
 * The API re-reads the role live from the database on every publish, so this
 * flag decides what is *shown*, never what is allowed — a stale cookie can
 * reveal a button whose request then fails, which is the right way round.
 */
const { user } = useUserSession();
const isStaff = computed(() => !!(user.value?.isAdmin || user.value?.isModerator));

/** The row currently being published, so only its own button spins. */
const publishing = ref<string | null>(null);

/**
 * Publishing asks first; unpublishing asks harder.
 *
 * Both directions change what the whole site sees, and the second one takes
 * something away that members may already be building on — so the retract
 * confirm names the template and is styled as destructive, while publishing
 * just states the consequence.
 */
async function togglePublish(row: FicheTemplateRow) {
  if (publishing.value) return;
  const next = row.visibility === 'published' ? 'private' : 'published';
  const ok = await confirm(
    next === 'published'
      ? {
          title: t('templates.confirm.publishTitle'),
          message: t('templates.confirm.publishMessage', { name: row.name }),
          confirmText: t('templates.actions.publish'),
        }
      : {
          title: t('templates.confirm.unpublishTitle'),
          message: t('templates.confirm.unpublishMessage', { name: row.name }),
          confirmText: t('templates.actions.unpublish'),
          destructive: true,
        },
  );
  if (!ok) return;

  publishing.value = row.id;
  try {
    await $fetch(`/api/me/templates/${row.id}`, {
      method: 'PATCH',
      body: { visibility: next },
    });
    notifications.success(
      next === 'published'
        ? t('templates.toasts.published')
        : t('templates.toasts.unpublished'),
    );
    await refresh();
  } catch (err: unknown) {
    const e = err as { data?: { message?: string } };
    notifications.error(e.data?.message ?? t('templates.toasts.publishFailed'));
  } finally {
    publishing.value = null;
  }
}

// ── Default selection ───────────────────────────────────────────
const settingDefault = ref(false);

async function setDefault(row: FicheTemplateRow) {
  await writeDefault(row.id, true);
}

/**
 * Going back to the built-in layout is not an endpoint: the built-in default
 * is a code constant with no row to point at, so "use the built-in" means
 * clearing the flag on whichever row currently holds it.
 */
async function useBuiltInDefault() {
  const current = data.value?.defaultTemplateId;
  if (!current) return;
  await writeDefault(current, false);
}

async function writeDefault(templateId: string, isDefault: boolean) {
  if (settingDefault.value) return;
  settingDefault.value = true;
  try {
    await $fetch(`/api/me/templates/${templateId}/default`, {
      method: 'PUT',
      body: { isDefault },
    });
    notifications.success(t('templates.toasts.defaultSet'));
    await refresh();
  } catch (err: unknown) {
    const e = err as { data?: { message?: string } };
    notifications.error(e?.data?.message || t('templates.errors.defaultFailed'));
  } finally {
    settingDefault.value = false;
  }
}

// ── Formatting ──────────────────────────────────────────────────
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale.value, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}
</script>

<style scoped>
@import '~/assets/css/upload-form.css';

.tpl-page {
  max-width: 1100px;
}

.tpl-subtitle {
  margin: 0.75rem 0 0;
  max-width: 46ch;
  font-size: 13px;
  line-height: 1.6;
  color: rgb(var(--fg-muted));
}

.tpl-head-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

/* Quota chip — mono, tabular, so the pair of numbers reads as a measurement
   rather than as prose. */
.tpl-quota {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.7rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 9999px;
  font-size: 10px;
  color: rgb(var(--fg-muted));
}
.tpl-quota-label {
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.tpl-quota-value {
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--fg-strong));
}
.tpl-quota--full {
  border-color: rgb(var(--warning) / 0.45);
  color: rgb(var(--warning));
}
.tpl-quota--full .tpl-quota-value {
  color: rgb(var(--warning));
}
.tpl-quota-note {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 1rem 0 0;
  font-size: 12px;
  color: rgb(var(--warning));
}

.tpl-load-error {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1.5rem;
  padding: 0.6rem 0.85rem;
  border: 1px solid rgb(var(--danger) / 0.3);
  border-radius: var(--radius-sm);
  background-color: rgb(var(--danger) / 0.08);
  font-size: 12px;
  color: rgb(var(--danger));
}

.tpl-groups {
  display: flex;
  flex-direction: column;
  gap: 3rem;
}

.tpl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
  gap: 0.75rem;
}

/* ─── Card ─────────────────────────────────────────────────── */
.tpl-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.9rem 1rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background-color: rgb(var(--bg-surface));
  transition: border-color 0.15s;
}
.tpl-card:hover {
  border-color: rgb(var(--line-strong));
}
/* The active default gets a left rule rather than a fill: a coloured card
   background would fight the badges already sitting on it. */
.tpl-card--active {
  border-left: 2px solid rgb(var(--accent));
}
.tpl-card--builtin {
  background-color: rgb(var(--bg-inset));
}

.tpl-card-top {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.tpl-card-name {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  overflow-wrap: anywhere;
}
.tpl-card-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: rgb(var(--fg-muted));
}
.tpl-card-desc--none {
  font-style: italic;
  color: rgb(var(--fg-muted));
}
.tpl-card-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin: 0;
  font-family: var(--font-mono);
  font-size: 10px;
  /* --fg-muted, not --fg-faint: faint measures ~2.1:1 on the light theme's
     surfaces, well under 4.5:1. */
  font-variant-numeric: tabular-nums;
  color: rgb(var(--fg-muted));
}
.tpl-card-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-wrap: wrap;
  margin-top: 0.25rem;
  padding-top: 0.6rem;
  border-top: 1px solid rgb(var(--line-default));
}

.tpl-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1rem 0.4rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  white-space: nowrap;
}
.tpl-badge--default {
  border-color: rgb(var(--accent) / 0.5);
  background-color: rgb(var(--accent) / 0.12);
  color: rgb(var(--accent));
}
.tpl-badge--published {
  border-color: rgb(var(--info) / 0.5);
  background-color: rgb(var(--info) / 0.12);
  color: rgb(var(--info));
}
.tpl-badge--builtin {
  border-style: dashed;
}

/* ─── Empty state ──────────────────────────────────────────── */
.tpl-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 3rem 1.5rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-md);
  text-align: center;
}
/* Decorative, aria-hidden, so the 3:1 non-text threshold applies rather than
   4.5:1 — --fg-subtle clears it in both themes where --fg-faint does not. */
.tpl-empty-icon {
  font-size: 2.25rem;
  color: rgb(var(--fg-subtle));
}
.tpl-empty-title {
  margin: 0.25rem 0 0;
  font-size: 13px;
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.tpl-empty-body {
  margin: 0;
  max-width: 52ch;
  font-size: 12px;
  line-height: 1.6;
  color: rgb(var(--fg-muted));
}
.tpl-empty-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 0.75rem;
}
</style>

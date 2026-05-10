<template>
  <div class="card">
    <div class="card-header">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <Icon name="ph:lightning" class="text-text-muted" />
          <h3
            class="text-xs font-bold uppercase tracking-wider text-text-primary"
          >
            {{ $t('admin.bonusEvents.title') }}
          </h3>
        </div>
        <button
          type="button"
          class="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded bg-text-primary text-bg-primary hover:opacity-90 flex items-center gap-1.5"
          @click="openCreate"
        >
          <Icon name="ph:plus-bold" />
          {{ $t('admin.bonusEvents.newEvent') }}
        </button>
      </div>
    </div>

    <div class="card-body space-y-4">
      <i18n-t keypath="admin.bonusEvents.intro" tag="p" class="text-xs text-text-muted leading-relaxed">
        <template #freeleech>
          <strong>{{ $t('admin.bonusEvents.freeleech') }}</strong>
        </template>
        <template #silverleech>
          <strong>{{ $t('admin.bonusEvents.silverleech') }}</strong>
        </template>
      </i18n-t>

      <!-- List -->
      <div v-if="loading" class="py-12 flex justify-center">
        <Icon name="ph:circle-notch" class="animate-spin text-2xl text-text-muted" />
      </div>
      <i18n-t
        v-else-if="!events.length"
        keypath="admin.bonusEvents.empty"
        tag="div"
        class="py-12 text-center text-xs text-text-muted"
      >
        <template #action>
          <strong>{{ $t('admin.bonusEvents.emptyAction') }}</strong>
        </template>
      </i18n-t>
      <div v-else class="space-y-2">
        <div
          v-for="ev in events"
          :key="ev.id"
          class="border border-border rounded p-3 flex flex-wrap items-center gap-3"
          :class="{
            'border-success/30 bg-success/5': ev.status === 'active',
            'opacity-60': ev.status === 'ended' || ev.status === 'disabled',
          }"
        >
          <div class="flex-1 min-w-[200px]">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-sm font-semibold text-text-primary truncate">
                {{ ev.title }}
              </span>
              <span
                class="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                :class="statusClass(ev.status)"
              >
                {{ statusLabel(ev.status) }}
              </span>
              <span
                v-if="presetOf(ev)"
                class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-fg-default/10 text-text-muted"
              >
                {{ presetOf(ev) }}
              </span>
            </div>
            <div class="text-xs text-text-muted flex flex-wrap gap-x-4 gap-y-1">
              <span class="flex items-center gap-1">
                <Icon name="ph:download-simple" class="text-[10px]" />
                {{ formatMul(ev.downloadMultiplier) }} {{ $t('admin.bonusEvents.row.downloadSuffix') }}
              </span>
              <span class="flex items-center gap-1">
                <Icon name="ph:upload-simple" class="text-[10px]" />
                {{ formatMul(ev.uploadMultiplier) }} {{ $t('admin.bonusEvents.row.uploadSuffix') }}
              </span>
              <span class="flex items-center gap-1">
                <Icon name="ph:calendar-blank" class="text-[10px]" />
                {{ formatRange(ev.startsAt, ev.endsAt) }}
              </span>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              :title="ev.enabled ? $t('admin.bonusEvents.row.disable') : $t('admin.bonusEvents.row.enable')"
              @click="toggle(ev)"
            >
              <Icon
                :name="ev.enabled ? 'ph:pause' : 'ph:play'"
                class="text-sm"
              />
            </button>
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              :title="$t('admin.bonusEvents.row.edit')"
              @click="openEdit(ev)"
            >
              <Icon name="ph:pencil-simple" class="text-sm" />
            </button>
            <button
              type="button"
              class="btn btn-xs btn-ghost text-error"
              :title="$t('admin.bonusEvents.row.delete')"
              @click="askDelete(ev)"
            >
              <Icon name="ph:trash" class="text-sm" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Create / edit modal -->
    <Modal v-model="formOpen" :title="editing ? $t('admin.bonusEvents.form.editTitle') : $t('admin.bonusEvents.form.createTitle')" size="lg">
      <form class="space-y-4" @submit.prevent="submitForm">
        <!-- Presets -->
        <div>
          <label class="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2 block">
            {{ $t('admin.bonusEvents.form.presetLabel') }}
          </label>
          <div class="grid grid-cols-3 gap-2">
            <button
              type="button"
              :class="presetButtonClass('freeleech')"
              @click="applyPreset('freeleech')"
            >
              <Icon name="ph:gift" />
              {{ $t('admin.bonusEvents.form.preset.freeleech') }}
              <span class="text-[10px] opacity-75">{{ $t('admin.bonusEvents.form.preset.freeleechSub') }}</span>
            </button>
            <button
              type="button"
              :class="presetButtonClass('silverleech')"
              @click="applyPreset('silverleech')"
            >
              <Icon name="ph:medal" />
              {{ $t('admin.bonusEvents.form.preset.silverleech') }}
              <span class="text-[10px] opacity-75">{{ $t('admin.bonusEvents.form.preset.silverleechSub') }}</span>
            </button>
            <button
              type="button"
              :class="presetButtonClass('custom')"
              @click="applyPreset('custom')"
            >
              <Icon name="ph:sliders" />
              {{ $t('admin.bonusEvents.form.preset.custom') }}
              <span class="text-[10px] opacity-75">{{ $t('admin.bonusEvents.form.preset.customSub') }}</span>
            </button>
          </div>
        </div>

        <!-- Title -->
        <div>
          <label class="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1 block">
            {{ $t('admin.bonusEvents.form.titleLabel') }}<span class="text-error">*</span>
          </label>
          <input
            v-model="form.title"
            type="text"
            maxlength="120"
            required
            :placeholder="$t('admin.bonusEvents.form.titlePlaceholder')"
            class="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-fg-default/20"
          />
        </div>

        <!-- Description -->
        <div>
          <label class="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1 block">
            {{ $t('admin.bonusEvents.form.descriptionLabel') }}
          </label>
          <textarea
            v-model="form.description"
            rows="2"
            maxlength="500"
            :placeholder="$t('admin.bonusEvents.form.descriptionPlaceholder')"
            class="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-fg-default/20 resize-none"
          />
        </div>

        <!-- Long description -->
        <div>
          <label class="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1 block">
            {{ $t('admin.bonusEvents.form.explainerLabel') }}
          </label>
          <textarea
            v-model="form.longDescription"
            rows="3"
            maxlength="2000"
            :placeholder="$t('admin.bonusEvents.form.explainerPlaceholder')"
            class="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-fg-default/20 resize-none"
          />
          <p class="text-[10px] text-text-muted mt-1">
            {{ $t('admin.bonusEvents.form.explainerHint') }}
          </p>
        </div>

        <!-- Multipliers -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1 block">
              {{ $t('admin.bonusEvents.form.downloadLabel', { value: formatMul(form.downloadMultiplier) }) }}
            </label>
            <input
              v-model.number="form.downloadMultiplier"
              type="range"
              min="0"
              max="200"
              step="5"
              class="w-full"
            />
            <div class="flex justify-between text-[10px] text-text-muted mt-1">
              <span>0×</span><span>1×</span><span>2×</span>
            </div>
          </div>
          <div>
            <label class="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1 block">
              {{ $t('admin.bonusEvents.form.uploadLabel', { value: formatMul(form.uploadMultiplier) }) }}
            </label>
            <input
              v-model.number="form.uploadMultiplier"
              type="range"
              min="0"
              max="1000"
              step="10"
              class="w-full"
            />
            <div class="flex justify-between text-[10px] text-text-muted mt-1">
              <span>0×</span><span>5×</span><span>10×</span>
            </div>
          </div>
        </div>

        <!-- Window -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1 block">
              {{ $t('admin.bonusEvents.form.startsAt') }}<span class="text-error">*</span>
            </label>
            <input
              v-model="form.startsAt"
              type="datetime-local"
              required
              class="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-fg-default/20"
            />
          </div>
          <div>
            <label class="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1 block">
              {{ $t('admin.bonusEvents.form.endsAt') }}<span class="text-error">*</span>
            </label>
            <input
              v-model="form.endsAt"
              type="datetime-local"
              required
              class="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-fg-default/20"
            />
          </div>
        </div>

        <!-- Enabled -->
        <SettingsGroup
          :label="$t('admin.bonusEvents.form.enabled')"
          :description="$t('admin.bonusEvents.form.enabledHint')"
        >
          <button
            type="button"
            @click="form.enabled = !form.enabled"
            :class="[
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-white/20',
              form.enabled ? 'bg-success' : 'bg-bg-tertiary border border-border',
            ]"
          >
            <span
              :class="[
                'inline-block h-4 w-4 transform rounded-full bg-fg-strong transition-transform',
                form.enabled ? 'translate-x-6' : 'translate-x-1',
              ]"
            />
          </button>
        </SettingsGroup>

        <!-- Error -->
        <div v-if="formError" class="text-xs text-error border border-error/30 bg-error/5 rounded px-3 py-2">
          {{ formError }}
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-2 pt-2 border-t border-border/50">
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            :disabled="submitting"
            @click="formOpen = false"
          >
            {{ $t('common.cancel') }}
          </button>
          <button
            type="submit"
            class="btn btn-sm btn-primary"
            :disabled="submitting || !canSubmit"
          >
            <Icon v-if="submitting" name="ph:circle-notch" class="animate-spin" />
            {{ editing ? $t('admin.bonusEvents.form.saveSubmit') : $t('admin.bonusEvents.form.createSubmit') }}
          </button>
        </div>
      </form>
    </Modal>

    <!-- Delete confirmation -->
    <Modal v-model="deleteOpen" :title="$t('admin.bonusEvents.deleteModal.title')" size="sm">
      <div class="space-y-4">
        <i18n-t keypath="admin.bonusEvents.deleteModal.message" tag="p" class="text-sm text-text-primary">
          <template #title>
            <strong>{{ pendingDelete?.title }}</strong>
          </template>
        </i18n-t>
        <div class="flex justify-end gap-2">
          <button class="btn btn-sm btn-ghost" @click="deleteOpen = false">
            {{ $t('common.cancel') }}
          </button>
          <button
            class="btn btn-sm btn-danger"
            :disabled="deleting"
            @click="confirmDelete"
          >
            <Icon v-if="deleting" name="ph:circle-notch" class="animate-spin" />
            {{ $t('common.delete') }}
          </button>
        </div>
      </div>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Modal from '~/components/Modal.vue';

const { t } = useI18n();

interface BonusEvent {
  id: string;
  title: string;
  description: string | null;
  longDescription: string | null;
  downloadMultiplier: number;
  uploadMultiplier: number;
  startsAt: string;
  endsAt: string;
  enabled: boolean;
  status: 'active' | 'scheduled' | 'ended' | 'disabled';
}

const events = ref<BonusEvent[]>([]);
const loading = ref(true);

const formOpen = ref(false);
const editing = ref<BonusEvent | null>(null);
const submitting = ref(false);
const formError = ref<string | null>(null);

const form = ref({
  title: '',
  description: '',
  longDescription: '',
  downloadMultiplier: 100,
  uploadMultiplier: 100,
  startsAt: '',
  endsAt: '',
  enabled: true,
});

const deleteOpen = ref(false);
const pendingDelete = ref<BonusEvent | null>(null);
const deleting = ref(false);

// ── Display helpers ────────────────────────────────────────

/** basis points × 100 → human "0.5", "1", "2.5" */
function formatMul(bp: number): string {
  const x = bp / 100;
  return Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatRange(startsAt: string, endsAt: string): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const sameDay = s.toDateString() === e.toDateString();
  const fmt = (d: Date) =>
    d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  return sameDay
    ? `${fmt(s)} → ${e.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    : `${fmt(s)} → ${fmt(e)}`;
}

function presetOf(ev: BonusEvent): string | null {
  if (ev.downloadMultiplier === 0 && ev.uploadMultiplier === 100) return t('admin.bonusEvents.freeleech');
  if (ev.downloadMultiplier === 50 && ev.uploadMultiplier === 100) return t('admin.bonusEvents.silverleech');
  return null;
}

function statusLabel(status: BonusEvent['status']): string {
  switch (status) {
    case 'active':
      return t('admin.bonusEvents.status.active');
    case 'scheduled':
      return t('admin.bonusEvents.status.scheduled');
    case 'ended':
      return t('admin.bonusEvents.status.ended');
    case 'disabled':
      return t('admin.bonusEvents.status.disabled');
  }
}

function statusClass(status: BonusEvent['status']): string {
  switch (status) {
    case 'active':
      return 'bg-success/15 text-success';
    case 'scheduled':
      return 'bg-blue-500/15 text-blue-400';
    case 'ended':
      return 'bg-bg-tertiary text-text-muted';
    case 'disabled':
      return 'bg-yellow-500/15 text-yellow-400';
  }
}

const canSubmit = computed(() => {
  if (!form.value.title.trim()) return false;
  if (!form.value.startsAt || !form.value.endsAt) return false;
  return new Date(form.value.endsAt) > new Date(form.value.startsAt);
});

// ── Presets ────────────────────────────────────────────────

function presetButtonClass(kind: 'freeleech' | 'silverleech' | 'custom'): string {
  const active = matchPreset(form.value) === kind;
  return [
    'flex flex-col items-center gap-1 px-3 py-3 rounded border text-xs font-medium transition-colors',
    active
      ? 'border-accent bg-fg-default/5 text-text-primary'
      : 'border-border text-text-muted hover:border-fg-default/20',
  ].join(' ');
}

function matchPreset(f: typeof form.value): 'freeleech' | 'silverleech' | 'custom' {
  if (f.downloadMultiplier === 0 && f.uploadMultiplier === 100) return 'freeleech';
  if (f.downloadMultiplier === 50 && f.uploadMultiplier === 100) return 'silverleech';
  return 'custom';
}

function applyPreset(kind: 'freeleech' | 'silverleech' | 'custom') {
  if (kind === 'freeleech') {
    form.value.downloadMultiplier = 0;
    form.value.uploadMultiplier = 100;
  } else if (kind === 'silverleech') {
    form.value.downloadMultiplier = 50;
    form.value.uploadMultiplier = 100;
  }
  // 'custom' is a no-op — let the user pick whatever they want.
}

// ── Form open / submit ─────────────────────────────────────

function isoToLocalInput(iso: string): string {
  // <input type=datetime-local> wants `YYYY-MM-DDTHH:mm`. Build it
  // from the user's local-tz pieces of `iso`.
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string {
  // datetime-local has no tz info; treat it as the user's local time
  // and let the Date constructor resolve to UTC.
  return new Date(local).toISOString();
}

function openCreate() {
  editing.value = null;
  formError.value = null;
  const now = new Date();
  const inHour = new Date(now.getTime() + 60 * 60 * 1000);
  const inDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  form.value = {
    title: '',
    description: '',
    longDescription: '',
    downloadMultiplier: 100,
    uploadMultiplier: 100,
    startsAt: isoToLocalInput(inHour.toISOString()),
    endsAt: isoToLocalInput(inDay.toISOString()),
    enabled: true,
  };
  formOpen.value = true;
}

function openEdit(ev: BonusEvent) {
  editing.value = ev;
  formError.value = null;
  form.value = {
    title: ev.title,
    description: ev.description ?? '',
    longDescription: ev.longDescription ?? '',
    downloadMultiplier: ev.downloadMultiplier,
    uploadMultiplier: ev.uploadMultiplier,
    startsAt: isoToLocalInput(ev.startsAt),
    endsAt: isoToLocalInput(ev.endsAt),
    enabled: ev.enabled,
  };
  formOpen.value = true;
}

async function submitForm() {
  if (!canSubmit.value) return;
  submitting.value = true;
  formError.value = null;
  try {
    const body = {
      title: form.value.title,
      description: form.value.description || null,
      longDescription: form.value.longDescription || null,
      downloadMultiplier: form.value.downloadMultiplier,
      uploadMultiplier: form.value.uploadMultiplier,
      startsAt: localInputToIso(form.value.startsAt),
      endsAt: localInputToIso(form.value.endsAt),
      enabled: form.value.enabled,
    };
    if (editing.value) {
      await $fetch(`/api/admin/bonus-events/${editing.value.id}`, {
        method: 'PATCH',
        body,
      });
    } else {
      await $fetch('/api/admin/bonus-events', {
        method: 'POST',
        body,
      });
    }
    formOpen.value = false;
    await load();
  } catch (err: unknown) {
    formError.value =
      (err as { data?: { message?: string }; statusMessage?: string })?.data
        ?.message ??
      (err as { statusMessage?: string })?.statusMessage ??
      t('admin.bonusEvents.errors.saveFailed');
  } finally {
    submitting.value = false;
  }
}

// ── Toggle / delete ────────────────────────────────────────

async function toggle(ev: BonusEvent) {
  try {
    await $fetch(`/api/admin/bonus-events/${ev.id}/toggle`, { method: 'POST' });
    await load();
  } catch (err: unknown) {
    alert(
      (err as { data?: { message?: string } })?.data?.message ??
        t('admin.bonusEvents.errors.toggleFailed')
    );
  }
}

function askDelete(ev: BonusEvent) {
  pendingDelete.value = ev;
  deleteOpen.value = true;
}

async function confirmDelete() {
  if (!pendingDelete.value) return;
  deleting.value = true;
  try {
    await $fetch(`/api/admin/bonus-events/${pendingDelete.value.id}`, {
      method: 'DELETE',
    });
    deleteOpen.value = false;
    pendingDelete.value = null;
    await load();
  } catch (err: unknown) {
    alert(
      (err as { data?: { message?: string } })?.data?.message ??
        t('admin.bonusEvents.errors.deleteFailed')
    );
  } finally {
    deleting.value = false;
  }
}

// ── Load ───────────────────────────────────────────────────

async function load() {
  loading.value = true;
  try {
    const res = await $fetch<{ events: BonusEvent[] }>(
      '/api/admin/bonus-events'
    );
    events.value = res.events;
  } catch (err) {
    console.error('Failed to load bonus events:', err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
});
</script>

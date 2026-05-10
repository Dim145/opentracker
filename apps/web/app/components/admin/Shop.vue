<template>
  <!--
    Operator console for the seed-bonus shop.

    Visual language is the "catalogue ledger" — sharp section header,
    items rendered as horizontal rows with a strong cost column, type
    cards in the form modal that mirror the bonus-event preset cards
    so an admin moving between the two surfaces feels at home.

    All chrome goes through the project's Tailwind theme tokens
    (`bg-bg-secondary`, `text-text-primary`, `bg-accent`, …) so
    light + dark themes stay readable without scoped overrides.
  -->
  <div class="card">
    <div class="card-header">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2">
          <Icon name="ph:storefront" class="text-text-muted" />
          <h3
            class="text-xs font-bold uppercase tracking-wider text-text-primary"
          >
            {{ $t('admin.shop.title') }}
          </h3>
          <span
            v-if="items.length"
            class="text-[10px] font-mono text-text-muted px-1.5 py-0.5 rounded border border-border"
          >
            {{ items.length }}
          </span>
        </div>
        <button
          type="button"
          class="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded bg-accent text-accent-fg hover:bg-accent-hover transition-colors flex items-center gap-1.5"
          @click="openCreate"
        >
          <Icon name="ph:plus-bold" />
          {{ $t('admin.shop.newItem') }}
        </button>
      </div>
    </div>

    <div class="card-body space-y-4">
      <p class="text-xs text-text-muted leading-relaxed max-w-3xl">
        {{ $t('admin.shop.intro') }}
      </p>

      <!-- Loading -->
      <div v-if="pending" class="py-12 flex justify-center">
        <Icon name="ph:circle-notch" class="animate-spin text-2xl text-text-muted" />
      </div>

      <!-- Empty state — editorial blank-ledger treatment. -->
      <div
        v-else-if="items.length === 0"
        class="py-14 text-center border border-dashed border-border rounded relative overflow-hidden"
      >
        <div
          class="absolute inset-x-8 top-1/2 -translate-y-1/2 h-px bg-fg-default/5"
          aria-hidden="true"
        />
        <Icon
          name="ph:scroll"
          class="text-4xl text-text-faint mx-auto mb-3 relative"
        />
        <p class="text-sm font-bold text-text-primary mb-1 relative">
          {{ $t('admin.shop.empty') }}
        </p>
        <p class="text-[10px] font-mono uppercase tracking-widest text-text-muted relative">
          §0001 · catalogue · empty
        </p>
      </div>

      <!-- Items list — ledger-row treatment. -->
      <ul v-else class="space-y-2">
        <li
          v-for="(item, idx) in items"
          :key="item.id"
          class="border border-border rounded grid gap-3 p-3 transition-colors"
          :class="[
            'grid-cols-[auto_1fr_auto_auto]',
            !item.enabled && 'opacity-60',
          ]"
        >
          <!-- Index marker — pure typographic anchor -->
          <span
            class="text-[10px] font-mono text-text-faint self-center w-6 text-right tabular-nums"
            aria-hidden="true"
          >
            {{ String(idx + 1).padStart(2, '0') }}
          </span>

          <!-- Body: name, type pill, effect line -->
          <div class="min-w-0">
            <div class="flex items-center gap-2 mb-1 flex-wrap">
              <span class="text-sm font-semibold text-text-primary truncate">
                {{ item.name }}
              </span>
              <span
                class="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded bg-fg-default/5 border border-border text-text-muted inline-flex items-center gap-1"
              >
                <Icon :name="defaultIconFor(item.type)" class="text-[11px]" />
                {{ typeLabel(item.type) }}
              </span>
              <span
                v-if="!item.enabled"
                class="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-fg-default/10 text-text-muted"
              >
                {{ $t('admin.shop.disabled') }}
              </span>
              <span
                v-else-if="item.stock !== null && item.stock === 0"
                class="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-warning/10 text-warning"
              >
                {{ $t('admin.shop.outOfStock') }}
              </span>
              <span
                v-else-if="item.stock !== null && item.stock <= 3"
                class="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-warning/10 text-warning"
              >
                {{ $t('admin.shop.lowStock') }}
              </span>
            </div>
            <div
              class="text-xs text-text-muted flex flex-wrap gap-x-4 gap-y-1 items-center"
            >
              <span class="flex items-center gap-1">
                <Icon name="ph:lightning-bold" class="text-[10px]" />
                {{ effectLabel(item) }}
              </span>
              <span
                v-if="item.stock !== null"
                class="flex items-center gap-1 font-mono text-[11px]"
              >
                <Icon name="ph:package" class="text-[10px]" />
                {{ $t('admin.shop.stockRemaining', { n: item.stock }) }}
              </span>
              <span
                v-else
                class="flex items-center gap-1 font-mono text-[11px] italic"
              >
                <Icon name="ph:infinity" class="text-[10px]" />
                {{ $t('admin.shop.unlimited') }}
              </span>
            </div>
          </div>

          <!-- Cost column — strong typographic anchor on the right side -->
          <div class="self-center text-right pr-2 pl-3 border-l border-border">
            <p
              class="font-mono text-base font-bold text-text-primary tabular-nums leading-none"
            >
              {{ formatNumber(item.cost) }}
            </p>
            <p
              class="text-[9px] font-mono uppercase tracking-widest text-text-muted mt-1"
            >
              {{ $t('shop.points') }}
            </p>
          </div>

          <!-- Action cluster -->
          <div class="self-center flex items-center gap-1">
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              :title="item.enabled ? $t('admin.shop.disable') : $t('admin.shop.enable')"
              @click="toggleEnabled(item)"
            >
              <Icon
                :name="item.enabled ? 'ph:pause' : 'ph:play'"
                class="text-sm"
              />
            </button>
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              :title="$t('common.edit')"
              @click="openEdit(item)"
            >
              <Icon name="ph:pencil-simple" class="text-sm" />
            </button>
            <button
              type="button"
              class="btn btn-xs btn-ghost text-error"
              :title="$t('common.delete')"
              @click="confirmDelete(item)"
            >
              <Icon name="ph:trash" class="text-sm" />
            </button>
          </div>
        </li>
      </ul>
    </div>

    <!-- Create / edit modal -->
    <Modal
      v-model="formOpen"
      size="md"
      :title="form.id ? $t('admin.shop.editTitle') : $t('admin.shop.createTitle')"
    >
      <form class="space-y-5" @submit.prevent="saveItem">
        <!-- Type picker — preset cards mirror the bonus-events form so
             admins moving between the two surfaces don't relearn. -->
        <fieldset>
          <legend
            class="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2"
          >
            {{ $t('admin.shop.fields.type') }}
          </legend>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="opt in TYPE_OPTIONS"
              :key="opt.value"
              type="button"
              class="text-left p-3 rounded border transition-colors flex items-start gap-3"
              :class="
                form.type === opt.value
                  ? 'border-text-strong bg-fg-default/5'
                  : 'border-border hover:border-fg-default/30'
              "
              @click="onPickType(opt.value)"
            >
              <Icon :name="opt.icon" class="text-lg text-text-secondary mt-0.5" />
              <div class="min-w-0">
                <p class="text-xs font-bold text-text-primary uppercase tracking-wider">
                  {{ opt.label }}
                </p>
                <p class="text-[10px] text-text-muted mt-1 leading-snug">
                  {{ opt.sub }}
                </p>
              </div>
            </button>
          </div>
        </fieldset>

        <div class="space-y-1">
          <label
            class="text-[10px] font-bold uppercase tracking-widest text-text-muted"
            for="shop-name"
          >
            {{ $t('admin.shop.fields.name') }}
          </label>
          <input
            id="shop-name"
            v-model="form.name"
            type="text"
            maxlength="120"
            required
            class="input w-full"
            :placeholder="$t('admin.shop.fields.namePlaceholder')"
          />
        </div>

        <div class="space-y-1">
          <label
            class="text-[10px] font-bold uppercase tracking-widest text-text-muted"
            for="shop-description"
          >
            {{ $t('admin.shop.fields.description') }}
          </label>
          <textarea
            id="shop-description"
            v-model="form.description"
            maxlength="1000"
            rows="2"
            class="input w-full"
            :placeholder="$t('admin.shop.fields.descriptionPlaceholder')"
          />
        </div>

        <!-- Type-specific payload -->
        <div v-if="form.type === 'upload_credit'" class="space-y-1">
          <label
            class="text-[10px] font-bold uppercase tracking-widest text-text-muted"
            for="shop-gib"
          >
            {{ $t('admin.shop.fields.uploadGiB') }}
          </label>
          <input
            id="shop-gib"
            v-model.number="form.payload.gib"
            type="number"
            min="1"
            step="1"
            required
            class="input w-full"
            placeholder="5"
          />
          <p class="text-[10px] text-text-muted font-mono">
            {{ $t('admin.shop.hints.uploadGiB') }}
          </p>
        </div>
        <div v-else-if="form.type === 'invite'" class="space-y-1">
          <label
            class="text-[10px] font-bold uppercase tracking-widest text-text-muted"
            for="shop-invite-count"
          >
            {{ $t('admin.shop.fields.inviteCount') }}
          </label>
          <input
            id="shop-invite-count"
            v-model.number="form.payload.count"
            type="number"
            min="1"
            max="10"
            step="1"
            required
            class="input w-full"
            placeholder="1"
          />
        </div>

        <!-- Cost + stock side-by-side -->
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label
              class="text-[10px] font-bold uppercase tracking-widest text-text-muted"
              for="shop-cost"
            >
              {{ $t('admin.shop.fields.cost') }}
            </label>
            <input
              id="shop-cost"
              v-model.number="form.cost"
              type="number"
              min="1"
              step="1"
              required
              class="input w-full font-mono tabular-nums"
            />
          </div>
          <div class="space-y-1">
            <label
              class="text-[10px] font-bold uppercase tracking-widest text-text-muted"
              for="shop-stock"
            >
              {{ $t('admin.shop.fields.stock') }}
              <span class="text-text-faint normal-case font-normal tracking-normal">
                · {{ $t('admin.shop.hints.stock') }}
              </span>
            </label>
            <input
              id="shop-stock"
              v-model.number="form.stock"
              type="number"
              min="0"
              step="1"
              class="input w-full font-mono tabular-nums"
              :placeholder="$t('admin.shop.fields.unlimited')"
            />
          </div>
        </div>

        <!-- Enabled toggle — switch row, not a checkbox-in-text -->
        <label
          class="flex items-center justify-between gap-3 px-3 py-2.5 border border-border rounded cursor-pointer hover:bg-bg-hover transition-colors"
        >
          <div>
            <p class="text-xs font-bold text-text-primary">
              {{ $t('admin.shop.fields.enabled') }}
            </p>
            <p class="text-[10px] text-text-muted mt-0.5">
              {{
                form.enabled
                  ? $t('admin.shop.enabledOn')
                  : $t('admin.shop.enabledOff')
              }}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="form.enabled"
            class="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
            :class="form.enabled ? 'bg-accent' : 'bg-fg-default/15'"
            @click="form.enabled = !form.enabled"
          >
            <span
              class="absolute top-0.5 w-4 h-4 rounded-full bg-bg-primary shadow transition-all"
              :class="form.enabled ? 'left-[1.125rem]' : 'left-0.5'"
            />
          </button>
        </label>

        <p
          v-if="formError"
          class="flex items-center gap-2 px-3 py-2 rounded bg-error/10 border border-error/30 text-xs text-error"
          role="alert"
        >
          <Icon name="ph:warning-circle-bold" class="text-base flex-shrink-0" />
          <span>{{ formError }}</span>
        </p>
      </form>

      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            class="text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded text-text-muted hover:bg-fg-default/5 transition-colors"
            @click="formOpen = false"
            :disabled="saving"
          >
            {{ $t('common.cancel') }}
          </button>
          <button
            type="button"
            class="text-xs font-bold uppercase tracking-widest px-4 py-1.5 rounded bg-accent text-accent-fg hover:bg-accent-hover transition-colors flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-progress"
            :disabled="saving"
            @click="saveItem"
          >
            <Icon
              :name="saving ? 'ph:circle-notch' : 'ph:check-circle-bold'"
              :class="saving ? 'animate-spin' : ''"
            />
            {{ saving ? $t('common.loading') : $t('common.saveChanges') }}
          </button>
        </div>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n();
const notifications = useNotificationStore();
const confirmDialog = useConfirm();

interface ShopItemRow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  type: 'upload_credit' | 'invite';
  payload: { bytes?: number; count?: number };
  cost: number;
  stock: number | null;
  enabled: boolean;
  createdAt: string;
}

const { data, pending, refresh } = await useFetch<{ items: ShopItemRow[] }>(
  '/api/admin/shop/items',
);
const items = computed(() => data.value?.items ?? []);

interface FormState {
  id: string | null;
  name: string;
  description: string;
  icon: string;
  type: 'upload_credit' | 'invite';
  payload: { gib?: number; count?: number };
  cost: number;
  stock: number | null;
  enabled: boolean;
}

const formOpen = ref(false);
const saving = ref(false);
const formError = ref<string | null>(null);
const form = reactive<FormState>(emptyForm());

function emptyForm(): FormState {
  return {
    id: null,
    name: '',
    description: '',
    icon: '',
    type: 'upload_credit',
    payload: { gib: 5 },
    cost: 100,
    stock: null,
    enabled: true,
  };
}

// Type cards for the picker — labels go through i18n at render time.
const TYPE_OPTIONS = computed(() => [
  {
    value: 'upload_credit' as const,
    label: t('admin.shop.types.uploadCredit'),
    sub: t('admin.shop.types.uploadCreditSub'),
    icon: 'ph:cloud-arrow-up-bold',
  },
  {
    value: 'invite' as const,
    label: t('admin.shop.types.invite'),
    sub: t('admin.shop.types.inviteSub'),
    icon: 'ph:envelope-simple-bold',
  },
]);

function defaultIconFor(type: string): string {
  return type === 'invite' ? 'ph:envelope-simple-bold' : 'ph:cloud-arrow-up-bold';
}

function typeLabel(type: string): string {
  if (type === 'upload_credit') return t('admin.shop.types.uploadCredit');
  if (type === 'invite') return t('admin.shop.types.invite');
  return type;
}

function effectLabel(item: ShopItemRow): string {
  if (item.type === 'upload_credit') {
    const bytes = Number(item.payload.bytes ?? 0);
    return t('shop.effects.uploadCredit', { size: formatSize(bytes) });
  }
  if (item.type === 'invite') {
    const c = Number(item.payload.count ?? 1);
    return t('shop.effects.invite', c, { n: c });
  }
  return '';
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1).replace(/\.0$/, '')} ${units[i]}`;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

function onPickType(value: 'upload_credit' | 'invite') {
  if (form.type === value) return;
  form.type = value;
  // Reset the type-specific payload to a sensible default so the
  // hidden field for the previous type doesn't leak its value into
  // the saved row.
  form.payload =
    value === 'upload_credit' ? { gib: 5 } : { count: 1 };
}

function openCreate() {
  Object.assign(form, emptyForm());
  formError.value = null;
  formOpen.value = true;
}

function openEdit(item: ShopItemRow) {
  formError.value = null;
  form.id = item.id;
  form.name = item.name;
  form.description = item.description ?? '';
  form.icon = item.icon ?? '';
  form.type = item.type;
  if (item.type === 'upload_credit') {
    form.payload = {
      gib: Math.round(Number(item.payload.bytes ?? 0) / (1024 * 1024 * 1024)),
    };
  } else {
    form.payload = { count: Number(item.payload.count ?? 1) };
  }
  form.cost = item.cost;
  form.stock = item.stock;
  form.enabled = item.enabled;
  formOpen.value = true;
}

async function saveItem() {
  if (saving.value) return;
  formError.value = null;
  let apiPayload: Record<string, number> = {};
  if (form.type === 'upload_credit') {
    const gib = Number(form.payload.gib ?? 0);
    if (gib <= 0) {
      formError.value = t('admin.shop.errors.uploadInvalid');
      return;
    }
    apiPayload = { bytes: gib * 1024 * 1024 * 1024 };
  } else if (form.type === 'invite') {
    const count = Number(form.payload.count ?? 0);
    if (count <= 0) {
      formError.value = t('admin.shop.errors.inviteInvalid');
      return;
    }
    apiPayload = { count };
  }

  const body = {
    name: form.name.trim(),
    description: form.description.trim() || null,
    icon: form.icon.trim() || null,
    type: form.type,
    payload: apiPayload,
    cost: form.cost,
    stock: form.stock,
    enabled: form.enabled,
  };

  saving.value = true;
  try {
    if (form.id) {
      await $fetch(`/api/admin/shop/items/${form.id}`, {
        method: 'PATCH',
        body,
      });
      notifications.success(t('admin.shop.toasts.updated'));
    } else {
      await $fetch('/api/admin/shop/items', {
        method: 'POST',
        body,
      });
      notifications.success(t('admin.shop.toasts.created'));
    }
    formOpen.value = false;
    await refresh();
  } catch (err: any) {
    formError.value = err?.data?.message || t('admin.shop.errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(item: ShopItemRow) {
  try {
    await $fetch(`/api/admin/shop/items/${item.id}`, {
      method: 'PATCH',
      body: { enabled: !item.enabled },
    });
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('admin.shop.errors.toggleFailed'));
  }
}

async function confirmDelete(item: ShopItemRow) {
  const ok = await confirmDialog.confirm({
    title: t('admin.shop.confirm.deleteTitle'),
    message: t('admin.shop.confirm.deleteMessage', { name: item.name }),
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
  });
  if (!ok) return;
  try {
    await $fetch(`/api/admin/shop/items/${item.id}`, { method: 'DELETE' });
    notifications.success(t('admin.shop.toasts.deleted'));
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('admin.shop.errors.deleteFailed'));
  }
}
</script>

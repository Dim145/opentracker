<template>
  <!--
    Staff broadcast: one message, to a cohort.

    The count is the point of this panel. Writing to four thousand people
    is a different act from writing to forty, and the only honest place to
    say which one is about to happen is before it happens — so the
    audience picker resolves to a number the moment it changes, and the
    send button carries that number.

    There is deliberately no "everybody". A private message to the whole
    membership is not a private message, it is an announcement, and the
    site has a banner and a notification feed that cost one row between
    them.
  -->
  <div class="card">
    <div class="card-header">
      <div class="flex items-center gap-2">
        <Icon name="ph:megaphone" class="text-text-muted" />
        <h3 class="text-xs font-bold uppercase tracking-wider text-text-primary">
          {{ $t('admin.broadcast.title') }}
        </h3>
      </div>
    </div>
    <div class="card-body space-y-6">
      <p class="text-xs text-text-muted leading-relaxed">
        {{ $t('admin.broadcast.description') }}
      </p>

      <SettingsGroup
        :control-id="fid('kind')"
        :label="$t('admin.broadcast.audience')"
        :description="$t('admin.broadcast.audienceHint')"
      >
        <div class="flex flex-wrap items-center gap-3">
          <select
            :id="fid('kind')"
            v-model="kind"
            class="w-full md:w-56 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-fg-default/20"
          >
            <option value="role">{{ $t('admin.broadcast.byRole') }}</option>
            <option value="inactive">{{ $t('admin.broadcast.byInactive') }}</option>
            <option value="hnr">{{ $t('admin.broadcast.byHnr') }}</option>
            <option value="staff">{{ $t('admin.broadcast.byStaff') }}</option>
          </select>

          <select
            v-if="kind === 'role'"
            v-model="roleId"
            :aria-label="$t('admin.broadcast.roleLabel')"
            class="w-full md:w-56 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-fg-default/20"
          >
            <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>

          <div v-if="kind === 'inactive'" class="flex items-center gap-2">
            <input
              v-model.number="days"
              type="number"
              :aria-label="$t('admin.broadcast.inactiveDaysLabel')"
              min="7"
              max="3650"
              class="w-24 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-fg-default/20 font-mono"
            />
            <span class="text-xs text-text-muted">{{ $t('admin.broadcast.daysLabel') }}</span>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup
          :control-id="fid('message')"
        :label="$t('admin.broadcast.message')"
        :description="$t('admin.broadcast.messageHint')"
      >
        <textarea
          :id="fid('message')"
          v-model="body"
          rows="5"
          maxlength="4000"
          class="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-fg-default/20"
        />
      </SettingsGroup>

      <p class="text-xs" :class="count && count > 500 ? 'text-warning' : 'text-text-muted'">
        <Icon name="ph:users" class="inline" />
        {{
          count === null
            ? $t('admin.broadcast.counting')
            : $t('admin.broadcast.willReach', { count })
        }}
      </p>

      <button
        @click="send"
        :disabled="sending || !body.trim() || !count"
        class="w-full text-[10px] font-bold uppercase tracking-widest py-2.5 rounded transition-all disabled:opacity-50 flex items-center justify-center gap-2 bg-text-primary text-bg-primary hover:opacity-90"
      >
        <Icon v-if="sending" name="ph:circle-notch" class="animate-spin" />
        {{ $t('admin.broadcast.send') }}
      </button>
      <p v-if="error" class="text-xs text-error">{{ error }}</p>

      <div v-if="history.length" class="space-y-1">
        <p class="eyebrow">{{ $t('admin.broadcast.recent') }}</p>
        <p
          v-for="h in history"
          :key="h.id"
          class="text-xs text-text-muted font-mono flex items-center gap-2"
        >
          <span>{{ new Date(h.createdAt).toLocaleString() }}</span>
          <span>{{ h.audience }}</span>
          <!-- sent/total, not a percentage: a broadcast that stopped at
               3980 of 4213 should show the two numbers, not "94%". -->
          <span :class="h.error ? 'text-error' : ''">{{ h.sent }}/{{ h.total }}</span>
          <span v-if="!h.finishedAt" class="text-warning">{{ $t('admin.broadcast.running') }}</span>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Les libellés de `SettingsGroup` ne désignaient aucun champ : ni `for`, ni
// imbrication. Voir `useFieldIds()`.
const fid = useFieldIds();

interface Row {
  id: string;
  audience: string;
  total: number;
  sent: number;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
}

const { t } = useI18n();

const kind = ref<'role' | 'inactive' | 'hnr' | 'staff'>('staff');
const roleId = ref('');
const days = ref(180);
const body = ref('');
const count = ref<number | null>(null);
const history = ref<Row[]>([]);
const sending = ref(false);
const error = ref('');

const { data: roleData } = await useFetch<{ roles?: Array<{ id: string; name: string }> }>(
  '/api/admin/roles',
);
const roles = computed(() => roleData.value?.roles ?? []);
watch(roles, (r) => {
  if (!roleId.value && r.length) roleId.value = r[0]!.id;
}, { immediate: true });

const audience = computed(() =>
  kind.value === 'role'
    ? `role:${roleId.value}`
    : kind.value === 'inactive'
      ? `inactive:${days.value}`
      : kind.value,
);

async function refresh() {
  count.value = null;
  try {
    const r = await $fetch<{ count: number | null; history: Row[] }>(
      '/api/admin/messaging/broadcast',
      { query: { audience: audience.value } },
    );
    count.value = r.count;
    history.value = r.history ?? [];
  } catch {
    count.value = 0;
  }
}

// Recount whenever the audience changes, so the number under the box is
// never describing a different cohort than the one selected.
watch(audience, () => void refresh(), { immediate: true });

async function send() {
  error.value = '';
  sending.value = true;
  try {
    await $fetch('/api/admin/messaging/broadcast', {
      method: 'POST',
      body: { audience: audience.value, body: body.value.trim() },
    });
    body.value = '';
    // The route returns as soon as the row exists; delivery runs behind
    // it, so the history is what reports progress.
    await refresh();
  } catch (err) {
    error.value =
      (err as { data?: { message?: string } })?.data?.message ?? t('admin.broadcast.failed');
  } finally {
    sending.value = false;
  }
}
</script>

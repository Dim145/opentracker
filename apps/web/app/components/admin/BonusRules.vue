<template>
  <!--
    Bonus-earning rules + tier curves admin.
    Three cards stacked vertically:
      1. Earning rules — five rule kinds with kind-specific config editors.
      2. Seed-count tier curve — fewer seeders ⇒ higher multiplier.
      3. Age tier curve — older torrents ⇒ higher multiplier.
  -->
  <div class="space-y-6">
    <!-- ─────────────────────────────  RULES  ───────────────────────────── -->
    <div class="card">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <Icon name="ph:strategy" class="text-text-muted" />
          <h3
            class="text-xs font-bold uppercase tracking-wider text-text-primary"
          >
            {{ $t('admin.bonusRules.rules.title') }}
          </h3>
        </div>
      </div>
      <div class="card-body space-y-3">
        <p class="text-xs text-text-muted leading-relaxed max-w-3xl">
          {{ $t('admin.bonusRules.rules.intro') }}
        </p>

        <div v-if="pending" class="py-12 flex justify-center">
          <Icon name="ph:circle-notch" class="animate-spin text-2xl text-text-muted" />
        </div>

        <ul v-else class="space-y-2">
          <li
            v-for="r in rules"
            :key="r.kind"
            class="border border-border rounded p-3 space-y-3"
            :class="{ 'opacity-60': !r.enabled }"
          >
            <div class="flex items-start justify-between gap-3 flex-wrap">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 mb-1 flex-wrap">
                  <Icon
                    :name="kindIcon(r.kind)"
                    class="text-text-secondary text-base"
                  />
                  <span class="text-sm font-bold text-text-primary">
                    {{ $t(`admin.bonusRules.kinds.${r.kind}.name`) }}
                  </span>
                  <span
                    class="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border border-border text-text-muted"
                  >
                    {{ r.kind }}
                  </span>
                </div>
                <p class="text-xs text-text-muted leading-snug max-w-3xl">
                  {{ $t(`admin.bonusRules.kinds.${r.kind}.description`) }}
                </p>
              </div>

              <div class="flex items-center gap-2 flex-shrink-0">
                <span
                  class="text-[10px] font-bold uppercase tracking-widest"
                  :class="r.enabled ? 'text-success' : 'text-text-muted'"
                >
                  {{ r.enabled ? $t('admin.bonusRules.on') : $t('admin.bonusRules.off') }}
                </span>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="r.enabled"
                  class="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
                  :class="r.enabled ? 'bg-accent' : 'bg-fg-default/15'"
                  @click="toggleRule(r)"
                >
                  <span
                    class="absolute top-0.5 w-4 h-4 rounded-full bg-bg-primary shadow transition-all"
                    :class="r.enabled ? 'left-[1.125rem]' : 'left-0.5'"
                  />
                </button>
              </div>
            </div>

            <!-- ───────  Kind-specific config editor  ─────── -->
            <div class="border-t border-border pt-3">
              <!-- seeding -->
              <div v-if="r.kind === 'seeding'" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="space-y-1">
                  <span class="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                    {{ $t('admin.bonusRules.fields.pointsPerHourPerSeed') }}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    class="input w-full font-mono tabular-nums"
                    :value="(r.config as any).pointsPerHourPerSeed"
                    @change="
                      patchConfig(r, {
                        pointsPerHourPerSeed: Number(($event.target as HTMLInputElement).value),
                      })
                    "
                  />
                </label>
              </div>

              <!-- first_seeder -->
              <div v-else-if="r.kind === 'first_seeder'" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="space-y-1">
                  <span class="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                    {{ $t('admin.bonusRules.fields.reward') }}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    class="input w-full font-mono tabular-nums"
                    :value="(r.config as any).reward"
                    @change="
                      patchConfig(r, {
                        reward: Number(($event.target as HTMLInputElement).value),
                      })
                    "
                  />
                </label>
              </div>

              <!-- seeding_milestone -->
              <div v-else-if="r.kind === 'seeding_milestone'" class="space-y-2">
                <p class="text-[10px] font-mono uppercase tracking-widest text-text-muted">
                  {{ $t('admin.bonusRules.fields.thresholds') }}
                </p>
                <ul class="space-y-1.5">
                  <li
                    v-for="(t, idx) in (r.config as any).thresholds"
                    :key="idx"
                    class="grid grid-cols-[auto_1fr_1fr_auto] gap-2 items-center"
                  >
                    <span class="text-[10px] font-mono text-text-faint w-6 text-right tabular-nums">
                      {{ String(idx + 1).padStart(2, '0') }}
                    </span>
                    <label class="flex items-center gap-1.5">
                      <span class="text-[10px] font-mono uppercase tracking-widest text-text-muted">
                        {{ $t('admin.bonusRules.fields.hours') }}
                      </span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        class="input w-full font-mono tabular-nums"
                        :value="t.hours"
                        @change="
                          patchMilestone(r, idx, {
                            hours: Number(($event.target as HTMLInputElement).value),
                          })
                        "
                      />
                    </label>
                    <label class="flex items-center gap-1.5">
                      <span class="text-[10px] font-mono uppercase tracking-widest text-text-muted">
                        {{ $t('admin.bonusRules.fields.reward') }}
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        class="input w-full font-mono tabular-nums"
                        :value="t.reward"
                        @change="
                          patchMilestone(r, idx, {
                            reward: Number(($event.target as HTMLInputElement).value),
                          })
                        "
                      />
                    </label>
                    <button
                      type="button"
                      class="btn btn-xs btn-ghost text-error"
                      :title="$t('common.delete')"
                      @click="removeMilestone(r, idx)"
                    >
                      <Icon name="ph:trash" class="text-sm" />
                    </button>
                  </li>
                </ul>
                <button
                  type="button"
                  class="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded border border-dashed border-border hover:border-fg-default/30 text-text-muted hover:text-text-strong transition-colors flex items-center gap-1.5"
                  @click="addMilestone(r)"
                >
                  <Icon name="ph:plus-bold" />
                  {{ $t('admin.bonusRules.addMilestone') }}
                </button>
              </div>

              <!-- daily_login -->
              <div v-else-if="r.kind === 'daily_login'" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="space-y-1">
                  <span class="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                    {{ $t('admin.bonusRules.fields.reward') }}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    class="input w-full font-mono tabular-nums"
                    :value="(r.config as any).reward"
                    @change="
                      patchConfig(r, {
                        reward: Number(($event.target as HTMLInputElement).value),
                      })
                    "
                  />
                </label>
              </div>

              <!-- account_age_monthly -->
              <div v-else-if="r.kind === 'account_age_monthly'" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="space-y-1">
                  <span class="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                    {{ $t('admin.bonusRules.fields.rewardPerMonth') }}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    class="input w-full font-mono tabular-nums"
                    :value="(r.config as any).rewardPerMonth"
                    @change="
                      patchConfig(r, {
                        rewardPerMonth: Number(($event.target as HTMLInputElement).value),
                      })
                    "
                  />
                </label>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- ──────────────────────  SEED-COUNT TIERS  ────────────────────── -->
    <div class="card">
      <div class="card-header">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <Icon name="ph:users-three" class="text-text-muted" />
            <h3
              class="text-xs font-bold uppercase tracking-wider text-text-primary"
            >
              {{ $t('admin.bonusRules.seedTiers.title') }}
            </h3>
            <span
              class="text-[10px] font-mono text-text-muted px-1.5 py-0.5 rounded border border-border"
            >
              {{ seedCountTiers.length }}
            </span>
          </div>
          <button
            type="button"
            class="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded bg-accent text-accent-fg hover:bg-accent-hover transition-colors flex items-center gap-1.5"
            @click="addSeedTier"
          >
            <Icon name="ph:plus-bold" />
            {{ $t('admin.bonusRules.addTier') }}
          </button>
        </div>
      </div>
      <div class="card-body space-y-3">
        <p class="text-xs text-text-muted leading-relaxed max-w-3xl">
          {{ $t('admin.bonusRules.seedTiers.intro') }}
        </p>
        <ul v-if="seedCountTiers.length" class="space-y-2">
          <li
            v-for="(t, idx) in seedCountTiers"
            :key="t.id"
            class="border border-border rounded p-3 grid grid-cols-[auto_1fr_1fr_auto_auto] gap-3 items-center"
            :class="{ 'opacity-60': !t.enabled }"
          >
            <span class="text-[10px] font-mono text-text-faint w-6 text-right tabular-nums">
              {{ String(idx + 1).padStart(2, '0') }}
            </span>
            <label class="flex items-center gap-2">
              <span class="text-[10px] font-mono uppercase tracking-widest text-text-muted whitespace-nowrap">
                {{ $t('admin.bonusRules.fields.maxSeeders') }}
              </span>
              <input
                type="number"
                min="0"
                step="1"
                class="input w-full font-mono tabular-nums"
                :value="t.maxSeeders"
                @change="patchSeedTier(t, { maxSeeders: Number(($event.target as HTMLInputElement).value) })"
              />
            </label>
            <label class="flex items-center gap-2">
              <span class="text-[10px] font-mono uppercase tracking-widest text-text-muted whitespace-nowrap">
                {{ $t('admin.bonusRules.fields.multiplier') }}
              </span>
              <input
                type="number"
                min="0"
                step="1"
                class="input w-full font-mono tabular-nums"
                :value="t.multiplier"
                @change="patchSeedTier(t, { multiplier: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="text-[10px] font-mono text-text-muted whitespace-nowrap">
                ×{{ (t.multiplier / 100).toFixed(2).replace(/\.?0+$/, '') || '0' }}
              </span>
            </label>
            <button
              type="button"
              role="switch"
              :aria-checked="t.enabled"
              class="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
              :class="t.enabled ? 'bg-accent' : 'bg-fg-default/15'"
              @click="patchSeedTier(t, { enabled: !t.enabled })"
            >
              <span
                class="absolute top-0.5 w-4 h-4 rounded-full bg-bg-primary shadow transition-all"
                :class="t.enabled ? 'left-[1.125rem]' : 'left-0.5'"
              />
            </button>
            <button
              type="button"
              class="btn btn-xs btn-ghost text-error"
              :title="$t('common.delete')"
              @click="deleteSeedTier(t)"
            >
              <Icon name="ph:trash" class="text-sm" />
            </button>
          </li>
        </ul>
        <p v-else class="text-xs text-text-muted italic">
          {{ $t('admin.bonusRules.seedTiers.empty') }}
        </p>
      </div>
    </div>

    <!-- ────────────────────────  AGE TIERS  ──────────────────────── -->
    <div class="card">
      <div class="card-header">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <Icon name="ph:hourglass" class="text-text-muted" />
            <h3
              class="text-xs font-bold uppercase tracking-wider text-text-primary"
            >
              {{ $t('admin.bonusRules.ageTiers.title') }}
            </h3>
            <span
              class="text-[10px] font-mono text-text-muted px-1.5 py-0.5 rounded border border-border"
            >
              {{ ageTiers.length }}
            </span>
          </div>
          <button
            type="button"
            class="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded bg-accent text-accent-fg hover:bg-accent-hover transition-colors flex items-center gap-1.5"
            @click="addAgeTier"
          >
            <Icon name="ph:plus-bold" />
            {{ $t('admin.bonusRules.addTier') }}
          </button>
        </div>
      </div>
      <div class="card-body space-y-3">
        <p class="text-xs text-text-muted leading-relaxed max-w-3xl">
          {{ $t('admin.bonusRules.ageTiers.intro') }}
        </p>
        <ul v-if="ageTiers.length" class="space-y-2">
          <li
            v-for="(t, idx) in ageTiers"
            :key="t.id"
            class="border border-border rounded p-3 grid grid-cols-[auto_1fr_1fr_auto_auto] gap-3 items-center"
            :class="{ 'opacity-60': !t.enabled }"
          >
            <span class="text-[10px] font-mono text-text-faint w-6 text-right tabular-nums">
              {{ String(idx + 1).padStart(2, '0') }}
            </span>
            <label class="flex items-center gap-2">
              <span class="text-[10px] font-mono uppercase tracking-widest text-text-muted whitespace-nowrap">
                {{ $t('admin.bonusRules.fields.minAgeDays') }}
              </span>
              <input
                type="number"
                min="0"
                step="1"
                class="input w-full font-mono tabular-nums"
                :value="t.minAgeDays"
                @change="patchAgeTier(t, { minAgeDays: Number(($event.target as HTMLInputElement).value) })"
              />
            </label>
            <label class="flex items-center gap-2">
              <span class="text-[10px] font-mono uppercase tracking-widest text-text-muted whitespace-nowrap">
                {{ $t('admin.bonusRules.fields.multiplier') }}
              </span>
              <input
                type="number"
                min="0"
                step="1"
                class="input w-full font-mono tabular-nums"
                :value="t.multiplier"
                @change="patchAgeTier(t, { multiplier: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="text-[10px] font-mono text-text-muted whitespace-nowrap">
                ×{{ (t.multiplier / 100).toFixed(2).replace(/\.?0+$/, '') || '0' }}
              </span>
            </label>
            <button
              type="button"
              role="switch"
              :aria-checked="t.enabled"
              class="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
              :class="t.enabled ? 'bg-accent' : 'bg-fg-default/15'"
              @click="patchAgeTier(t, { enabled: !t.enabled })"
            >
              <span
                class="absolute top-0.5 w-4 h-4 rounded-full bg-bg-primary shadow transition-all"
                :class="t.enabled ? 'left-[1.125rem]' : 'left-0.5'"
              />
            </button>
            <button
              type="button"
              class="btn btn-xs btn-ghost text-error"
              :title="$t('common.delete')"
              @click="deleteAgeTier(t)"
            >
              <Icon name="ph:trash" class="text-sm" />
            </button>
          </li>
        </ul>
        <p v-else class="text-xs text-text-muted italic">
          {{ $t('admin.bonusRules.ageTiers.empty') }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n();
const notifications = useNotificationStore();

interface BonusRule {
  id: string;
  kind:
    | 'seeding'
    | 'first_seeder'
    | 'seeding_milestone'
    | 'daily_login'
    | 'account_age_monthly';
  enabled: boolean;
  config: Record<string, unknown>;
}
interface SeedTier {
  id: string;
  maxSeeders: number;
  multiplier: number;
  enabled: boolean;
}
interface AgeTier {
  id: string;
  minAgeDays: number;
  multiplier: number;
  enabled: boolean;
}

const { data, pending, refresh } = await useFetch<{
  rules: BonusRule[];
  seedCountTiers: SeedTier[];
  ageTiers: AgeTier[];
}>('/api/admin/bonus-rules');

const rules = computed(() => data.value?.rules ?? []);
const seedCountTiers = computed(() => data.value?.seedCountTiers ?? []);
const ageTiers = computed(() => data.value?.ageTiers ?? []);

function kindIcon(kind: string): string {
  switch (kind) {
    case 'seeding':
      return 'ph:upload-simple';
    case 'first_seeder':
      return 'ph:medal';
    case 'seeding_milestone':
      return 'ph:flag-banner';
    case 'daily_login':
      return 'ph:calendar-check';
    case 'account_age_monthly':
      return 'ph:hourglass-medium';
    default:
      return 'ph:gear';
  }
}

async function patchRule(
  rule: BonusRule,
  body: { enabled?: boolean; config?: Record<string, unknown> },
) {
  try {
    await $fetch(`/api/admin/bonus-rules/rule/${rule.kind}`, {
      method: 'PATCH',
      body,
    });
    notifications.success(t('admin.bonusRules.toasts.ruleUpdated'));
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('admin.bonusRules.errors.updateFailed'));
  }
}

function toggleRule(rule: BonusRule) {
  patchRule(rule, { enabled: !rule.enabled });
}

function patchConfig(rule: BonusRule, partial: Record<string, unknown>) {
  patchRule(rule, { config: { ...rule.config, ...partial } });
}

// ─── Milestone (seeding_milestone) helpers ───
interface MilestoneEntry { hours: number; reward: number }
function getMilestones(rule: BonusRule): MilestoneEntry[] {
  return (rule.config?.thresholds as MilestoneEntry[]) ?? [];
}
function patchMilestone(rule: BonusRule, idx: number, partial: Partial<MilestoneEntry>) {
  const next = [...getMilestones(rule)];
  next[idx] = { ...next[idx], ...partial };
  patchRule(rule, { config: { ...rule.config, thresholds: next } });
}
function addMilestone(rule: BonusRule) {
  // Sensible default — half a day, modest reward. Admin tunes from there.
  const next = [...getMilestones(rule), { hours: 24, reward: 25 }];
  patchRule(rule, { config: { ...rule.config, thresholds: next } });
}
function removeMilestone(rule: BonusRule, idx: number) {
  const next = getMilestones(rule).filter((_, i) => i !== idx);
  patchRule(rule, { config: { ...rule.config, thresholds: next } });
}

// ─── Seed-count tier helpers ───
async function addSeedTier() {
  try {
    await $fetch('/api/admin/bonus-rules/tiers/seed-count', {
      method: 'POST',
      body: { maxSeeders: 10, multiplier: 100, enabled: true },
    });
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('admin.bonusRules.errors.tierAddFailed'));
  }
}
async function patchSeedTier(tier: SeedTier, body: Partial<SeedTier>) {
  try {
    await $fetch(`/api/admin/bonus-rules/tiers/seed-count/${tier.id}`, {
      method: 'PATCH',
      body,
    });
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('admin.bonusRules.errors.tierUpdateFailed'));
  }
}
async function deleteSeedTier(tier: SeedTier) {
  try {
    await $fetch(`/api/admin/bonus-rules/tiers/seed-count/${tier.id}`, {
      method: 'DELETE',
    });
    notifications.success(t('admin.bonusRules.toasts.tierDeleted'));
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('admin.bonusRules.errors.tierDeleteFailed'));
  }
}

// ─── Age tier helpers ───
async function addAgeTier() {
  try {
    await $fetch('/api/admin/bonus-rules/tiers/age', {
      method: 'POST',
      body: { minAgeDays: 0, multiplier: 100, enabled: true },
    });
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('admin.bonusRules.errors.tierAddFailed'));
  }
}
async function patchAgeTier(tier: AgeTier, body: Partial<AgeTier>) {
  try {
    await $fetch(`/api/admin/bonus-rules/tiers/age/${tier.id}`, {
      method: 'PATCH',
      body,
    });
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('admin.bonusRules.errors.tierUpdateFailed'));
  }
}
async function deleteAgeTier(tier: AgeTier) {
  try {
    await $fetch(`/api/admin/bonus-rules/tiers/age/${tier.id}`, {
      method: 'DELETE',
    });
    notifications.success(t('admin.bonusRules.toasts.tierDeleted'));
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('admin.bonusRules.errors.tierDeleteFailed'));
  }
}
</script>

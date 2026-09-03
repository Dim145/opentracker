<template>
  <!--
    Bonus-economy admin — monetary-policy console.

    Three numbered sections:
      01 — Earning rules: 5 rule kinds with kind-specific editors,
            each colour-coded by what it rewards.
      02 — Seed-count tier curve: step-function SVG viz + editable
            tier list. Lower seeders → higher multiplier (rare-swarm
            premium).
      03 — Age tier curve: step-function SVG viz + editable tier list.
            Older torrents → higher multiplier (longevity premium).

    Above all of that, a "policy snapshot" strip surfaces the
    current state of the economy at a glance: how many rules are
    armed, how many tiers cover seed scarcity vs age, and what
    multiplier range admins have set.

    The tier curves are the centrepiece of the redesign — they let
    an operator SEE the multiplier policy as a step function in
    gold against a hairline grid before they think about editing
    tuples below.
  -->
  <div class="bre">
    <!-- ── Policy snapshot strip ──────────────────────────────── -->
    <section class="snapshot">
      <article class="snap snap--rules">
        <span class="snap-num tabular-nums">
          <strong>{{ enabledRulesCount }}</strong>
          <span class="snap-frac">/{{ rules.length }}</span>
        </span>
        <span class="snap-label">{{ $t('admin.bonusRules.snap.rulesActive') }}</span>
        <Icon name="ph:strategy-bold" class="snap-icon" />
      </article>
      <article class="snap snap--seed">
        <span class="snap-num tabular-nums">
          <strong>{{ enabledSeedTiers.length }}</strong>
          <span class="snap-frac">/{{ seedCountTiers.length }}</span>
        </span>
        <span class="snap-label">{{ $t('admin.bonusRules.snap.seedTiers') }}</span>
        <Icon name="ph:users-three-bold" class="snap-icon" />
      </article>
      <article class="snap snap--age">
        <span class="snap-num tabular-nums">
          <strong>{{ enabledAgeTiers.length }}</strong>
          <span class="snap-frac">/{{ ageTiers.length }}</span>
        </span>
        <span class="snap-label">{{ $t('admin.bonusRules.snap.ageTiers') }}</span>
        <Icon name="ph:hourglass-medium-bold" class="snap-icon" />
      </article>
      <article class="snap snap--range">
        <span class="snap-num tabular-nums">{{ multiplierRangeLabel }}</span>
        <span class="snap-label">{{ $t('admin.bonusRules.snap.range') }}</span>
        <Icon name="ph:wave-sine-bold" class="snap-icon" />
      </article>
    </section>

    <!-- ── Section 01 — Earning rules ────────────────────────── -->
    <section class="block">
      <header class="block-head">
        <span class="block-num">01</span>
        <div class="block-id">
          <h2>{{ $t('admin.bonusRules.rules.title') }}</h2>
          <p>{{ $t('admin.bonusRules.rules.intro') }}</p>
        </div>
        <span class="block-meta">
          <strong>{{ enabledRulesCount }}</strong>
          / {{ rules.length }} {{ $t('admin.bonusRules.snap.armed') }}
        </span>
      </header>

      <div v-if="pending" class="empty empty--loading">
        <Icon name="ph:circle-notch" class="animate-spin" />
      </div>

      <ul v-else class="rule-grid">
        <li
          v-for="(r, i) in rules"
          :key="r.kind"
          class="rule"
          :class="[
            `rule--${r.kind}`,
            { 'rule--off': !r.enabled },
          ]"
          :style="{ '--stagger': `${i * 60}ms` }"
        >
          <header class="rule-head">
            <span class="rule-glyph" :style="`--rule-color: ${kindColor(r.kind)}`">
              <Icon :name="kindIcon(r.kind)" />
            </span>
            <div class="rule-id">
              <h3 class="rule-name">
                {{ $t(`admin.bonusRules.kinds.${r.kind}.name`) }}
              </h3>
              <p class="rule-desc">
                {{ $t(`admin.bonusRules.kinds.${r.kind}.description`) }}
              </p>
            </div>
            <span class="rule-state">
              <span class="rule-state-text" :class="{ 'rule-state-text--on': r.enabled }">
                {{ r.enabled ? $t('admin.bonusRules.on') : $t('admin.bonusRules.off') }}
              </span>
              <label class="rule-toggle">
                <input
                  type="checkbox"
                  :checked="r.enabled"
                  @change="toggleRule(r)"
                />
                <span class="rule-toggle-track" :style="`--rule-color: ${kindColor(r.kind)}`" />
              </label>
            </span>
          </header>

          <!-- Kind-specific editor — each kind has its own purpose-built
               form rather than a generic key:value grid. -->
          <div class="rule-body">
            <!-- seeding — flat points per hour per seed -->
            <div v-if="r.kind === 'seeding'" class="rule-form">
              <label class="field">
                <span class="field-label">
                  {{ $t('admin.bonusRules.fields.pointsPerHourPerSeed') }}
                  <span class="field-unit">pts/h</span>
                </span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  class="field-input"
                  :value="(r.config as any).pointsPerHourPerSeed"
                  @change="patchConfig(r, { pointsPerHourPerSeed: Number(($event.target as HTMLInputElement).value) })"
                />
                <span class="field-hint">
                  {{ $t('admin.bonusRules.kinds.seeding.hint', {
                    value: (r.config as any).pointsPerHourPerSeed || 0,
                  }) }}
                </span>
              </label>
            </div>

            <!-- first_seeder — single one-shot reward -->
            <div v-else-if="r.kind === 'first_seeder'" class="rule-form">
              <label class="field">
                <span class="field-label">
                  {{ $t('admin.bonusRules.fields.reward') }}
                  <span class="field-unit">pts</span>
                </span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  class="field-input"
                  :value="(r.config as any).reward"
                  @change="patchConfig(r, { reward: Number(($event.target as HTMLInputElement).value) })"
                />
                <span class="field-hint">
                  {{ $t('admin.bonusRules.kinds.first_seeder.hint') }}
                </span>
              </label>
            </div>

            <!-- daily_login — single reward -->
            <div v-else-if="r.kind === 'daily_login'" class="rule-form">
              <label class="field">
                <span class="field-label">
                  {{ $t('admin.bonusRules.fields.reward') }}
                  <span class="field-unit">pts</span>
                </span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  class="field-input"
                  :value="(r.config as any).reward"
                  @change="patchConfig(r, { reward: Number(($event.target as HTMLInputElement).value) })"
                />
                <span class="field-hint">
                  {{ $t('admin.bonusRules.kinds.daily_login.hint') }}
                </span>
              </label>
            </div>

            <!-- account_age_monthly — monthly recurring reward -->
            <div v-else-if="r.kind === 'account_age_monthly'" class="rule-form">
              <label class="field">
                <span class="field-label">
                  {{ $t('admin.bonusRules.fields.rewardPerMonth') }}
                  <span class="field-unit">pts/mo</span>
                </span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  class="field-input"
                  :value="(r.config as any).rewardPerMonth"
                  @change="patchConfig(r, { rewardPerMonth: Number(($event.target as HTMLInputElement).value) })"
                />
                <span class="field-hint">
                  {{ $t('admin.bonusRules.kinds.account_age_monthly.hint') }}
                </span>
              </label>
            </div>

            <!-- seeding_milestone — list of (hours, reward) thresholds -->
            <div v-else-if="r.kind === 'seeding_milestone'" class="rule-form rule-form--milestones">
              <header class="milestones-head">
                <span class="milestones-label">
                  {{ $t('admin.bonusRules.fields.thresholds') }}
                </span>
                <button
                  type="button"
                  class="cbtn cbtn--ghost cbtn--sm"
                  @click="addMilestone(r)"
                >
                  <Icon name="ph:plus-bold" />
                  {{ $t('admin.bonusRules.addMilestone') }}
                </button>
              </header>
              <ul
                v-if="getMilestones(r).length > 0"
                class="milestones"
              >
                <li
                  v-for="(m, idx) in getMilestones(r)"
                  :key="idx"
                  class="milestone"
                >
                  <span class="milestone-num tabular-nums">{{ String(idx + 1).padStart(2, '0') }}</span>
                  <label class="milestone-field">
                    <span class="milestone-field-label">{{ $t('admin.bonusRules.fields.hours') }}</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      class="field-input field-input--sm"
                      :value="m.hours"
                      @change="patchMilestone(r, idx, { hours: Number(($event.target as HTMLInputElement).value) })"
                    />
                  </label>
                  <span class="milestone-arrow"><Icon name="ph:arrow-right" /></span>
                  <label class="milestone-field">
                    <span class="milestone-field-label">{{ $t('admin.bonusRules.fields.reward') }}</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      class="field-input field-input--sm"
                      :value="m.reward"
                      @change="patchMilestone(r, idx, { reward: Number(($event.target as HTMLInputElement).value) })"
                    />
                  </label>
                  <button
                    type="button"
                    class="icon-btn icon-btn--danger"
                    :title="$t('common.delete')"
                    @click="removeMilestone(r, idx)"
                  >
                    <Icon name="ph:trash-bold" />
                  </button>
                </li>
              </ul>
              <p v-else class="milestones-empty">
                {{ $t('admin.bonusRules.kinds.seeding_milestone.empty') }}
              </p>
            </div>
          </div>
        </li>
      </ul>
    </section>

    <!-- ── Section 02 — Seed-count tier curve ─────────────────── -->
    <section class="block">
      <header class="block-head">
        <span class="block-num">02</span>
        <div class="block-id">
          <h2>{{ $t('admin.bonusRules.seedTiers.title') }}</h2>
          <p>{{ $t('admin.bonusRules.seedTiers.intro') }}</p>
        </div>
        <span class="block-meta">
          <strong>{{ seedCountTiers.length }}</strong>
          {{ $t('admin.bonusRules.snap.tiers', { n: seedCountTiers.length }, seedCountTiers.length) }}
        </span>
      </header>

      <div class="curve-card">
        <TierCurve
          :tiers="seedCurveData"
          :x-label="$t('admin.bonusRules.fields.maxSeeders')"
          :x-unit="$t('admin.bonusRules.units.seeders')"
          accent="#34d4d8"
          direction="desc"
          :empty-label="$t('admin.bonusRules.seedTiers.empty')"
        />
        <p v-if="seedCurveHiddenCount > 0" class="curve-footnote">
          <Icon name="ph:info" />
          {{ $t('admin.bonusRules.seedTiers.curveHidden', { n: seedCurveHiddenCount }, seedCurveHiddenCount) }}
        </p>
      </div>

      <header class="tier-list-head">
        <span class="tier-list-label">{{ $t('admin.bonusRules.seedTiers.editLabel') }}</span>
        <button
          type="button"
          class="cbtn cbtn--primary cbtn--sm"
          @click="addSeedTier"
        >
          <Icon name="ph:plus-bold" />
          {{ $t('admin.bonusRules.addTier') }}
        </button>
      </header>

      <ul v-if="seedCountTiers.length > 0" class="tier-list">
        <li
          v-for="(t, idx) in seedCountTiers"
          :key="t.id"
          class="tier"
          :class="{ 'tier--off': !t.enabled }"
          :style="{ '--stagger': `${idx * 40}ms` }"
        >
          <span class="tier-num tabular-nums">{{ String(idx + 1).padStart(2, '0') }}</span>
          <label class="tier-field">
            <span class="tier-field-label">{{ $t('admin.bonusRules.fields.maxSeeders') }}</span>
            <input
              type="number"
              min="0"
              step="1"
              class="field-input"
              :value="t.maxSeeders"
              @change="patchSeedTier(t, { maxSeeders: Number(($event.target as HTMLInputElement).value) })"
            />
            <span class="tier-field-unit">{{ $t('admin.bonusRules.units.seedersOrFewer') }}</span>
          </label>
          <span class="tier-arrow"><Icon name="ph:arrow-right-bold" /></span>
          <label class="tier-field">
            <span class="tier-field-label">
              {{ $t('admin.bonusRules.fields.multiplier') }}
              <!-- Le champ se saisit en centièmes : 150 vaut ×1,50. Rien ne le
                   disait — un opérateur qui tapait « 2 » pour doubler la
                   récompense la divisait par cinquante. -->
              <span class="tier-field-note">{{ $t('admin.bonusRules.units.hundredths') }}</span>
            </span>
            <input
              type="number"
              min="0"
              step="1"
              class="field-input"
              :value="t.multiplier"
              @change="patchSeedTier(t, { multiplier: Number(($event.target as HTMLInputElement).value) })"
            />
            <span class="tier-field-unit tabular-nums">
              ×{{ formatMultiplier(t.multiplier) }}
            </span>
          </label>
          <span class="tier-actions">
            <label class="rule-toggle rule-toggle--sm">
              <input
                type="checkbox"
                :checked="t.enabled"
                @change="patchSeedTier(t, { enabled: !t.enabled })"
              />
              <span class="rule-toggle-track" :style="`--rule-color: #34d4d8`" />
            </label>
            <button
              type="button"
              class="icon-btn icon-btn--danger"
              :title="$t('common.delete')"
              @click="deleteSeedTier(t)"
            >
              <Icon name="ph:trash-bold" />
            </button>
          </span>
        </li>
      </ul>
      <p v-else class="tier-empty">
        {{ $t('admin.bonusRules.seedTiers.empty') }}
      </p>
    </section>

    <!-- ── Section 03 — Age tier curve ────────────────────────── -->
    <section class="block">
      <header class="block-head">
        <span class="block-num">03</span>
        <div class="block-id">
          <h2>{{ $t('admin.bonusRules.ageTiers.title') }}</h2>
          <p>{{ $t('admin.bonusRules.ageTiers.intro') }}</p>
        </div>
        <span class="block-meta">
          <strong>{{ ageTiers.length }}</strong>
          {{ $t('admin.bonusRules.snap.tiers', { n: ageTiers.length }, ageTiers.length) }}
        </span>
      </header>

      <div class="curve-card">
        <TierCurve
          :tiers="ageCurveData"
          :x-label="$t('admin.bonusRules.fields.minAgeDays')"
          :x-unit="$t('admin.bonusRules.units.days')"
          accent="#fb923c"
          direction="asc"
          :empty-label="$t('admin.bonusRules.ageTiers.empty')"
        />
      </div>

      <header class="tier-list-head">
        <span class="tier-list-label">{{ $t('admin.bonusRules.ageTiers.editLabel') }}</span>
        <button
          type="button"
          class="cbtn cbtn--primary cbtn--sm"
          @click="addAgeTier"
        >
          <Icon name="ph:plus-bold" />
          {{ $t('admin.bonusRules.addTier') }}
        </button>
      </header>

      <ul v-if="ageTiers.length > 0" class="tier-list">
        <li
          v-for="(t, idx) in ageTiers"
          :key="t.id"
          class="tier"
          :class="{ 'tier--off': !t.enabled }"
          :style="{ '--stagger': `${idx * 40}ms` }"
        >
          <span class="tier-num tabular-nums">{{ String(idx + 1).padStart(2, '0') }}</span>
          <label class="tier-field">
            <span class="tier-field-label">{{ $t('admin.bonusRules.fields.minAgeDays') }}</span>
            <input
              type="number"
              min="0"
              step="1"
              class="field-input"
              :value="t.minAgeDays"
              @change="patchAgeTier(t, { minAgeDays: Number(($event.target as HTMLInputElement).value) })"
            />
            <span class="tier-field-unit">{{ $t('admin.bonusRules.units.daysOrMore') }}</span>
          </label>
          <span class="tier-arrow"><Icon name="ph:arrow-right-bold" /></span>
          <label class="tier-field">
            <span class="tier-field-label">
              {{ $t('admin.bonusRules.fields.multiplier') }}
              <span class="tier-field-note">{{ $t('admin.bonusRules.units.hundredths') }}</span>
            </span>
            <input
              type="number"
              min="0"
              step="1"
              class="field-input"
              :value="t.multiplier"
              @change="patchAgeTier(t, { multiplier: Number(($event.target as HTMLInputElement).value) })"
            />
            <span class="tier-field-unit tabular-nums">
              ×{{ formatMultiplier(t.multiplier) }}
            </span>
          </label>
          <span class="tier-actions">
            <label class="rule-toggle rule-toggle--sm">
              <input
                type="checkbox"
                :checked="t.enabled"
                @change="patchAgeTier(t, { enabled: !t.enabled })"
              />
              <span class="rule-toggle-track" :style="`--rule-color: #fb923c`" />
            </label>
            <button
              type="button"
              class="icon-btn icon-btn--danger"
              :title="$t('common.delete')"
              @click="deleteAgeTier(t)"
            >
              <Icon name="ph:trash-bold" />
            </button>
          </span>
        </li>
      </ul>
      <p v-else class="tier-empty">
        {{ $t('admin.bonusRules.ageTiers.empty') }}
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import TierCurve from '~/components/admin/bonus/TierCurve.vue';

const { t } = useI18n();
const notifications = useNotificationStore();
const confirm = useConfirm();

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

const enabledRulesCount = computed(() => rules.value.filter((r) => r.enabled).length);
const enabledSeedTiers = computed(() => seedCountTiers.value.filter((t) => t.enabled));
const enabledAgeTiers = computed(() => ageTiers.value.filter((t) => t.enabled));

/** Min/max multiplier across all enabled tiers, formatted as
 *  "0.5x – 4x". Surfaces the operator's range at a glance.
 *  Returns a dash when no tier is active. */
const multiplierRangeLabel = computed(() => {
  const all = [...enabledSeedTiers.value, ...enabledAgeTiers.value].map(
    (t) => t.multiplier / 100,
  );
  if (all.length === 0) return '—';
  const min = Math.min(...all);
  const max = Math.max(...all);
  if (min === max) return `×${formatMul(min)}`;
  return `×${formatMul(min)} → ×${formatMul(max)}`;
});

function formatMul(v: number): string {
  return v.toFixed(2).replace(/\.?0+$/, '') || '0';
}
function formatMultiplier(raw: number): string {
  return formatMul(raw / 100);
}

// Threshold above which we treat a seed-count tier as a "catch-all
// tail" — operators commonly set a row at maxSeeders ≈ 99,999,999
// to mean "swarms with this many seeders or fewer", i.e. all of
// them. Plotting that point on the curve squashes the meaningful
// breakpoints (10, 50, 200…) into the first pixel and makes the
// chart unreadable. We hide tail rows from the viz; they still
// appear in the editable list below.
const CURVE_THRESHOLD_CAP = 1_000_000;

// Data passed to the curve component: an ordered array of points
// each carrying a threshold value (x) + multiplier (y) + enabled
// flag. The curve component renders a step function.
const seedCurveData = computed(() =>
  [...seedCountTiers.value]
    .filter((t) => t.maxSeeders < CURVE_THRESHOLD_CAP)
    .map((t) => ({
      threshold: t.maxSeeders,
      multiplier: t.multiplier,
      enabled: t.enabled,
    }))
    .sort((a, b) => a.threshold - b.threshold),
);

// Count of "hidden tail" rows so the curve card can footnote it
// — keeps the operator informed that what they see isn't the
// full policy.
const seedCurveHiddenCount = computed(
  () => seedCountTiers.value.filter((t) => t.maxSeeders >= CURVE_THRESHOLD_CAP).length,
);
const ageCurveData = computed(() =>
  [...ageTiers.value]
    .map((t) => ({
      threshold: t.minAgeDays,
      multiplier: t.multiplier,
      enabled: t.enabled,
    }))
    .sort((a, b) => a.threshold - b.threshold),
);

// ── Kind cosmetics ─────────────────────────────────────────────
function kindIcon(kind: string): string {
  switch (kind) {
    case 'seeding': return 'ph:upload-simple-bold';
    case 'first_seeder': return 'ph:medal-bold';
    case 'seeding_milestone': return 'ph:flag-banner-bold';
    case 'daily_login': return 'ph:calendar-check-bold';
    case 'account_age_monthly': return 'ph:hourglass-medium-bold';
    default: return 'ph:gear-bold';
  }
}
function kindColor(kind: string): string {
  switch (kind) {
    case 'seeding': return '#34d4d8';
    case 'first_seeder': return '#d4a734';
    case 'seeding_milestone': return '#a78bfa';
    case 'daily_login': return '#6cd161';
    case 'account_age_monthly': return '#fb923c';
    default: return '#888';
  }
}

// ── Mutations (kept identical to the previous component) ──────
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
function toggleRule(rule: BonusRule) { patchRule(rule, { enabled: !rule.enabled }); }
function patchConfig(rule: BonusRule, partial: Record<string, unknown>) {
  patchRule(rule, { config: { ...rule.config, ...partial } });
}

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
  const next = [...getMilestones(rule), { hours: 24, reward: 25 }];
  patchRule(rule, { config: { ...rule.config, thresholds: next } });
}
function removeMilestone(rule: BonusRule, idx: number) {
  const next = getMilestones(rule).filter((_, i) => i !== idx);
  patchRule(rule, { config: { ...rule.config, thresholds: next } });
}

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
    await $fetch(`/api/admin/bonus-rules/tiers/seed-count/${tier.id}`, { method: 'PATCH', body });
    // Ces champs s'enregistrent à la volée, sans bouton : sans accusé de
    // réception, quitter le champ ne produisait rien de visible et
    // l'opérateur ne pouvait pas distinguer « enregistré » de « ignoré ».
    notifications.success(t('admin.bonusRules.toasts.tierUpdated'));
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('admin.bonusRules.errors.tierUpdateFailed'));
  }
}
async function deleteSeedTier(tier: SeedTier) {
  const ok = await confirm({
    title: t('admin.bonusRules.confirmTierDelete.title'),
    message: t('admin.bonusRules.confirmTierDelete.message'),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await $fetch(`/api/admin/bonus-rules/tiers/seed-count/${tier.id}`, { method: 'DELETE' });
    notifications.success(t('admin.bonusRules.toasts.tierDeleted'));
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('admin.bonusRules.errors.tierDeleteFailed'));
  }
}

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
    await $fetch(`/api/admin/bonus-rules/tiers/age/${tier.id}`, { method: 'PATCH', body });
    // Ces champs s'enregistrent à la volée, sans bouton : sans accusé de
    // réception, quitter le champ ne produisait rien de visible et
    // l'opérateur ne pouvait pas distinguer « enregistré » de « ignoré ».
    notifications.success(t('admin.bonusRules.toasts.tierUpdated'));
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('admin.bonusRules.errors.tierUpdateFailed'));
  }
}
async function deleteAgeTier(tier: AgeTier) {
  const ok = await confirm({
    title: t('admin.bonusRules.confirmTierDelete.title'),
    message: t('admin.bonusRules.confirmTierDelete.message'),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await $fetch(`/api/admin/bonus-rules/tiers/age/${tier.id}`, { method: 'DELETE' });
    notifications.success(t('admin.bonusRules.toasts.tierDeleted'));
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('admin.bonusRules.errors.tierDeleteFailed'));
  }
}
</script>

<style scoped>
/* ── Page shell ─────────────────────────────────────────────── */
.bre {
  display: flex;
  flex-direction: column;
  gap: 2.25rem;
  position: relative;
}
.bre::before {
  /* Hairline gold rail along the left edge — same thread as the
     /me bonus tile + /admin/notifications page, signalling "this
     is the bonus-economy surface". */
  content: '';
  position: absolute;
  left: -0.75rem;
  top: 0;
  bottom: 0;
  width: 1px;
  background: linear-gradient(
    to bottom,
    rgb(var(--accent-warm) / 0) 0%,
    rgb(var(--accent-warm) / 0.35) 12%,
    rgb(var(--accent-warm) / 0.35) 88%,
    rgb(var(--accent-warm) / 0) 100%
  );
  pointer-events: none;
}

/* ── Policy snapshot strip ──────────────────────────────────── */
.snapshot {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
  overflow: hidden;
  position: relative;
}
.snapshot::before {
  content: '';
  position: absolute;
  inset-inline: 1rem;
  top: 0;
  height: 1px;
  background: linear-gradient(
    to right,
    rgb(var(--accent-warm) / 0.55) 0%,
    rgb(var(--accent-warm) / 0.2) 60%,
    rgb(var(--accent-warm) / 0) 100%
  );
}
@media (max-width: 720px) {
  .snapshot {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.snap {
  position: relative;
  padding: 1.1rem 1.2rem 1.2rem;
  border-right: 1px solid rgb(var(--line-default));
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.snap:last-child {
  border-right: 0;
}
@media (max-width: 720px) {
  .snap {
    border-bottom: 1px solid rgb(var(--line-default));
  }
  .snap:nth-child(2n) { border-right: 0; }
  .snap:nth-last-child(-n + 2) { border-bottom: 0; }
}
.snap-num {
  font-family: var(--font-mono);
  font-size: clamp(1.5rem, 2.6vw, 1.9rem);
  font-weight: 800;
  letter-spacing: calc(-0.02em * var(--tracking-scale));
  line-height: 1;
}
.snap-num strong { color: rgb(var(--fg-strong)); font-weight: 800; }
.snap-frac { color: rgb(var(--fg-faint)); font-size: 0.6em; font-weight: 600; margin-left: 0.2em; }
.snap--rules .snap-num strong { color: rgb(var(--accent-warm)); }
.snap--seed .snap-num strong { color: #34d4d8; }
.snap--age .snap-num strong { color: #fb923c; }
.snap--range .snap-num { color: rgb(var(--fg-strong)); font-size: 1.3rem; }
.snap-label {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: calc(0.2em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.snap-icon {
  position: absolute;
  top: 1rem;
  right: 1rem;
  font-size: 1.1rem;
  color: rgb(var(--fg-faint));
}

/* ── Block scaffold (sections 01 / 02 / 03) ─────────────────── */
.block {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.block-head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.85rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid rgb(var(--line-default));
  position: relative;
}
.block-head::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -1px;
  width: 40px;
  height: 1px;
  background: rgb(var(--accent-warm));
}
.block-num {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: calc(0.2em * var(--tracking-scale));
  color: rgb(var(--accent-warm-text));
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--accent-warm) / 0.35);
  padding: 0.3rem 0.55rem;
  border-radius: var(--radius-sm);
}
.block-id h2 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: calc(0.04em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.block-id p {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
  line-height: 1.5;
}
.block-meta {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: calc(0.1em * var(--tracking-scale));
  color: rgb(var(--fg-muted));
  text-transform: uppercase;
}
.block-meta strong { color: rgb(var(--fg-strong)); font-weight: 700; font-variant-numeric: tabular-nums; }
@media (max-width: 640px) {
  .block-head { grid-template-columns: auto 1fr; }
  .block-meta { grid-column: 1 / -1; margin-top: 0.3rem; }
}

.empty {
  display: grid;
  place-items: center;
  padding: 3rem 1rem;
  color: rgb(var(--fg-muted));
  font-size: 1.5rem;
}

/* ── Rule grid ──────────────────────────────────────────────── */
.rule-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.85rem;
}
@media (min-width: 900px) {
  .rule-grid { grid-template-columns: 1fr 1fr; }
  /* The seeding-milestone card has a richer editor, give it the
     full row when it sits in a 2-col layout. */
  .rule-grid > .rule--seeding_milestone { grid-column: 1 / -1; }
}

.rule {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.1rem 1.1rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
  transition: border-color var(--dur-3) ease, opacity var(--dur-3) ease, background var(--dur-3) ease;
  animation: rule-in calc(0.4s * var(--motion-scale)) var(--ease-standard) backwards;
  animation-delay: var(--stagger, 0ms);
}
@keyframes rule-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.rule--off {
  opacity: 0.65;
  background: rgb(var(--bg-elevated) / 0.6);
}
.rule:hover { border-color: rgb(var(--line-strong)); }

.rule-head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.85rem;
}
.rule-glyph {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  font-size: 1.15rem;
  color: var(--rule-color);
  background: color-mix(in srgb, var(--rule-color) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--rule-color) 35%, transparent);
}
.rule-id { min-width: 0; }
.rule-name {
  margin: 0 0 0.15rem;
  font-size: 0.92rem;
  font-weight: 800;
  letter-spacing: calc(0.01em * var(--tracking-scale));
  color: rgb(var(--fg-strong));
}
.rule-desc {
  margin: 0;
  font-size: 0.74rem;
  color: rgb(var(--fg-muted));
  line-height: 1.45;
}
.rule-state {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.rule-state-text {
  font-family: var(--font-mono);
  font-size: 0.5938rem;
  font-weight: 700;
  letter-spacing: calc(0.18em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  transition: color var(--dur-3) ease;
}
.rule-state-text--on { color: rgb(var(--online)); }

/* Toggle — track + dot. Variable --rule-color drives the on-state
   colour so each rule reads in its own palette. */
.rule-toggle {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 22px;
}
.rule-toggle--sm {
  width: 32px;
  height: 18px;
}
.rule-toggle input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.rule-toggle-track {
  position: absolute;
  inset: 0;
  background: rgb(var(--line-default));
  border-radius: var(--radius-pill);
  transition: background var(--dur-3) ease;
}
.rule-toggle-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: rgb(var(--bg-elevated));
  border-radius: 50%;
  transition: transform var(--dur-3) ease;
  box-shadow: 0 1px 2px rgb(var(--shadow-color) / calc(0.4 * var(--shadow-strength)));
}
.rule-toggle--sm .rule-toggle-track::after {
  width: 14px;
  height: 14px;
}
.rule-toggle input:checked + .rule-toggle-track {
  background: var(--rule-color, rgb(var(--accent-warm)));
}
.rule-toggle input:checked + .rule-toggle-track::after {
  transform: translateX(16px);
  background: rgb(var(--bg-base));
}
.rule-toggle--sm input:checked + .rule-toggle-track::after {
  transform: translateX(14px);
}

.rule-body {
  padding-top: 0.85rem;
  border-top: 1px dashed rgb(var(--line-default) / 0.6);
}

/* ── Rule form (kind-specific editor) ───────────────────────── */
.rule-form { display: flex; flex-direction: column; gap: 0.6rem; }
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.field-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.field-unit {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: calc(0.1em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
  padding: 0.05rem 0.4rem;
  background: rgb(var(--bg-inset));
  border-radius: var(--radius-sm);
}
.field-hint {
  font-size: 0.7rem;
  color: rgb(var(--fg-muted));
  line-height: 1.45;
}
.field-input {
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  padding: 0.5rem 0.7rem;
  color: rgb(var(--fg-strong));
  font-size: 0.95rem;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  transition: border-color var(--dur-3) ease, box-shadow var(--dur-3) ease;
}
.field-input:focus {
  outline: none;
  border-color: rgb(var(--accent-warm) / 0.6);
  box-shadow: 0 0 0 3px rgb(var(--accent-warm) / 0.12);
}
/* L'anneau rendu au clavier. `outline: none` ci-dessus est pour la souris, où
   un changement de bordure suffit ; en `<style scoped>` la règle compile avec un
   attribut de données, donc elle battait le `:focus-visible` global de `main.css`
   quel que soit l'ordre — et ce champ n'avait plus aucun indicateur de focus.
   `main.css` corrige exactement ça pour `.input`, avec la même explication. */
.field-input:focus-visible {
  outline: 2px solid rgb(var(--focus-ring));
  outline-offset: 2px;
}

.field-input--sm {
  font-size: 0.85rem;
  padding: 0.35rem 0.55rem;
  max-width: 120px;
}

/* ── Milestones (seeding_milestone rule) ────────────────────── */
.rule-form--milestones { gap: 0.7rem; }
.milestones-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.milestones-label {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: calc(0.18em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.milestones {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.milestone {
  display: grid;
  grid-template-columns: auto auto 1fr auto auto auto;
  gap: 0.7rem;
  align-items: center;
  padding: 0.55rem 0.7rem;
  background: rgb(var(--bg-base) / 0.5);
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
}
.milestone-num {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: calc(0.1em * var(--tracking-scale));
  color: rgb(var(--fg-faint));
}
.milestone-field {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}
.milestone-field-label {
  font-family: var(--font-mono);
  font-size: 0.5938rem;
  letter-spacing: calc(0.12em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.milestone-arrow {
  font-size: 0.85rem;
  color: rgb(var(--fg-faint));
}
.milestones-empty {
  margin: 0;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
  font-style: italic;
}

/* ── Milestones — mobile ──────────────────────────────────── */
@media (max-width: 720px) {
  .milestone {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.4rem;
    padding: 0.65rem 0.85rem;
    position: relative;
  }
  .milestone-num {
    align-self: flex-start;
    width: auto;
  }
  .milestone-arrow { display: none; }
  .milestone-field {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.2rem;
  }
  .milestone-field-label {
    letter-spacing: calc(0.08em * var(--tracking-scale));
  }
  .milestone-field .field-input--sm {
    /* The desktop cap (120px) is too narrow on phones — let it
       breathe. */
    max-width: none;
    width: 100%;
  }
  /* Float the delete button into the upper-right corner so the
     two stacked field grids own the body of the row. */
  .milestone > .icon-btn {
    position: absolute;
    top: 0.55rem;
    right: 0.7rem;
  }
}

/* ── Curve card (TierCurve wrapper) ─────────────────────────── */
.curve-card {
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: linear-gradient(
    180deg,
    rgb(var(--bg-elevated)) 0%,
    rgb(var(--bg-inset)) 100%
  );
  padding: 1.1rem 1.25rem 0.85rem;
  overflow: hidden;
  position: relative;
}
.curve-card::before {
  content: '';
  position: absolute;
  inset-inline: 1rem;
  top: 0;
  height: 1px;
  background: linear-gradient(
    to right,
    rgb(var(--accent-warm) / 0.5) 0%,
    rgb(var(--accent-warm) / 0.1) 80%,
    rgb(var(--accent-warm) / 0) 100%
  );
}
.curve-footnote {
  margin: 0.55rem 0 0;
  padding-top: 0.55rem;
  border-top: 1px dashed rgb(var(--line-default) / 0.5);
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  color: rgb(var(--fg-muted));
  font-style: italic;
}
.curve-footnote > svg {
  color: rgb(var(--fg-faint));
  font-size: 0.85rem;
  flex-shrink: 0;
}

/* ── Tier list ──────────────────────────────────────────────── */
.tier-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.3rem;
}
.tier-list-label {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: calc(0.18em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.tier-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.tier {
  /* `minmax(0, 1fr)` instead of plain `1fr`: HTML inputs have an
     intrinsic min-width equal to their default `size` (~20ch in
     monospace) and that intrinsic size becomes the track's
     minimum. The result was the seeders-tier input growing past
     its column boundary, pushing the unit ("seeders ou moins")
     into the multiplier label. Pinning the min to 0 lets the
     input shrink to fit the available space.

     Same `minmax(0, 1fr)` applied inside `.tier-field` below so
     the input cell within each field can also collapse properly. */
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 1fr) auto;
  gap: 0.7rem;
  align-items: center;
  padding: 0.65rem 0.85rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  transition: border-color var(--dur-3) ease, opacity var(--dur-3) ease;
  animation: rule-in calc(0.4s * var(--motion-scale)) var(--ease-standard) backwards;
  animation-delay: var(--stagger, 0ms);
}
.tier:hover { border-color: rgb(var(--line-strong)); }
.tier--off { opacity: 0.55; }
.tier-num {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: calc(0.12em * var(--tracking-scale));
  color: rgb(var(--fg-faint));
  width: 24px;
  text-align: right;
}
.tier-field {
  /* Three-cell grid: label | input | unit. The input cell is
     `minmax(0, 1fr)` so it stretches to fill the column AND
     shrinks all the way to 0 when the surrounding tier track
     gets squeezed — keeps the unit text glued to the input
     rather than letting it overflow into the next column. */
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}
.tier-field > .field-input {
  /* Without `min-width: 0` the input would refuse to shrink past
     its intrinsic `size`, defeating the grid template above. */
  min-width: 0;
  width: 100%;
}
.tier-field-label {
  font-family: var(--font-mono);
  font-size: 0.5938rem;
  letter-spacing: calc(0.12em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  flex-shrink: 0;
}
.tier-field-unit {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: rgb(var(--fg-muted));
  white-space: nowrap;
}
.tier-arrow {
  font-size: 0.95rem;
  color: rgb(var(--fg-faint));
}
.tier-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex-shrink: 0;
}
.tier-empty {
  margin: 0;
  padding: 1.5rem 1rem;
  text-align: center;
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
  font-style: italic;
  background: rgb(var(--bg-elevated) / 0.5);
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-sm);
}

/* ── Tier rows — mobile ─────────────────────────────────────
 * Below 720 px the 5-column inline grid (num · field · arrow ·
 * field · actions) is way too dense: the mono-letterspaced
 * labels overflow into the inputs and the multiplier column
 * collides with the arrow. We rebuild the row as a flex column:
 *
 *    01                                  [toggle] [delete]
 *    Min age (days)
 *    [_input_____] days or more
 *    Multiplier
 *    [_input_____] ×1.20
 *
 * Each tier-field becomes its own grid (label spans full
 * width, input + unit share row 2) so the chunky uppercase
 * labels read on their own line and the inputs get the room
 * they need. */
@media (max-width: 720px) {
  .tier {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 0.75rem 0.85rem 0.85rem;
    position: relative;
  }
  .tier-num {
    width: auto;
    text-align: left;
  }
  .tier-arrow { display: none; }
  .tier-field {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    align-items: center;
    column-gap: 0.55rem;
    row-gap: 0.25rem;
    width: 100%;
  }
  .tier-field-label {
    grid-column: 1 / -1;
    grid-row: 1;
    /* Slightly tighter letterspacing for readability at the
       narrower column width. */
    letter-spacing: calc(0.08em * var(--tracking-scale));
  }
  .tier-field > .field-input {
    grid-column: 1;
    grid-row: 2;
    width: 100%;
    min-width: 0;
  }
  .tier-field-unit {
    grid-column: 2;
    grid-row: 2;
    justify-self: end;
  }
  /* Actions float to the top-right so they share row 1 with
     the tier number badge — saves a row of vertical space. */
  .tier-actions {
    position: absolute;
    top: 0.6rem;
    right: 0.8rem;
  }
}

/* ── Buttons ─────────────────────────────────────────────────── */
/*
 * Le bouton du dialecte console, renommé depuis `.btn`.
 *
 * Il portait le nom de la classe du système de design, dans un `<style
 * scoped>` — donc dans une couche sans couche, qui l'emporte sur
 * `@layer components` quelle que soit la spécificité. Tant que ce composant
 * n'utilise QUE le dialecte local, rien ne casse ; le jour où quelqu'un y
 * écrit `class="btn btn-primary"`, il obtient silencieusement ce bouton-ci et
 * cherche longtemps pourquoi. Quatre composants d'administration portaient la
 * même copie de cette définition.
 */
.cbtn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-strong));
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--dur-2) ease;
  font-family: inherit;
}
.cbtn:hover:not(:disabled) {
  border-color: rgb(var(--accent-warm) / 0.5);
  background: rgb(var(--accent-warm) / 0.05);
}
.cbtn:disabled { opacity: 0.5; cursor: not-allowed; }
.cbtn--ghost { background: transparent; }
.cbtn--primary {
  background: rgb(var(--accent-warm));
  border-color: rgb(var(--accent-warm));
  color: rgb(var(--accent-warm-fg));
}
.cbtn--primary:hover:not(:disabled) {
  background: color-mix(in srgb, rgb(var(--accent-warm)) 82%, white);
  border-color: color-mix(in srgb, rgb(var(--accent-warm)) 82%, white);
}
.cbtn--sm {
  padding: 0.32rem 0.6rem;
  font-size: 0.7rem;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: all var(--dur-2) ease;
}
.icon-btn:hover { color: rgb(var(--fg-strong)); background: rgb(var(--bg-hover) / 0.4); }
.icon-btn--danger:hover {
  color: rgb(var(--danger));
  background: rgba(239, 68, 68, 0.06);
  border-color: rgba(239, 68, 68, 0.35);
}
.tier-field-note {
  display: block;
  font-size: 0.6rem;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  color: rgb(var(--fg-subtle));
}
</style>

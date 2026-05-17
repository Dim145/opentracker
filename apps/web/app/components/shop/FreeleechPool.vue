<template>
  <!--
    /shop — Communal pool banner.

    Sits above the items grid and reads as a *shared pot* rather
    than a private acquisition. Same gold thread, same serif italic
    accents, but the frame is wider and carries a horizontal
    progress meter (the visual centre of the card) plus a top-5
    "patrons" cartouche under it. The contribute form is on the
    right so the eye lands: scope → progress → action.

    State variants:
      - `disabled`   the admin hasn't enabled the pool — render
                     nothing (the parent component handles the
                     v-if).
      - `closed`     the pool exists but no contribution window
                     covers `now` — the form is locked.
      - `filling`    accepting contributions; the bar grows as the
                     pot fills.
      - `full_queued` 100% but the cron is waiting on another
                     freeleech to end before it can spawn ours.
      - `active`     pool freeleech is running — the bar is
                     replaced by a countdown and a closing seal.
  -->
  <section
    v-if="state && state.enabled"
    class="pool"
    :class="`pool--${cycleStatus}`"
  >
    <span class="pool-corner pool-corner--tl" aria-hidden="true" />
    <span class="pool-corner pool-corner--tr" aria-hidden="true" />
    <span class="pool-corner pool-corner--bl" aria-hidden="true" />
    <span class="pool-corner pool-corner--br" aria-hidden="true" />

    <header class="pool-head">
      <div class="pool-eyebrow">
        <span class="pool-eyebrow-rule" aria-hidden="true" />
        {{ $t('freeleechPool.eyebrow') }}
      </div>
      <h2 class="pool-title">
        <span class="pool-title-main">{{ $t('freeleechPool.titleMain') }}</span>
        <span class="pool-title-accent">{{ $t('freeleechPool.titleAccent') }}</span>
      </h2>
      <p class="pool-blurb">
        {{
          $t('freeleechPool.blurb', {
            days: cycleDurationDays,
          })
        }}
      </p>
    </header>

    <!-- ── Progress + contribute ─────────────────────────── -->
    <div class="pool-body">
      <!-- Progress meter — fills as contributions roll in. When
           queued / active, the bar locks at 100% and a copy
           overlay explains why no more contributions are
           accepted. Before the first contribution lands the cycle
           row is `null`; we fall back to the config target so the
           bar reads `0 / target`. -->
      <div class="pool-meter">
        <div class="pool-meter-frame">
          <div
            class="pool-meter-fill"
            :style="{ width: `${progressPct}%` }"
          />
          <div class="pool-meter-grain" aria-hidden="true" />
        </div>
        <div class="pool-meter-labels">
          <span class="pool-meter-current tabular-nums">
            {{ formatNumber(cycleCurrent) }}
          </span>
          <span class="pool-meter-sep">/</span>
          <span class="pool-meter-target tabular-nums">
            {{ formatNumber(cycleTarget) }}
          </span>
          <span class="pool-meter-unit">{{ $t('freeleechPool.points') }}</span>
        </div>

        <!-- Status copy under the meter -->
        <p class="pool-status">
          <Icon :name="statusIcon" class="pool-status-icon" />
          <span>{{ statusCopy }}</span>
        </p>

        <!-- Top contributors -->
        <div v-if="state.topContributors.length > 0" class="pool-patrons">
          <span class="pool-patrons-label">
            {{ $t('freeleechPool.topPatrons') }}
          </span>
          <ol class="pool-patrons-list">
            <li
              v-for="(p, idx) in state.topContributors"
              :key="p.userId"
              class="pool-patron"
            >
              <span class="pool-patron-rank tabular-nums">
                {{ String(idx + 1).padStart(2, '0') }}
              </span>
              <span class="pool-patron-name">{{ p.username }}</span>
              <span class="pool-patron-amount tabular-nums">
                {{ formatNumber(p.total) }}
              </span>
            </li>
          </ol>
        </div>
      </div>

      <!-- Contribute side — locked when not in `filling` or when
           the window is closed. -->
      <aside class="pool-form">
        <div v-if="canContribute" class="pool-form-inner">
          <label class="pool-form-label" for="pool-amount">
            {{ $t('freeleechPool.contributeLabel') }}
          </label>
          <div class="pool-form-input-wrap">
            <input
              id="pool-amount"
              v-model.number="amount"
              type="number"
              :min="state.config.contributionMin"
              :max="maxAcceptable"
              :placeholder="String(state.config.contributionMin)"
              class="pool-form-input"
            >
            <span class="pool-form-input-unit">{{ $t('freeleechPool.points') }}</span>
          </div>

          <div v-if="presetAmounts.length > 0" class="pool-form-presets">
            <button
              v-for="(p, i) in presetAmounts"
              :key="i"
              type="button"
              class="pool-form-preset"
              :disabled="busy || p > maxAcceptable"
              @click="amount = p"
            >
              {{ formatNumber(p) }}
            </button>
          </div>

          <p
            v-if="state.userContribution !== null && state.userContribution > 0"
            class="pool-form-user"
          >
            {{
              $t('freeleechPool.youGave', {
                amount: formatNumber(state.userContribution),
              })
            }}
          </p>

          <p v-if="error" class="pool-form-error">{{ error }}</p>

          <button
            type="button"
            class="pool-form-cta"
            :disabled="!validAmount || busy"
            @click="submit"
          >
            <Icon
              :name="busy ? 'ph:circle-notch' : 'ph:hand-coins-bold'"
              :class="busy ? 'spin' : ''"
            />
            <span>{{ busy ? $t('freeleechPool.submitting') : $t('freeleechPool.cta') }}</span>
          </button>
        </div>

        <div v-else class="pool-form-locked">
          <Icon :name="lockedIcon" class="pool-form-locked-icon" />
          <p class="pool-form-locked-copy">{{ lockedCopy }}</p>
        </div>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
const { t } = useI18n();
const notifications = useNotificationStore();
const { fetch: refreshSession } = useUserSession();

interface PoolPatron {
  userId: string;
  username: string;
  total: number;
}
interface PoolCycle {
  id: string;
  status: 'filling' | 'full_queued' | 'active' | 'ended' | 'cancelled';
  targetSnapshot: number;
  durationDaysSnapshot: number;
  totalContributed: number;
  startedAt: string | null;
  endsAt: string | null;
  triggeredEventId: string | null;
  waitingOnEventId: string | null;
}
interface PoolState {
  enabled: boolean;
  isOpen: boolean;
  config: {
    pointsTarget: number;
    freeleechDurationDays: number;
    contributionMin: number;
    maxPerUserBp: number;
    presetAmounts: number[];
  };
  cycle: PoolCycle | null;
  topContributors: PoolPatron[];
  userContribution: number | null;
}

const emit = defineEmits<{
  (e: 'balanceChanged', value: number): void;
}>();

const { data, refresh } = await useFetch<PoolState>(
  '/api/freeleech-pool/state',
  { default: () => null }
);
const state = computed(() => data.value);

const amount = ref<number | null>(null);
const busy = ref(false);
const error = ref('');

// Effective state values — fall back to the config when no cycle
// is open yet (the cycle row is created at the first contribution,
// not when the admin enables the pool). The widget reads from these
// so the "before first contribution" view renders `0 / target`
// instead of disappearing.
const cycleStatus = computed<string>(() => state.value?.cycle?.status ?? 'filling');
const cycleCurrent = computed(() => state.value?.cycle?.totalContributed ?? 0);
const cycleTarget = computed(
  () =>
    state.value?.cycle?.targetSnapshot ??
    state.value?.config.pointsTarget ??
    0
);
const cycleDurationDays = computed(
  () =>
    state.value?.cycle?.durationDaysSnapshot ??
    state.value?.config.freeleechDurationDays ??
    0
);
const cycleEndsAt = computed<string | null>(
  () => state.value?.cycle?.endsAt ?? null
);

const progressPct = computed(() => {
  const t = cycleTarget.value;
  if (t <= 0) return 0;
  const pct = (cycleCurrent.value / t) * 100;
  return Math.min(100, Math.max(0, pct));
});

const presetAmounts = computed(() => {
  return state.value?.config.presetAmounts ?? [];
});

// Per-user cap mirror — the API enforces the same rule, but
// reflecting it in the UI prevents the user from typing a number
// they can never submit.
const userCap = computed(() => {
  if (!state.value?.config.maxPerUserBp) return Infinity;
  return Math.floor(
    (cycleTarget.value * state.value.config.maxPerUserBp) / 10_000
  );
});
const userRoom = computed(() => {
  if (!Number.isFinite(userCap.value)) return Infinity;
  return Math.max(0, userCap.value - (state.value?.userContribution ?? 0));
});
const poolRoom = computed(() =>
  Math.max(0, cycleTarget.value - cycleCurrent.value)
);
const maxAcceptable = computed(() =>
  Math.max(0, Math.min(userRoom.value, poolRoom.value))
);

const canContribute = computed(() => {
  if (!state.value) return false;
  // No cycle yet → status defaults to 'filling' (we treat the
  // pre-first-contribution state as accepting). The contribute
  // call will create the cycle server-side.
  if (cycleStatus.value !== 'filling') return false;
  if (!state.value.isOpen) return false;
  return maxAcceptable.value > 0;
});

const validAmount = computed(() => {
  if (!state.value) return false;
  if (amount.value === null || amount.value === undefined) return false;
  if (!Number.isInteger(amount.value)) return false;
  if (amount.value < state.value.config.contributionMin) return false;
  if (amount.value > maxAcceptable.value) return false;
  return true;
});

const statusIcon = computed(() => {
  switch (cycleStatus.value) {
    case 'filling':
      return state.value?.isOpen ? 'ph:fire-fill' : 'ph:lock-key-bold';
    case 'full_queued':
      return 'ph:hourglass-medium-fill';
    case 'active':
      return 'ph:gift-fill';
    case 'ended':
      return 'ph:check-circle-fill';
    case 'cancelled':
      return 'ph:x-circle-fill';
    default:
      return 'ph:hourglass';
  }
});

const statusCopy = computed(() => {
  switch (cycleStatus.value) {
    case 'filling':
      return state.value?.isOpen
        ? t('freeleechPool.status.filling')
        : t('freeleechPool.status.closed');
    case 'full_queued':
      return t('freeleechPool.status.queued');
    case 'active':
      return cycleEndsAt.value
        ? t('freeleechPool.status.active', {
            countdown: countdownLabel(cycleEndsAt.value),
          })
        : t('freeleechPool.status.activeNoEnd');
    case 'ended':
      return t('freeleechPool.status.ended');
    case 'cancelled':
      return t('freeleechPool.status.cancelled');
    default:
      return '';
  }
});

const lockedIcon = computed(() => {
  if (cycleStatus.value === 'full_queued') return 'ph:hourglass-medium-fill';
  if (cycleStatus.value === 'active') return 'ph:gift-fill';
  if (cycleStatus.value === 'ended') return 'ph:check-circle-fill';
  if (cycleStatus.value === 'cancelled') return 'ph:x-circle-fill';
  return 'ph:lock-key-bold';
});

const lockedCopy = computed(() => {
  const s = cycleStatus.value;
  if (s === 'filling' && !state.value?.isOpen) {
    return t('freeleechPool.lockedClosed');
  }
  if (s === 'full_queued') return t('freeleechPool.lockedQueued');
  if (s === 'active') return t('freeleechPool.lockedActive');
  if (s === 'ended') return t('freeleechPool.lockedEnded');
  if (s === 'cancelled') return t('freeleechPool.lockedCancelled');
  if (userRoom.value <= 0) return t('freeleechPool.lockedUserCap');
  return '';
});

function formatNumber(n: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(n)));
}

function countdownLabel(endsAt: string): string {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return t('freeleechPool.countdown.ended');
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3_600);
  const minutes = Math.floor((totalSec % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

async function submit() {
  if (!validAmount.value || amount.value === null) return;
  busy.value = true;
  error.value = '';
  try {
    const res = await $fetch<{
      success: boolean;
      amountAccepted: number;
      bonusPoints: number;
      triggered: boolean;
    }>('/api/freeleech-pool/contribute', {
      method: 'POST',
      body: { amount: amount.value },
    });
    emit('balanceChanged', res.bonusPoints);
    notifications.success(
      res.triggered
        ? t('freeleechPool.toasts.triggered')
        : t('freeleechPool.toasts.contributed', {
            amount: formatNumber(res.amountAccepted),
          })
    );
    amount.value = null;
    await Promise.all([refreshSession(), refresh()]);
  } catch (err: any) {
    error.value = err?.data?.message || t('freeleechPool.errors.contribute');
  } finally {
    busy.value = false;
  }
}

// Re-render the active-state countdown every minute so the copy
// under the meter stays approximately fresh.
let countdownTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  countdownTimer = setInterval(() => {
    // Touch a ref-dependent computed so Vue re-evaluates the
    // countdown. Re-fetching state every minute also catches
    // the cron-side transitions without a busy poll.
    refresh();
  }, 60_000);
});
onBeforeUnmount(() => {
  if (countdownTimer) clearInterval(countdownTimer);
});
</script>

<style scoped>
.pool {
  position: relative;
  margin: 0 0 2.5rem;
  padding: 1.75rem 1.75rem 1.75rem;
  background: linear-gradient(
    160deg,
    rgba(212, 167, 52, 0.07) 0%,
    rgb(var(--bg-elevated)) 50%,
    rgb(var(--bg-surface) / 0.4) 100%
  );
  border: 1px solid rgba(212, 167, 52, 0.32);
}

/* Corner brackets — match the rest of the shop's iconography. */
.pool-corner {
  position: absolute;
  width: 18px;
  height: 18px;
  border: 1px solid #d4a734;
  pointer-events: none;
}
.pool-corner--tl { top: -1px; left: -1px; border-right: 0; border-bottom: 0; }
.pool-corner--tr { top: -1px; right: -1px; border-left: 0; border-bottom: 0; }
.pool-corner--bl { bottom: -1px; left: -1px; border-right: 0; border-top: 0; }
.pool-corner--br { bottom: -1px; right: -1px; border-left: 0; border-top: 0; }

/* Header — eyebrow, title, blurb. */
.pool-head {
  margin-bottom: 1.4rem;
}
.pool-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: #d4a734;
  margin-bottom: 0.7rem;
}
.pool-eyebrow-rule {
  display: inline-block;
  width: 22px;
  height: 1px;
  background: #d4a734;
}
.pool-title {
  margin: 0;
  font-family: 'Iowan Old Style', 'Palatino Linotype', 'Palatino',
    'Bitstream Vera Serif', 'Liberation Serif', 'P052', Georgia,
    'Times New Roman', serif;
  line-height: 1;
  letter-spacing: -0.02em;
}
.pool-title-main {
  display: inline;
  font-size: clamp(1.6rem, 3vw, 2.1rem);
  font-weight: 800;
  color: rgb(var(--fg-strong));
}
.pool-title-accent {
  display: inline;
  font-size: clamp(1.6rem, 3vw, 2.1rem);
  font-style: italic;
  font-weight: 400;
  color: #d4a734;
  margin-left: 0.3rem;
}
.pool-blurb {
  margin: 0.8rem 0 0;
  font-size: 0.85rem;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
  max-width: 64ch;
}

/* Body — two columns: meter on the left, form on the right. */
.pool-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 280px);
  gap: 1.75rem;
}
@media (max-width: 720px) {
  .pool-body {
    grid-template-columns: 1fr;
  }
}

/* Meter frame — gold filling on a darker rail. */
.pool-meter {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.pool-meter-frame {
  position: relative;
  height: 18px;
  background: rgb(var(--bg-base));
  border: 1px solid rgba(212, 167, 52, 0.25);
  overflow: hidden;
}
.pool-meter-fill {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    #b88a22 0%,
    #d4a734 50%,
    #e8b94e 100%
  );
  box-shadow: 0 0 12px rgba(212, 167, 52, 0.5);
  transition: width 0.6s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.pool-meter-grain {
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    90deg,
    transparent 0,
    transparent 8px,
    rgba(0, 0, 0, 0.1) 8px,
    rgba(0, 0, 0, 0.1) 9px
  );
  pointer-events: none;
}
.pool-meter-labels {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
}
.pool-meter-current {
  font-size: 1.7rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  letter-spacing: -0.01em;
}
.pool-meter-sep {
  font-size: 1.4rem;
  color: rgba(212, 167, 52, 0.5);
}
.pool-meter-target {
  font-size: 1.4rem;
  color: rgb(var(--fg-muted));
}
.pool-meter-unit {
  margin-left: 0.5rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}

/* Status copy under the meter. */
.pool-status {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.pool-status-icon {
  font-size: 1rem;
  color: #d4a734;
}
.pool--active .pool-status-icon,
.pool--full_queued .pool-status-icon {
  animation: pool-status-pulse 2.2s ease-in-out infinite;
}
@keyframes pool-status-pulse {
  0%, 100% { filter: drop-shadow(0 0 0 rgba(212, 167, 52, 0)); transform: scale(1); }
  50% { filter: drop-shadow(0 0 6px rgba(212, 167, 52, 0.55)); transform: scale(1.08); }
}

/* Patrons leaderboard — small horizontal list of contributors. */
.pool-patrons {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding-top: 0.6rem;
  border-top: 1px dashed rgba(212, 167, 52, 0.2);
}
.pool-patrons-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.pool-patrons-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.3rem 0.8rem;
}
.pool-patron {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.55rem;
  align-items: baseline;
  font-size: 0.82rem;
  color: rgb(var(--fg-default));
}
.pool-patron-rank {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: #d4a734;
}
.pool-patron-name {
  font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
  font-style: italic;
  font-weight: 500;
  color: rgb(var(--fg-strong));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pool-patron-amount {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  color: rgb(var(--fg-muted));
}

/* Form side — input + presets + CTA. Locked state replaces the
   form with a centered icon + explanatory copy. */
.pool-form {
  position: relative;
  padding-left: 1.5rem;
  border-left: 1px solid rgba(212, 167, 52, 0.18);
}
@media (max-width: 720px) {
  .pool-form {
    padding-left: 0;
    padding-top: 1.5rem;
    border-left: 0;
    border-top: 1px solid rgba(212, 167, 52, 0.18);
  }
}

.pool-form-inner {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.pool-form-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.pool-form-input-wrap {
  display: flex;
  align-items: stretch;
}
.pool-form-input {
  flex: 1;
  min-width: 0;
  padding: 0.7rem 0.85rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgba(212, 167, 52, 0.3);
  font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
  font-size: 1.4rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  letter-spacing: -0.01em;
  outline: 0;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.pool-form-input:focus {
  border-color: #d4a734;
  box-shadow: 0 0 0 1px rgba(212, 167, 52, 0.35),
    0 0 12px rgba(212, 167, 52, 0.18) inset;
}
.pool-form-input-unit {
  display: inline-flex;
  align-items: center;
  padding: 0 0.8rem;
  border: 1px solid rgba(212, 167, 52, 0.3);
  border-left: 0;
  background: rgba(212, 167, 52, 0.06);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #d4a734;
}

.pool-form-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.pool-form-preset {
  padding: 0.35rem 0.7rem;
  border: 1px solid rgba(212, 167, 52, 0.3);
  background: transparent;
  color: rgb(var(--fg-default));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease,
    color 0.18s ease;
}
.pool-form-preset:hover:not(:disabled) {
  border-color: #d4a734;
  background: rgba(212, 167, 52, 0.08);
  color: #d4a734;
}
.pool-form-preset:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.pool-form-user {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.4;
  color: rgb(var(--fg-muted));
  font-style: italic;
}
.pool-form-error {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.4;
  color: rgb(239, 68, 68);
}

.pool-form-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  padding: 0.7rem 1rem;
  background: linear-gradient(
    180deg,
    #e8b94e 0%,
    #d4a734 50%,
    #b88a22 100%
  );
  color: #1a1a1a;
  border: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: transform 0.18s ease, box-shadow 0.22s ease,
    opacity 0.18s ease;
  box-shadow: 0 4px 12px -4px rgba(212, 167, 52, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}
.pool-form-cta:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px -4px rgba(212, 167, 52, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}
.pool-form-cta:active:not(:disabled) {
  transform: translateY(1px);
}
.pool-form-cta:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.pool-form-locked {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  gap: 0.75rem;
  text-align: center;
  padding: 1rem 0.5rem;
}
.pool-form-locked-icon {
  font-size: 2.4rem;
  color: rgba(212, 167, 52, 0.55);
}
.pool--active .pool-form-locked-icon,
.pool--full_queued .pool-form-locked-icon {
  color: #d4a734;
  animation: pool-locked-pulse 3s ease-in-out infinite;
}
@keyframes pool-locked-pulse {
  0%, 100% { transform: scale(1); filter: drop-shadow(0 0 4px rgba(212, 167, 52, 0.25)); }
  50% { transform: scale(1.05); filter: drop-shadow(0 0 12px rgba(212, 167, 52, 0.5)); }
}
.pool-form-locked-copy {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.5;
  color: rgb(var(--fg-muted));
  max-width: 26ch;
  font-style: italic;
  font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
}

.spin {
  animation: pool-spin 1s linear infinite;
}
@keyframes pool-spin {
  to { transform: rotate(360deg); }
}
</style>

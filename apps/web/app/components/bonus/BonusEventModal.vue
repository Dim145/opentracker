<template>
  <!--
    Bonus event modal — user-facing broadcast bulletin.

    Shown to a logged-in member the first time they see an active
    bonus event during their session. The layout mirrors the admin
    "signal tower" idiom so the moderator and the user share a
    visual vocabulary: a pulsing ON AIR header, a live countdown,
    a pair of directional multiplier readouts, and a window
    timeline with a moving position marker.

    The modal is intentionally celebratory — a member should walk
    away knowing two things at a glance: that something special is
    happening RIGHT NOW, and how it affects them.
  -->
  <Modal
    :model-value="modelValue"
    size="md"
    hide-close
    bodyClass="!p-0"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <template #header>
      <div class="bb-head-id">
        <span class="bb-onair">
          <span class="bb-onair-dot" aria-hidden="true" />
          <span class="bb-onair-rings" aria-hidden="true" />
        </span>
        <span class="bb-onair-stamp">{{ $t('bonus.modal.onAir') }}</span>
        <span class="bb-onair-now tabular-nums">{{ wallClock }}</span>
      </div>
    </template>

    <div class="bb">
      <!-- ── Title strip ────────────────────────────────────── -->
      <header class="bb-title-strip" :class="`bb-title-strip--${presetSlug}`">
        <div class="bb-tag-row">
          <span class="bb-preset-tag">
            <Icon :name="presetIcon" class="bb-preset-tag-icon" />
            {{ presetLabel }}
          </span>
          <!-- Pool source badge — surfaces the community origin
               whenever the event came from the freeleech pool. -->
          <span v-if="isPool" class="bb-source-tag">
            <Icon name="ph:hand-coins-fill" class="bb-preset-tag-icon" />
            {{ $t('bonus.modal.fromPool') }}
          </span>
        </div>
        <h2 class="bb-title">{{ event.title }}</h2>
        <p class="bb-countdown tabular-nums">
          <Icon name="ph:hourglass-medium-fill" class="bb-countdown-icon" />
          {{ $t('bonus.modal.endsInLong', { time: countdown }) }}
        </p>
        <p v-if="effectiveDescription" class="bb-desc">
          {{ effectiveDescription }}
        </p>
        <!-- Overlay hint — only shown when the pool's freeleech
             displaced a non-freeleech event. The original's upload
             multiplier (≠ 1.00x) is the giveaway. -->
        <p v-if="isPool && isOverlay" class="bb-overlay-hint">
          <Icon name="ph:stack-overflow-logo-bold" class="bb-overlay-icon" />
          <span>{{ $t('bonus.modal.poolOverlayHint') }}</span>
        </p>
      </header>

      <!-- ── Multiplier readouts ───────────────────────────── -->
      <section class="bb-meters">
        <article class="meter" :class="`meter--${verdictTone('download')}`">
          <header class="meter-head">
            <span class="meter-tag">DL</span>
            <span class="meter-label">{{ $t('bonus.modal.download') }}</span>
            <Icon :name="verdictIcon('download')" class="meter-verdict-icon" />
          </header>
          <p class="meter-value tabular-nums">
            <!-- Overlay case: render the original DL multiplier
                 struck through next to the new (zero) value so the
                 user sees the pool freeleech literally cancelled
                 the surcharge they were paying. -->
            <span
              v-if="overlayDownloadFrom !== null"
              class="meter-value-strike tabular-nums"
            >×{{ formatBonusMultiplier(overlayDownloadFrom) }}</span>
            <span>{{ downloadDisplay }}</span>
          </p>
          <p class="meter-verdict">
            <template v-if="overlayDownloadFrom !== null">
              {{ $t('bonus.modal.verdict.poolFreeleech') }}
            </template>
            <template v-else>{{ verdict('download') }}</template>
          </p>
          <!-- Visual gauge — left of center = lower than 1× (good
               for DL), right = higher (bad). Capped at 200% so the
               extremes don't slide off. -->
          <div class="meter-bar" aria-hidden="true">
            <span
              class="meter-bar-fill"
              :style="{
                left: gaugeStartPct('download') + '%',
                width: gaugeWidthPct('download') + '%',
              }"
            />
            <span class="meter-bar-pivot" aria-hidden="true" />
            <span class="meter-bar-ticks" aria-hidden="true" />
          </div>
        </article>

        <article class="meter" :class="`meter--${verdictTone('upload')}`">
          <header class="meter-head">
            <span class="meter-tag">UL</span>
            <span class="meter-label">{{ $t('bonus.modal.upload') }}</span>
            <Icon :name="verdictIcon('upload')" class="meter-verdict-icon" />
          </header>
          <p class="meter-value tabular-nums">{{ uploadDisplay }}</p>
          <p class="meter-verdict">{{ verdict('upload') }}</p>
          <div class="meter-bar" aria-hidden="true">
            <span
              class="meter-bar-fill"
              :style="{
                left: gaugeStartPct('upload') + '%',
                width: gaugeWidthPct('upload') + '%',
              }"
            />
            <span class="meter-bar-pivot" aria-hidden="true" />
            <span class="meter-bar-ticks" aria-hidden="true" />
          </div>
        </article>
      </section>

      <!-- ── Window timeline ───────────────────────────────── -->
      <section class="bb-window">
        <div class="bb-window-head">
          <Icon name="ph:clock-bold" class="bb-window-icon" />
          <span class="bb-window-label">{{ $t('bonus.modal.eventWindow') }}</span>
        </div>
        <div class="bb-window-row">
          <div class="bb-window-leg">
            <span class="bb-window-leg-label">{{ $t('bonus.modal.starts') }}</span>
            <span class="bb-window-leg-time tabular-nums">{{ formatDateTime(event.startsAt) }}</span>
          </div>
          <div class="bb-window-leg bb-window-leg--right">
            <span class="bb-window-leg-label">{{ $t('bonus.modal.ends') }}</span>
            <span class="bb-window-leg-time tabular-nums">{{ formatDateTime(event.endsAt) }}</span>
          </div>
        </div>
        <div class="bb-window-track" :aria-label="$t('bonus.modal.progressAria')">
          <div
            class="bb-window-track-fill"
            :style="{ width: windowProgress * 100 + '%' }"
          />
          <span
            class="bb-window-marker"
            :style="{ left: windowProgress * 100 + '%' }"
            aria-hidden="true"
          />
          <span class="bb-window-track-grid" aria-hidden="true" />
        </div>
        <div class="bb-window-foot">
          <span class="bb-window-foot-leg">{{ $t('bonus.modal.startedAgo', { rel: relativeStarted }) }}</span>
          <span class="bb-window-foot-leg bb-window-foot-leg--right tabular-nums">
            {{ $t('bonus.modal.remaining', { time: countdown }) }}
          </span>
        </div>
      </section>

      <!-- ── Explainer ─────────────────────────────────────── -->
      <section class="bb-explainer">
        <header class="bb-explainer-head">
          <Icon name="ph:info-bold" class="bb-explainer-icon" />
          <span class="bb-explainer-label">{{ $t('bonus.modal.whatThisMeans') }}</span>
        </header>
        <p class="bb-explainer-body">{{ explainer }}</p>
      </section>

      <!-- ── Action ────────────────────────────────────────── -->
      <footer class="bb-foot">
        <button
          type="button"
          class="bb-cta"
          @click="$emit('update:modelValue', false)"
        >
          <Icon name="ph:check-bold" />
          <span>{{ $t('bonus.modal.gotIt') }}</span>
        </button>
      </footer>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import Modal from '~/components/Modal.vue';
import {
  bonusCountdown,
  bonusPresetLabel,
  formatBonusMultiplier,
  type ActiveBonusEvent,
} from '~/composables/useActiveBonusEvent';

const props = defineProps<{
  modelValue: boolean;
  event: ActiveBonusEvent;
}>();

defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
}>();

const { t, locale } = useI18n();

// ── Live clock — only runs while the modal is open so we don't
// burn CPU on a dismissed bulletin. The reactive `now` drives the
// countdown, the wall clock, and the timeline marker.
const now = ref(Date.now());
let tickInterval: ReturnType<typeof setInterval> | null = null;

function startTicker() {
  if (tickInterval || typeof window === 'undefined') return;
  tickInterval = setInterval(() => {
    now.value = Date.now();
  }, 1000);
}
function stopTicker() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      now.value = Date.now();
      startTicker();
    } else {
      stopTicker();
    }
  },
  { immediate: true }
);
onBeforeUnmount(stopTicker);

const wallClock = computed(() => {
  const d = new Date(now.value);
  return d.toLocaleTimeString(locale.value === 'fr' ? 'fr-FR' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
});

// ── Source / preset / icon / colour ────────────────────────
const isPool = computed(() => props.event.source === 'freeleech_pool');
// "Overlay" = pool freeleech that displaced a non-freeleech bonus
// event. The original event's upload multiplier was preserved, so a
// pool-sourced event with upload != 100 is the giveaway. Used for
// the title-strip hint copy and the upload meter's "kept" tone.
const isOverlay = computed(
  () => isPool.value && props.event.uploadMultiplier !== 100
);

const preset = computed(() =>
  bonusPresetLabel(
    props.event.downloadMultiplier,
    props.event.uploadMultiplier
  )
);
const presetSlug = computed(() => {
  if (isPool.value) return 'pool';
  switch (preset.value) {
    case 'Freeleech':
      return 'freeleech';
    case 'Silverleech':
      return 'silverleech';
    default:
      return 'bonus';
  }
});
const presetLabel = computed(() => {
  if (isPool.value) return t('bonus.modal.preset.poolFreeleech');
  switch (preset.value) {
    case 'Freeleech':
      return t('bonus.modal.preset.freeleech');
    case 'Silverleech':
      return t('bonus.modal.preset.silverleech');
    default:
      return t('bonus.modal.preset.bonus');
  }
});
const presetIcon = computed(() => {
  if (isPool.value) return 'ph:hand-coins-fill';
  switch (preset.value) {
    case 'Freeleech':
      return 'ph:gift-fill';
    case 'Silverleech':
      return 'ph:medal-fill';
    default:
      return 'ph:lightning-fill';
  }
});

// ── Localized fallbacks for pool-default copy ─────────────
// The pool service stores `description` / `longDescription` as
// NULL when the admin didn't customize the per-event templates,
// precisely so the modal can render the locale's default here
// instead of locking the surface to one language. Admin-supplied
// strings (any non-null value) are rendered verbatim — they're
// already in the admin's chosen language.
const effectiveDescription = computed<string | null>(() => {
  if (props.event.description) return props.event.description;
  if (!isPool.value) return null;
  return isOverlay.value
    ? t('bonus.modal.poolDefaults.descriptionOverlay')
    : t('bonus.modal.poolDefaults.description');
});

// ── Overlay (pool-displaced original event) ───────────────
// `pausedFrom` is non-null only when the pool freeleech displaced
// a non-freeleech event. We compare DL multipliers because the
// pool *always* sets DL to 0 — so any pre-displacement value > 0
// is worth surfacing in the meter. The upload meter doesn't need
// the strikethrough because the upload multiplier of the original
// event is preserved verbatim by the pool.
const overlayDownloadFrom = computed<number | null>(() => {
  if (!props.event.pausedFrom) return null;
  if (props.event.pausedFrom.downloadMultiplier === props.event.downloadMultiplier) {
    return null;
  }
  return props.event.pausedFrom.downloadMultiplier;
});

// ── Countdown + window progress ────────────────────────────
const countdown = computed(() =>
  bonusCountdown(props.event.endsAt, new Date(now.value))
);

const windowProgress = computed(() => {
  const start = new Date(props.event.startsAt).getTime();
  const end = new Date(props.event.endsAt).getTime();
  if (end <= start) return 1;
  const r = (now.value - start) / (end - start);
  if (r < 0) return 0;
  if (r > 1) return 1;
  return r;
});

const relativeStarted = computed(() => {
  const start = new Date(props.event.startsAt).getTime();
  const diff = Math.max(0, now.value - start);
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return t('bonus.modal.rel.seconds', { n: secs });
  const mins = Math.floor(secs / 60);
  if (mins < 60) return t('bonus.modal.rel.minutes', { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('bonus.modal.rel.hours', { n: hrs });
  return t('bonus.modal.rel.days', { n: Math.floor(hrs / 24) });
});

// ── Multiplier display + verdict ───────────────────────────
function display(bp: number): string {
  return bp < 100 ? `${bp}%` : `×${formatBonusMultiplier(bp)}`;
}
const downloadDisplay = computed(() => display(props.event.downloadMultiplier));
const uploadDisplay = computed(() => display(props.event.uploadMultiplier));

// "Tone" — drives the card colour. For DL, lower than 100% is
// user-friendly (good); for UL, higher than 100% is user-friendly.
function verdictTone(side: 'download' | 'upload'): 'good' | 'neutral' | 'bad' {
  const bp =
    side === 'download'
      ? props.event.downloadMultiplier
      : props.event.uploadMultiplier;
  if (side === 'download') {
    if (bp < 100) return 'good';
    if (bp === 100) return 'neutral';
    return 'bad';
  }
  if (bp > 100) return 'good';
  if (bp === 100) return 'neutral';
  return 'bad';
}

function verdictIcon(side: 'download' | 'upload'): string {
  const tone = verdictTone(side);
  if (tone === 'good') {
    return side === 'download' ? 'ph:arrow-down-bold' : 'ph:arrow-up-bold';
  }
  if (tone === 'bad') {
    return side === 'download' ? 'ph:arrow-up-bold' : 'ph:arrow-down-bold';
  }
  return 'ph:equals-bold';
}

function verdict(side: 'download' | 'upload'): string {
  const bp =
    side === 'download'
      ? props.event.downloadMultiplier
      : props.event.uploadMultiplier;
  if (side === 'download') {
    if (bp === 0) return t('bonus.modal.verdict.free');
    if (bp < 100) return t('bonus.modal.verdict.discounted', { pct: bp });
    if (bp === 100) return t('bonus.modal.verdict.normal');
    return t('bonus.modal.verdict.surcharge', { mult: formatBonusMultiplier(bp) });
  }
  if (bp === 0) return t('bonus.modal.verdict.uploadNone');
  if (bp === 100) return t('bonus.modal.verdict.normal');
  if (bp < 100) return t('bonus.modal.verdict.uploadReduced', { pct: bp });
  return t('bonus.modal.verdict.uploadBonus', { mult: formatBonusMultiplier(bp) });
}

// Gauge bar — centered at 50% (= 100% multiplier = normal). For
// values <100%, the bar fills from the centre toward the LEFT;
// for >100%, toward the RIGHT. Capped so 200%+ doesn't bleed off.
function gaugeStartPct(side: 'download' | 'upload'): number {
  const bp =
    side === 'download'
      ? props.event.downloadMultiplier
      : props.event.uploadMultiplier;
  if (bp <= 100) {
    return Math.max(0, 50 - (100 - bp) / 2);
  }
  return 50;
}
function gaugeWidthPct(side: 'download' | 'upload'): number {
  const bp =
    side === 'download'
      ? props.event.downloadMultiplier
      : props.event.uploadMultiplier;
  if (bp <= 100) {
    return Math.min(50, (100 - bp) / 2);
  }
  return Math.min(50, (bp - 100) / 2);
}

// ── Date formatting ────────────────────────────────────────
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(
    locale.value === 'fr' ? 'fr-FR' : 'en-US',
    { dateStyle: 'medium', timeStyle: 'short' }
  );
}

// ── Explainer ──────────────────────────────────────────────
const explainer = computed(() => {
  if (props.event.longDescription) return props.event.longDescription;
  // Pool events with no admin-supplied long description: render
  // the localized default so the explainer matches the user's
  // language. The overlay variant calls out the displaced event.
  if (isPool.value) {
    return isOverlay.value
      ? t('bonus.modal.poolDefaults.longDescriptionOverlay')
      : t('bonus.modal.poolDefaults.longDescription');
  }
  const dl = props.event.downloadMultiplier;
  const ul = props.event.uploadMultiplier;
  const parts: string[] = [];
  if (dl === 0) {
    parts.push(t('bonus.modal.explainer.downloadFree'));
  } else if (dl < 100) {
    parts.push(t('bonus.modal.explainer.downloadReduced', { pct: dl }));
  } else if (dl === 100) {
    parts.push(t('bonus.modal.explainer.downloadNormal'));
  } else {
    parts.push(
      t('bonus.modal.explainer.downloadMultiplied', {
        mult: formatBonusMultiplier(dl),
      })
    );
  }
  if (ul === 0) {
    parts.push(t('bonus.modal.explainer.uploadNone'));
  } else if (ul === 100) {
    parts.push(t('bonus.modal.explainer.uploadNormal'));
  } else if (ul < 100) {
    parts.push(t('bonus.modal.explainer.uploadReduced', { pct: ul }));
  } else {
    parts.push(
      t('bonus.modal.explainer.uploadMultiplied', {
        mult: formatBonusMultiplier(ul),
      })
    );
  }
  return parts.join(' ');
});
</script>

<style scoped>
/* ── Header (replaces the default Modal title) ──────────── */
.bb-head-id {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  flex: 1;
}
.bb-onair {
  position: relative;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
/* Dot and rings both anchor to the centre via absolute + translate
   so they share an exact origin. (A `display: grid` with two
   children implicitly creates two rows, which threw the dot off
   the rings' centre by half the container height.) */
.bb-onair-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 9px;
  height: 9px;
  background: #f43f5e;
  border-radius: 50%;
  box-shadow: 0 0 12px rgba(244, 63, 94, 0.8);
  transform: translate(-50%, -50%);
  animation: bb-pulse 1.4s ease-in-out infinite;
}
@keyframes bb-pulse {
  0%, 100% { opacity: 0.55; transform: translate(-50%, -50%) scale(0.85); }
  50% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
}
.bb-onair-rings::before,
.bb-onair-rings::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 9px;
  height: 9px;
  border: 1px solid rgba(244, 63, 94, 0.6);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  animation: bb-ring 2s ease-out infinite;
  pointer-events: none;
}
.bb-onair-rings::after { animation-delay: 1s; }
@keyframes bb-ring {
  0% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
  20% { opacity: 0.8; }
  100% { transform: translate(-50%, -50%) scale(4.4); opacity: 0; }
}
.bb-onair-stamp {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: #f43f5e;
  flex: 1;
}
.bb-onair-now {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-muted));
}

/* ── Body shell ─────────────────────────────────────────── */
.bb {
  display: flex;
  flex-direction: column;
}

/* ── Title strip (under the red ON AIR header) ──────────── */
.bb-title-strip {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 1rem 1.15rem 1.1rem;
  background: linear-gradient(
    180deg,
    rgba(244, 63, 94, 0.06) 0%,
    rgba(244, 63, 94, 0.01) 60%,
    rgb(var(--bg-elevated)) 100%
  );
  border-bottom: 1px solid rgb(var(--line-default));
  overflow: hidden;
}
.bb-title-strip::before {
  /* Thin red filament running across the top — matches the
     admin "ON AIR" panel. */
  content: '';
  position: absolute;
  top: 0;
  inset-inline: 0.85rem;
  height: 2px;
  background: linear-gradient(
    to right,
    rgba(244, 63, 94, 0) 0%,
    #f43f5e 50%,
    rgba(244, 63, 94, 0) 100%
  );
  box-shadow: 0 0 12px rgba(244, 63, 94, 0.5);
}
.bb-title-strip--freeleech::before {
  background: linear-gradient(
    to right,
    rgba(108, 209, 97, 0) 0%,
    #6cd161 50%,
    rgba(108, 209, 97, 0) 100%
  );
  box-shadow: 0 0 12px rgba(108, 209, 97, 0.5);
}
.bb-title-strip--pool {
  background: linear-gradient(
    180deg,
    rgba(212, 167, 52, 0.08) 0%,
    rgba(212, 167, 52, 0.02) 60%,
    rgb(var(--bg-elevated)) 100%
  );
}
.bb-title-strip--pool::before {
  background: linear-gradient(
    to right,
    rgba(212, 167, 52, 0) 0%,
    #d4a734 50%,
    rgba(212, 167, 52, 0) 100%
  );
  box-shadow: 0 0 12px rgba(212, 167, 52, 0.5);
}

.bb-tag-row {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

/* Pool source badge — co-exists with the preset tag. */
.bb-source-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.22rem 0.55rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(212, 167, 52, 0.45);
  background: rgba(212, 167, 52, 0.08);
  color: #d4a734;
}
.bb-title-strip--pool .bb-preset-tag {
  color: #d4a734;
  border-color: rgba(212, 167, 52, 0.45);
  background: rgba(212, 167, 52, 0.08);
}

.bb-overlay-hint {
  display: inline-flex;
  align-items: flex-start;
  gap: 0.4rem;
  margin: 0.3rem 0 0;
  padding: 0.4rem 0.55rem;
  border-left: 2px solid rgba(212, 167, 52, 0.55);
  background: rgba(212, 167, 52, 0.05);
  font-size: 0.78rem;
  line-height: 1.5;
  color: rgb(var(--fg-muted));
}
.bb-overlay-icon {
  flex-shrink: 0;
  margin-top: 0.1rem;
  color: #d4a734;
}

/* Strike-through value in the DL meter — surfaces the original
   multiplier the pool replaced. */
.meter-value-strike {
  display: inline-block;
  margin-right: 0.5rem;
  font-size: 1.1rem;
  color: rgb(var(--fg-faint));
  text-decoration: line-through;
  text-decoration-color: rgba(244, 63, 94, 0.65);
  text-decoration-thickness: 2px;
}

.bb-preset-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  align-self: flex-start;
  padding: 0.22rem 0.55rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  border-radius: var(--radius-sm);
  border: 1px solid;
}
.bb-title-strip--freeleech .bb-preset-tag {
  color: #6cd161;
  border-color: rgba(108, 209, 97, 0.45);
  background: rgba(108, 209, 97, 0.08);
}
.bb-title-strip--silverleech .bb-preset-tag {
  color: #94a3b8;
  border-color: rgba(148, 163, 184, 0.45);
  background: rgba(148, 163, 184, 0.08);
}
.bb-title-strip--bonus .bb-preset-tag {
  color: #d4a734;
  border-color: rgba(212, 167, 52, 0.45);
  background: rgba(212, 167, 52, 0.08);
}
.bb-preset-tag-icon { font-size: 0.85rem; }

.bb-title {
  margin: 0;
  font-size: 1.45rem;
  font-weight: 800;
  letter-spacing: -0.015em;
  color: rgb(var(--fg-strong));
  line-height: 1.15;
  word-break: break-word;
}
.bb-countdown {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: #f43f5e;
  text-shadow: 0 0 10px rgba(244, 63, 94, 0.25);
}
.bb-countdown-icon { font-size: 0.95rem; }
.bb-desc {
  margin: 0;
  font-size: 0.82rem;
  color: rgb(var(--fg-muted));
  line-height: 1.55;
}

/* ── Multiplier meters ──────────────────────────────────── */
.bb-meters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
  padding: 0.95rem 1.15rem 0.5rem;
}
@media (max-width: 460px) {
  .bb-meters { grid-template-columns: 1fr; }
}
.meter {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.85rem 0.9rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  transition: border-color 0.2s ease;
}
.meter-head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.45rem;
}
.meter-tag {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--line-default));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-muted));
}
.meter-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.meter-verdict-icon {
  font-size: 0.95rem;
  color: rgb(var(--fg-muted));
}
.meter-value {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 1.85rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1;
  color: rgb(var(--fg-strong));
}
.meter-verdict {
  margin: 0;
  font-size: 0.74rem;
  color: rgb(var(--fg-muted));
  line-height: 1.4;
}

/* Tone variants — wash the meter card with the verdict colour. */
.meter--good {
  border-color: rgba(108, 209, 97, 0.45);
  background: rgba(108, 209, 97, 0.05);
}
.meter--good .meter-verdict-icon,
.meter--good .meter-value,
.meter--good .meter-verdict {
  color: #6cd161;
}
.meter--good .meter-bar-fill {
  background: linear-gradient(to right, #4ade80, #6cd161);
  box-shadow: 0 0 8px rgba(108, 209, 97, 0.45);
}
.meter--bad {
  border-color: rgba(244, 63, 94, 0.4);
  background: rgba(244, 63, 94, 0.05);
}
.meter--bad .meter-verdict-icon,
.meter--bad .meter-value,
.meter--bad .meter-verdict {
  color: #f43f5e;
}
.meter--bad .meter-bar-fill {
  background: linear-gradient(to right, #f43f5e, #fb7185);
}
.meter--neutral .meter-value,
.meter--neutral .meter-verdict-icon { color: rgb(var(--fg-strong)); }

/* Gauge — 100% multiplier is the centre; deviations from
   that fill to one side or the other. */
.meter-bar {
  position: relative;
  height: 4px;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 999px;
  overflow: hidden;
}
.meter-bar-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgb(var(--line-strong));
  transition: left 0.4s ease, width 0.4s ease;
}
.meter-bar-pivot {
  position: absolute;
  top: -2px;
  bottom: -2px;
  left: 50%;
  width: 1px;
  background: rgb(var(--fg-faint));
}

/* ── Window timeline ────────────────────────────────────── */
.bb-window {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.85rem 1.15rem 1rem;
  border-top: 1px solid rgb(var(--line-default));
}
.bb-window-head {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.bb-window-icon { font-size: 0.95rem; color: #d4a734; }

.bb-window-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
}
.bb-window-leg {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.bb-window-leg--right {
  align-items: flex-end;
  text-align: right;
}
.bb-window-leg-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}
.bb-window-leg-time {
  font-size: 0.82rem;
  color: rgb(var(--fg-strong));
  font-weight: 600;
}

.bb-window-track {
  position: relative;
  height: 6px;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 999px;
  overflow: hidden;
  margin: 0.2rem 0 0.2rem;
}
.bb-window-track-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(
    to right,
    rgba(212, 167, 52, 0.45) 0%,
    #d4a734 100%
  );
  transition: width 0.6s ease;
}
.bb-window-track-grid {
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    to right,
    transparent 0,
    transparent calc(20% - 1px),
    rgba(255, 255, 255, 0.06) calc(20% - 1px),
    rgba(255, 255, 255, 0.06) 20%
  );
  pointer-events: none;
}
.bb-window-marker {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #d4a734;
  border: 2px solid rgb(var(--bg-elevated));
  box-shadow: 0 0 8px rgba(212, 167, 52, 0.55);
  transition: left 0.6s ease;
  z-index: 1;
}

.bb-window-foot {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
}
.bb-window-foot-leg {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-muted));
}
.bb-window-foot-leg--right {
  text-align: right;
  color: #d4a734;
}

/* ── Explainer ──────────────────────────────────────────── */
.bb-explainer {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.85rem 1.15rem 0.9rem;
  border-top: 1px solid rgb(var(--line-default));
  background: linear-gradient(
    180deg,
    rgba(212, 167, 52, 0.03) 0%,
    transparent 100%
  );
}
.bb-explainer-head {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #d4a734;
}
.bb-explainer-icon { font-size: 0.95rem; }
.bb-explainer-body {
  margin: 0;
  font-size: 0.82rem;
  color: rgb(var(--fg-muted));
  line-height: 1.55;
}

/* ── Footer ─────────────────────────────────────────────── */
.bb-foot {
  display: flex;
  justify-content: flex-end;
  padding: 0.85rem 1.15rem 1rem;
  border-top: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
}
.bb-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 1.15rem;
  background: #d4a734;
  border: 1px solid #d4a734;
  border-radius: var(--radius-sm);
  color: #1a1a1a;
  font-family: inherit;
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s ease;
}
.bb-cta:hover {
  background: #e8b94e;
  border-color: #e8b94e;
  transform: translateY(-1px);
  box-shadow: 0 6px 18px -8px rgba(212, 167, 52, 0.5);
}
</style>

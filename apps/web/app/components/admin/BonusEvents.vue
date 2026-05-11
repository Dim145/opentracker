<template>
  <!--
    /admin/bonus-events — signal tower.

    The page is shaped like a broadcast schedule. The room divides
    into three zones:

      1. ON AIR — a glowing red panel that only renders when an
         event is currently live, with a ticking countdown so the
         operator knows how much window is left without doing the
         math.

      2. SCHEDULE — every other event grouped by status
         (Upcoming, Paused, Archive) with relative-time hints.

      3. Empty state — short copy + "schedule one" CTA when there
         are no events at all.

    Each row carries a status rail on the left, a paired
    multiplier readout (DL · UL), and an action cluster on the
    right. Active rows pulse; scheduled rows quietly tick down.
  -->
  <div class="tower">
    <!-- ── Header ──────────────────────────────────────────── -->
    <header class="tower-head">
      <div class="tower-head-id">
        <span class="tower-eyebrow">
          <span class="tower-eyebrow-rule" aria-hidden="true" />
          {{ $t('admin.bonusEvents.eyebrow') }}
        </span>
        <h1 class="tower-title">{{ $t('admin.bonusEvents.title') }}</h1>
        <i18n-t
          keypath="admin.bonusEvents.intro"
          tag="p"
          class="tower-intro"
        >
          <template #freeleech>
            <strong class="tower-intro-tag">{{ $t('admin.bonusEvents.freeleech') }}</strong>
          </template>
          <template #silverleech>
            <strong class="tower-intro-tag">{{ $t('admin.bonusEvents.silverleech') }}</strong>
          </template>
        </i18n-t>
      </div>
      <button type="button" class="tower-cta" @click="openCreate">
        <Icon name="ph:plus-bold" />
        <span>{{ $t('admin.bonusEvents.newEvent') }}</span>
      </button>
    </header>

    <!-- ── Loading ─────────────────────────────────────────── -->
    <div v-if="loading" class="tower-loading">
      <Icon name="ph:circle-notch" class="spin" />
      <span>{{ $t('admin.bonusEvents.loading') }}</span>
    </div>

    <!-- ── Empty state ─────────────────────────────────────── -->
    <section v-else-if="!events.length" class="tower-empty">
      <div class="tower-empty-stamp" aria-hidden="true">
        <Icon name="ph:broadcast-bold" />
      </div>
      <h2 class="tower-empty-title">
        {{ $t('admin.bonusEvents.emptyTitle') }}
      </h2>
      <i18n-t
        keypath="admin.bonusEvents.empty"
        tag="p"
        class="tower-empty-hint"
      >
        <template #action>
          <strong>{{ $t('admin.bonusEvents.emptyAction') }}</strong>
        </template>
      </i18n-t>
    </section>

    <template v-else>
      <!-- ═══════════════════════════════════════════════════════
           ON AIR — only renders when there's a currently active
           event. The countdown updates every second for that one
           ticker so the operator sees the window shrinking in
           real time.
           ═══════════════════════════════════════════════════════ -->
      <section v-if="activeEvents.length" class="onair">
        <header class="onair-head">
          <span class="onair-light">
            <span class="onair-light-dot" aria-hidden="true" />
            <span class="onair-light-rings" aria-hidden="true" />
          </span>
          <span class="onair-stamp">{{ $t('admin.bonusEvents.onAir') }}</span>
          <span class="onair-now tabular-nums">{{ wallClock }}</span>
        </header>

        <article
          v-for="ev in activeEvents"
          :key="ev.id"
          class="onair-event"
        >
          <div class="onair-event-id">
            <h2 class="onair-event-title">{{ ev.title }}</h2>
            <p v-if="ev.description" class="onair-event-desc">
              {{ ev.description }}
            </p>
          </div>

          <div class="onair-event-meta">
            <span class="preset-chip" :class="`preset-chip--${presetKind(ev)}`">
              <Icon :name="presetIcon(presetKind(ev))" class="preset-chip-icon" />
              <span class="preset-chip-label">{{ presetLabel(presetKind(ev)) }}</span>
            </span>
            <span class="mul-pair mul-pair--active">
              <span class="mul-pair-cell">
                <Icon name="ph:download-simple-bold" class="mul-pair-icon" />
                <span class="mul-pair-label">DL</span>
                <span class="mul-pair-value tabular-nums">×{{ formatMul(ev.downloadMultiplier) }}</span>
              </span>
              <span class="mul-pair-divider">·</span>
              <span class="mul-pair-cell">
                <Icon name="ph:upload-simple-bold" class="mul-pair-icon" />
                <span class="mul-pair-label">UL</span>
                <span class="mul-pair-value tabular-nums">×{{ formatMul(ev.uploadMultiplier) }}</span>
              </span>
            </span>
          </div>

          <div class="onair-countdown">
            <span class="onair-countdown-label">
              {{ $t('admin.bonusEvents.endsIn') }}
            </span>
            <span class="onair-countdown-time tabular-nums">
              {{ formatCountdown(ev.endsAt) }}
            </span>
          </div>

          <!-- Progress bar — fraction of the window already
               elapsed. Animates smoothly because we tick the
               clock every second. -->
          <div class="onair-bar" :aria-label="$t('admin.bonusEvents.progressAria')">
            <div
              class="onair-bar-fill"
              :style="{ width: `${windowProgress(ev) * 100}%` }"
            />
            <div class="onair-bar-grid" aria-hidden="true" />
          </div>

          <div class="onair-actions">
            <button
              type="button"
              class="act act--pause"
              :title="$t('admin.bonusEvents.row.disable')"
              @click="toggle(ev)"
            >
              <Icon name="ph:pause-fill" />
            </button>
            <button
              type="button"
              class="act"
              :title="$t('admin.bonusEvents.row.edit')"
              @click="openEdit(ev)"
            >
              <Icon name="ph:pencil-simple-bold" />
            </button>
            <button
              type="button"
              class="act act--delete"
              :title="$t('admin.bonusEvents.row.delete')"
              @click="askDelete(ev)"
            >
              <Icon name="ph:trash-bold" />
            </button>
          </div>
        </article>
      </section>

      <!-- ── UPCOMING ────────────────────────────────────────── -->
      <section v-if="upcomingEvents.length" class="schedule">
        <header class="schedule-head">
          <Icon name="ph:hourglass-medium-bold" class="schedule-head-icon" />
          <span class="schedule-head-label">{{ $t('admin.bonusEvents.upcoming') }}</span>
          <span class="schedule-head-count tabular-nums">{{ upcomingEvents.length }}</span>
        </header>
        <ul class="schedule-list">
          <li
            v-for="(ev, i) in upcomingEvents"
            :key="ev.id"
            class="slot slot--scheduled"
            :style="{ '--stagger': `${i * 50}ms` }"
          >
            <span class="slot-rail" aria-hidden="true" />
            <div class="slot-id">
              <div class="slot-title-row">
                <h3 class="slot-title">{{ ev.title }}</h3>
                <span class="preset-chip" :class="`preset-chip--${presetKind(ev)}`">
                  <Icon :name="presetIcon(presetKind(ev))" class="preset-chip-icon" />
                  <span class="preset-chip-label">{{ presetLabel(presetKind(ev)) }}</span>
                </span>
              </div>
              <p v-if="ev.description" class="slot-desc">
                {{ ev.description }}
              </p>
              <div class="slot-meta">
                <span class="slot-when">
                  <Icon name="ph:clock-clockwise-bold" />
                  {{ $t('admin.bonusEvents.startsIn', { rel: relativeFromNow(ev.startsAt) }) }}
                </span>
                <span class="slot-window tabular-nums">
                  {{ formatRange(ev.startsAt, ev.endsAt) }}
                </span>
              </div>
            </div>
            <span class="mul-pair mul-pair--scheduled">
              <span class="mul-pair-cell">
                <Icon name="ph:download-simple-bold" class="mul-pair-icon" />
                <span class="mul-pair-label">DL</span>
                <span class="mul-pair-value tabular-nums">×{{ formatMul(ev.downloadMultiplier) }}</span>
              </span>
              <span class="mul-pair-divider">·</span>
              <span class="mul-pair-cell">
                <Icon name="ph:upload-simple-bold" class="mul-pair-icon" />
                <span class="mul-pair-label">UL</span>
                <span class="mul-pair-value tabular-nums">×{{ formatMul(ev.uploadMultiplier) }}</span>
              </span>
            </span>
            <div class="slot-actions">
              <button
                type="button"
                class="act"
                :title="$t('admin.bonusEvents.row.disable')"
                @click="toggle(ev)"
              >
                <Icon name="ph:pause" />
              </button>
              <button
                type="button"
                class="act"
                :title="$t('admin.bonusEvents.row.edit')"
                @click="openEdit(ev)"
              >
                <Icon name="ph:pencil-simple-bold" />
              </button>
              <button
                type="button"
                class="act act--delete"
                :title="$t('admin.bonusEvents.row.delete')"
                @click="askDelete(ev)"
              >
                <Icon name="ph:trash-bold" />
              </button>
            </div>
          </li>
        </ul>
      </section>

      <!-- ── DISABLED (still in the window but toggled off) ── -->
      <section v-if="disabledEvents.length" class="schedule">
        <header class="schedule-head">
          <Icon name="ph:pause-bold" class="schedule-head-icon" />
          <span class="schedule-head-label">{{ $t('admin.bonusEvents.paused') }}</span>
          <span class="schedule-head-count tabular-nums">{{ disabledEvents.length }}</span>
        </header>
        <ul class="schedule-list">
          <li
            v-for="(ev, i) in disabledEvents"
            :key="ev.id"
            class="slot slot--disabled"
            :style="{ '--stagger': `${i * 50}ms` }"
          >
            <span class="slot-rail" aria-hidden="true" />
            <div class="slot-id">
              <div class="slot-title-row">
                <h3 class="slot-title">{{ ev.title }}</h3>
                <span class="preset-chip" :class="`preset-chip--${presetKind(ev)}`">
                  <Icon :name="presetIcon(presetKind(ev))" class="preset-chip-icon" />
                  <span class="preset-chip-label">{{ presetLabel(presetKind(ev)) }}</span>
                </span>
              </div>
              <p v-if="ev.description" class="slot-desc">{{ ev.description }}</p>
              <div class="slot-meta">
                <span class="slot-window tabular-nums">
                  {{ formatRange(ev.startsAt, ev.endsAt) }}
                </span>
              </div>
            </div>
            <span class="mul-pair mul-pair--disabled">
              <span class="mul-pair-cell">
                <Icon name="ph:download-simple-bold" class="mul-pair-icon" />
                <span class="mul-pair-label">DL</span>
                <span class="mul-pair-value tabular-nums">×{{ formatMul(ev.downloadMultiplier) }}</span>
              </span>
              <span class="mul-pair-divider">·</span>
              <span class="mul-pair-cell">
                <Icon name="ph:upload-simple-bold" class="mul-pair-icon" />
                <span class="mul-pair-label">UL</span>
                <span class="mul-pair-value tabular-nums">×{{ formatMul(ev.uploadMultiplier) }}</span>
              </span>
            </span>
            <div class="slot-actions">
              <button
                type="button"
                class="act act--resume"
                :title="$t('admin.bonusEvents.row.enable')"
                @click="toggle(ev)"
              >
                <Icon name="ph:play-fill" />
              </button>
              <button
                type="button"
                class="act"
                :title="$t('admin.bonusEvents.row.edit')"
                @click="openEdit(ev)"
              >
                <Icon name="ph:pencil-simple-bold" />
              </button>
              <button
                type="button"
                class="act act--delete"
                :title="$t('admin.bonusEvents.row.delete')"
                @click="askDelete(ev)"
              >
                <Icon name="ph:trash-bold" />
              </button>
            </div>
          </li>
        </ul>
      </section>

      <!-- ── ARCHIVE (ended) ─────────────────────────────────── -->
      <section v-if="endedEvents.length" class="schedule">
        <header class="schedule-head">
          <Icon name="ph:archive-bold" class="schedule-head-icon" />
          <span class="schedule-head-label">{{ $t('admin.bonusEvents.archive') }}</span>
          <span class="schedule-head-count tabular-nums">{{ endedEvents.length }}</span>
        </header>
        <ul class="schedule-list">
          <li
            v-for="(ev, i) in endedEvents"
            :key="ev.id"
            class="slot slot--ended"
            :style="{ '--stagger': `${Math.min(i, 8) * 40}ms` }"
          >
            <span class="slot-rail" aria-hidden="true" />
            <div class="slot-id">
              <div class="slot-title-row">
                <h3 class="slot-title">{{ ev.title }}</h3>
                <span class="preset-chip" :class="`preset-chip--${presetKind(ev)}`">
                  <Icon :name="presetIcon(presetKind(ev))" class="preset-chip-icon" />
                  <span class="preset-chip-label">{{ presetLabel(presetKind(ev)) }}</span>
                </span>
              </div>
              <div class="slot-meta">
                <span class="slot-window tabular-nums">
                  {{ formatRange(ev.startsAt, ev.endsAt) }}
                </span>
                <span class="slot-when slot-when--past">
                  {{ $t('admin.bonusEvents.endedAgo', { rel: relativeFromNow(ev.endsAt) }) }}
                </span>
              </div>
            </div>
            <span class="mul-pair mul-pair--ended">
              <span class="mul-pair-cell">
                <Icon name="ph:download-simple-bold" class="mul-pair-icon" />
                <span class="mul-pair-label">DL</span>
                <span class="mul-pair-value tabular-nums">×{{ formatMul(ev.downloadMultiplier) }}</span>
              </span>
              <span class="mul-pair-divider">·</span>
              <span class="mul-pair-cell">
                <Icon name="ph:upload-simple-bold" class="mul-pair-icon" />
                <span class="mul-pair-label">UL</span>
                <span class="mul-pair-value tabular-nums">×{{ formatMul(ev.uploadMultiplier) }}</span>
              </span>
            </span>
            <div class="slot-actions">
              <button
                type="button"
                class="act"
                :title="$t('admin.bonusEvents.row.edit')"
                @click="openEdit(ev)"
              >
                <Icon name="ph:pencil-simple-bold" />
              </button>
              <button
                type="button"
                class="act act--delete"
                :title="$t('admin.bonusEvents.row.delete')"
                @click="askDelete(ev)"
              >
                <Icon name="ph:trash-bold" />
              </button>
            </div>
          </li>
        </ul>
      </section>
    </template>

    <!-- ── Create / edit modal ─────────────────────────────── -->
    <Modal
      v-model="formOpen"
      :title="editing ? $t('admin.bonusEvents.form.editTitle') : $t('admin.bonusEvents.form.createTitle')"
      icon="ph:broadcast-bold"
      size="lg"
      :persistent="submitting"
      bodyClass="!p-0"
    >
      <form class="ed" @submit.prevent="submitForm">
        <div class="ed-body">
          <!-- Preset chips (compact, horizontal) -->
          <fieldset class="ed-block">
            <header class="ed-block-head">
              <span class="ed-num">01</span>
              <div class="ed-block-id">
                <h4>{{ $t('admin.bonusEvents.form.presetLabel') }}</h4>
              </div>
            </header>
            <div class="ed-presets">
              <button
                v-for="kind in (['freeleech', 'silverleech', 'custom'] as const)"
                :key="kind"
                type="button"
                class="ed-preset"
                :class="{ 'ed-preset--on': matchPreset(form) === kind }"
                @click="applyPreset(kind)"
              >
                <Icon :name="presetIcon(kind)" class="ed-preset-icon" />
                <span class="ed-preset-label">
                  {{ $t(`admin.bonusEvents.form.preset.${kind}`) }}
                </span>
                <span class="ed-preset-sub">
                  {{ $t(`admin.bonusEvents.form.preset.${kind}Sub`) }}
                </span>
              </button>
            </div>
          </fieldset>

          <fieldset class="ed-block">
            <header class="ed-block-head">
              <span class="ed-num">02</span>
              <div class="ed-block-id">
                <h4>{{ $t('admin.bonusEvents.form.titleLabel') }}</h4>
              </div>
            </header>
            <input
              v-model="form.title"
              type="text"
              maxlength="120"
              required
              :placeholder="$t('admin.bonusEvents.form.titlePlaceholder')"
              class="ed-input"
              :disabled="submitting"
            />
            <textarea
              v-model="form.description"
              rows="2"
              maxlength="500"
              :placeholder="$t('admin.bonusEvents.form.descriptionPlaceholder')"
              class="ed-input ed-textarea"
              :disabled="submitting"
            />
            <textarea
              v-model="form.longDescription"
              rows="3"
              maxlength="2000"
              :placeholder="$t('admin.bonusEvents.form.explainerPlaceholder')"
              class="ed-input ed-textarea"
              :disabled="submitting"
            />
            <p class="ed-hint">{{ $t('admin.bonusEvents.form.explainerHint') }}</p>
          </fieldset>

          <fieldset class="ed-block">
            <header class="ed-block-head">
              <span class="ed-num">03</span>
              <div class="ed-block-id">
                <h4>{{ $t('admin.bonusEvents.form.multipliers') }}</h4>
              </div>
            </header>
            <div class="ed-sliders">
              <div class="ed-slider">
                <div class="ed-slider-row">
                  <span class="ed-slider-label">
                    <Icon name="ph:download-simple-bold" />
                    {{ $t('admin.bonusEvents.form.downloadLabelShort') }}
                  </span>
                  <span class="ed-slider-value tabular-nums">
                    ×{{ formatMul(form.downloadMultiplier) }}
                  </span>
                </div>
                <input
                  v-model.number="form.downloadMultiplier"
                  type="range"
                  min="0"
                  max="200"
                  step="5"
                  class="ed-range ed-range--download"
                />
                <div class="ed-slider-ticks">
                  <span>0×</span><span>1×</span><span>2×</span>
                </div>
              </div>
              <div class="ed-slider">
                <div class="ed-slider-row">
                  <span class="ed-slider-label">
                    <Icon name="ph:upload-simple-bold" />
                    {{ $t('admin.bonusEvents.form.uploadLabelShort') }}
                  </span>
                  <span class="ed-slider-value tabular-nums">
                    ×{{ formatMul(form.uploadMultiplier) }}
                  </span>
                </div>
                <input
                  v-model.number="form.uploadMultiplier"
                  type="range"
                  min="0"
                  max="1000"
                  step="10"
                  class="ed-range ed-range--upload"
                />
                <div class="ed-slider-ticks">
                  <span>0×</span><span>5×</span><span>10×</span>
                </div>
              </div>
            </div>
          </fieldset>

          <fieldset class="ed-block">
            <header class="ed-block-head">
              <span class="ed-num">04</span>
              <div class="ed-block-id">
                <h4>{{ $t('admin.bonusEvents.form.window') }}</h4>
              </div>
            </header>
            <div class="ed-window">
              <label class="ed-window-leg">
                <span class="ed-window-label">{{ $t('admin.bonusEvents.form.startsAt') }}</span>
                <input
                  v-model="form.startsAt"
                  type="datetime-local"
                  required
                  class="ed-input"
                  :disabled="submitting"
                />
              </label>
              <Icon name="ph:arrow-right-bold" class="ed-window-arrow" />
              <label class="ed-window-leg">
                <span class="ed-window-label">{{ $t('admin.bonusEvents.form.endsAt') }}</span>
                <input
                  v-model="form.endsAt"
                  type="datetime-local"
                  required
                  class="ed-input"
                  :disabled="submitting"
                />
              </label>
            </div>
            <p v-if="windowDuration" class="ed-hint">
              {{ $t('admin.bonusEvents.form.durationHint', { duration: windowDuration }) }}
            </p>
          </fieldset>

          <fieldset class="ed-block">
            <header class="ed-block-head">
              <span class="ed-num">05</span>
              <div class="ed-block-id">
                <h4>{{ $t('admin.bonusEvents.form.enabled') }}</h4>
              </div>
            </header>
            <label class="ed-toggle-row" :class="{ 'ed-toggle-row--on': form.enabled }">
              <button
                type="button"
                role="switch"
                :aria-checked="form.enabled"
                class="ed-toggle"
                :class="{ 'ed-toggle--on': form.enabled }"
                :disabled="submitting"
                @click="form.enabled = !form.enabled"
              >
                <span class="ed-toggle-knob" />
              </button>
              <span class="ed-toggle-body">
                <span class="ed-toggle-title">
                  {{ form.enabled
                    ? $t('admin.bonusEvents.form.enabledOn')
                    : $t('admin.bonusEvents.form.enabledOff') }}
                </span>
                <span class="ed-toggle-sub">
                  {{ $t('admin.bonusEvents.form.enabledHint') }}
                </span>
              </span>
            </label>
          </fieldset>

          <p v-if="formError" class="ed-error">
            <Icon name="ph:warning-circle-fill" />
            {{ formError }}
          </p>
        </div>
      </form>

      <template #footer>
        <button
          type="button"
          class="ed-btn ed-btn--ghost"
          :disabled="submitting"
          @click="formOpen = false"
        >
          {{ $t('common.cancel') }}
        </button>
        <button
          type="button"
          class="ed-btn ed-btn--primary"
          :disabled="submitting || !canSubmit"
          @click="submitForm"
        >
          <Icon
            :name="submitting ? 'ph:circle-notch' : (editing ? 'ph:floppy-disk-bold' : 'ph:broadcast-bold')"
            :class="{ spin: submitting }"
          />
          <span>{{ editing ? $t('admin.bonusEvents.form.saveSubmit') : $t('admin.bonusEvents.form.createSubmit') }}</span>
        </button>
      </template>
    </Modal>

    <!-- ── Delete confirmation ──────────────────────────────── -->
    <Modal
      v-model="deleteOpen"
      :title="$t('admin.bonusEvents.deleteModal.title')"
      icon="ph:warning-octagon-bold"
      size="sm"
    >
      <div class="del">
        <i18n-t keypath="admin.bonusEvents.deleteModal.message" tag="p" class="del-message">
          <template #title>
            <strong>{{ pendingDelete?.title }}</strong>
          </template>
        </i18n-t>
      </div>
      <template #footer>
        <button
          type="button"
          class="ed-btn ed-btn--ghost"
          :disabled="deleting"
          @click="deleteOpen = false"
        >
          {{ $t('common.cancel') }}
        </button>
        <button
          type="button"
          class="ed-btn ed-btn--danger"
          :disabled="deleting"
          @click="confirmDelete"
        >
          <Icon
            :name="deleting ? 'ph:circle-notch' : 'ph:trash-bold'"
            :class="{ spin: deleting }"
          />
          <span>{{ $t('common.delete') }}</span>
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Modal from '~/components/Modal.vue';

const { t, locale } = useI18n();

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

// ── Wall clock — drives the ON AIR countdown + progress bar ──
// Ticks every second only when there's at least one active event
// to avoid spending CPU on an idle dashboard.
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

const wallClock = computed(() => {
  const d = new Date(now.value);
  return d.toLocaleTimeString(locale.value === 'fr' ? 'fr-FR' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
});

// ── Buckets ──────────────────────────────────────────────────
const activeEvents = computed(() =>
  events.value.filter((e) => e.status === 'active')
);
const upcomingEvents = computed(() =>
  events.value
    .filter((e) => e.status === 'scheduled')
    .sort(
      (a, b) =>
        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    )
);
const disabledEvents = computed(() =>
  events.value.filter((e) => e.status === 'disabled')
);
const endedEvents = computed(() =>
  events.value
    .filter((e) => e.status === 'ended')
    .sort(
      (a, b) =>
        new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime()
    )
);

// ── Display helpers ──────────────────────────────────────────
function formatMul(bp: number): string {
  const x = bp / 100;
  return Number.isInteger(x)
    ? String(x)
    : x.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatRange(startsAt: string, endsAt: string): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const sameDay = s.toDateString() === e.toDateString();
  const fmtDate = (d: Date) =>
    d.toLocaleString(locale.value === 'fr' ? 'fr-FR' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  return sameDay
    ? `${fmtDate(s)} → ${e.toLocaleTimeString(locale.value === 'fr' ? 'fr-FR' : 'en-US', { hour: '2-digit', minute: '2-digit' })}`
    : `${fmtDate(s)} → ${fmtDate(e)}`;
}

function relativeFromNow(iso: string): string {
  const target = new Date(iso).getTime();
  const diff = Math.abs(target - now.value) / 1000;
  if (diff < 60) return t('admin.bonusEvents.rel.seconds', { n: Math.round(diff) });
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return t('admin.bonusEvents.rel.minutes', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('admin.bonusEvents.rel.hours', { n: hours });
  const days = Math.floor(hours / 24);
  return t('admin.bonusEvents.rel.days', { n: days });
}

function formatCountdown(iso: string): string {
  const target = new Date(iso).getTime();
  const remaining = Math.max(0, target - now.value);
  const secs = Math.floor(remaining / 1000);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = secs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) {
    return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function windowProgress(ev: BonusEvent): number {
  const start = new Date(ev.startsAt).getTime();
  const end = new Date(ev.endsAt).getTime();
  if (end <= start) return 1;
  const ratio = (now.value - start) / (end - start);
  if (ratio < 0) return 0;
  if (ratio > 1) return 1;
  return ratio;
}

const windowDuration = computed(() => {
  if (!form.value.startsAt || !form.value.endsAt) return null;
  const s = new Date(form.value.startsAt).getTime();
  const e = new Date(form.value.endsAt).getTime();
  if (e <= s) return null;
  const totalMins = Math.round((e - s) / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const minutes = totalMins % 60;
  const parts: string[] = [];
  if (days) parts.push(t('admin.bonusEvents.rel.days', { n: days }));
  if (hours) parts.push(t('admin.bonusEvents.rel.hours', { n: hours }));
  if (minutes && !days) parts.push(t('admin.bonusEvents.rel.minutes', { n: minutes }));
  return parts.join(' ');
});

function presetKind(ev: BonusEvent | typeof form.value): 'freeleech' | 'silverleech' | 'custom' {
  if (ev.downloadMultiplier === 0 && ev.uploadMultiplier === 100) return 'freeleech';
  if (ev.downloadMultiplier === 50 && ev.uploadMultiplier === 100) return 'silverleech';
  return 'custom';
}

function presetIcon(kind: 'freeleech' | 'silverleech' | 'custom'): string {
  switch (kind) {
    case 'freeleech':
      return 'ph:gift-bold';
    case 'silverleech':
      return 'ph:medal-bold';
    case 'custom':
      return 'ph:sliders-horizontal-bold';
  }
}

const canSubmit = computed(() => {
  if (!form.value.title.trim()) return false;
  if (!form.value.startsAt || !form.value.endsAt) return false;
  return new Date(form.value.endsAt) > new Date(form.value.startsAt);
});

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
}

// ── Open / submit ────────────────────────────────────────────
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string {
  return new Date(local).toISOString();
}

function openCreate() {
  editing.value = null;
  formError.value = null;
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(Date.now() + 24 * 60 * 60 * 1000);
  form.value = {
    title: '',
    description: '',
    longDescription: '',
    downloadMultiplier: 100,
    uploadMultiplier: 100,
    startsAt: isoToLocalInput(start.toISOString()),
    endsAt: isoToLocalInput(end.toISOString()),
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
      await $fetch('/api/admin/bonus-events', { method: 'POST', body });
    }
    formOpen.value = false;
    await load();
  } catch (err: unknown) {
    formError.value =
      (err as { data?: { message?: string } })?.data?.message ??
      (err as { statusMessage?: string })?.statusMessage ??
      t('admin.bonusEvents.errors.saveFailed');
  } finally {
    submitting.value = false;
  }
}

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
    // Only tick when there's actually something live to count down.
    if (activeEvents.value.length > 0) {
      startTicker();
    } else {
      stopTicker();
    }
  }
}

onMounted(() => {
  load();
});

onBeforeUnmount(() => {
  stopTicker();
});

function presetLabel(kind: 'freeleech' | 'silverleech' | 'custom'): string {
  switch (kind) {
    case 'freeleech':
      return t('admin.bonusEvents.freeleech');
    case 'silverleech':
      return t('admin.bonusEvents.silverleech');
    case 'custom':
      return t('admin.bonusEvents.custom');
  }
}
</script>

<style scoped>
/* ── Page shell ──────────────────────────────────────────── */
.tower {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  position: relative;
}

/* ── Header ─────────────────────────────────────────────── */
.tower-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1.5rem;
  align-items: flex-end;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgb(var(--line-default));
  position: relative;
}
.tower-head::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -1px;
  width: 64px;
  height: 1px;
  background: #d4a734;
}
.tower-head-id {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}
.tower-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: #d4a734;
}
.tower-eyebrow-rule {
  display: inline-block;
  width: 26px;
  height: 1px;
  background: #d4a734;
}
.tower-title {
  margin: 0;
  font-size: 1.65rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: rgb(var(--fg-strong));
}
.tower-intro {
  margin: 0;
  max-width: 66ch;
  font-size: 0.82rem;
  line-height: 1.6;
  color: rgb(var(--fg-muted));
}
.tower-intro-tag {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}
.tower-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.05rem;
  background: #d4a734;
  border: 1px solid #d4a734;
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #1a1a1a;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.tower-cta:hover {
  background: #e8b94e;
  transform: translateY(-1px);
  box-shadow: 0 6px 18px -8px rgba(212, 167, 52, 0.45);
}

/* ── Loading / empty ─────────────────────────────────────── */
.tower-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  padding: 3rem 1rem;
  color: rgb(var(--fg-muted));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.tower-loading svg { font-size: 1.4rem; }

.tower-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;
  padding: 3.5rem 1.5rem;
  text-align: center;
  background: rgb(var(--bg-elevated));
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-md);
}
.tower-empty-stamp {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(212, 167, 52, 0.08);
  border: 1px solid rgba(212, 167, 52, 0.4);
  color: #d4a734;
  font-size: 1.7rem;
  position: relative;
}
.tower-empty-stamp::before,
.tower-empty-stamp::after {
  content: '';
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  border: 1px solid rgba(212, 167, 52, 0.18);
  animation: ring 3.2s ease-out infinite;
  pointer-events: none;
}
.tower-empty-stamp::after { animation-delay: 1.6s; }
@keyframes ring {
  0% { transform: scale(0.7); opacity: 0; }
  30% { opacity: 0.6; }
  100% { transform: scale(1.35); opacity: 0; }
}
.tower-empty-title {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.tower-empty-hint {
  margin: 0;
  font-size: 0.82rem;
  color: rgb(var(--fg-muted));
  max-width: 44ch;
  line-height: 1.5;
}

/* ══════════════════════════════════════════════════════════════
   ON AIR panel
   ══════════════════════════════════════════════════════════════ */
.onair {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0;
  background: linear-gradient(
    180deg,
    rgba(244, 63, 94, 0.06) 0%,
    rgba(244, 63, 94, 0.02) 30%,
    rgb(var(--bg-elevated)) 100%
  );
  border: 1px solid rgba(244, 63, 94, 0.4);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.onair::before {
  /* Red filament along the top edge — the "you're live" hint. */
  content: '';
  position: absolute;
  top: 0;
  inset-inline: 1rem;
  height: 2px;
  background: linear-gradient(
    to right,
    rgba(244, 63, 94, 0) 0%,
    #f43f5e 50%,
    rgba(244, 63, 94, 0) 100%
  );
  box-shadow: 0 0 12px rgba(244, 63, 94, 0.6);
}

.onair-head {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 0.85rem 1.1rem;
  border-bottom: 1px solid rgba(244, 63, 94, 0.25);
  background: rgba(0, 0, 0, 0.15);
}
.onair-light {
  position: relative;
  width: 18px;
  height: 18px;
}
/* Both the dot and the rings anchor on the absolute centre — a
   grid container with two children would otherwise create two
   implicit rows and push the dot off the rings' centre. */
.onair-light-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 9px;
  height: 9px;
  background: #f43f5e;
  border-radius: 50%;
  box-shadow: 0 0 12px rgba(244, 63, 94, 0.8);
  transform: translate(-50%, -50%);
  animation: light-pulse 1.4s ease-in-out infinite;
}
@keyframes light-pulse {
  0%, 100% { opacity: 0.55; transform: translate(-50%, -50%) scale(0.85); }
  50% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
}
.onair-light-rings::before,
.onair-light-rings::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 9px;
  height: 9px;
  border: 1px solid rgba(244, 63, 94, 0.6);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  animation: light-ring 2s ease-out infinite;
  pointer-events: none;
}
.onair-light-rings::after { animation-delay: 1s; }
@keyframes light-ring {
  0% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
  20% { opacity: 0.8; }
  100% { transform: translate(-50%, -50%) scale(4.4); opacity: 0; }
}
.onair-stamp {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: #f43f5e;
  flex: 1;
}
.onair-now {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-muted));
}

.onair-event {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  grid-template-areas:
    'id    meta      countdown'
    'bar   bar       bar'
    'actions actions actions';
  gap: 0.85rem 1.25rem;
  padding: 1.1rem 1.25rem 1.1rem;
  align-items: center;
}
@media (max-width: 760px) {
  .onair-event {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'id'
      'meta'
      'countdown'
      'bar'
      'actions';
  }
}
.onair-event + .onair-event {
  border-top: 1px dashed rgba(244, 63, 94, 0.25);
}
.onair-event-id {
  grid-area: id;
  min-width: 0;
}
.onair-event-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: rgb(var(--fg-strong));
  word-break: break-word;
}
.onair-event-desc {
  margin: 0.25rem 0 0;
  font-size: 0.82rem;
  color: rgb(var(--fg-muted));
  line-height: 1.5;
}
.onair-event-meta {
  grid-area: meta;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  align-items: flex-end;
}
@media (max-width: 760px) {
  .onair-event-meta { align-items: flex-start; }
}
.onair-countdown {
  grid-area: countdown;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  align-items: flex-end;
  padding-left: 1rem;
  border-left: 1px solid rgba(244, 63, 94, 0.25);
}
@media (max-width: 760px) {
  .onair-countdown {
    border-left: 0;
    padding-left: 0;
    align-items: flex-start;
  }
}
.onair-countdown-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.onair-countdown-time {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 1.5rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: #f43f5e;
  text-shadow: 0 0 18px rgba(244, 63, 94, 0.35);
  line-height: 1.1;
}

.onair-bar {
  grid-area: bar;
  position: relative;
  height: 6px;
  background: rgb(var(--bg-base));
  border: 1px solid rgba(244, 63, 94, 0.25);
  border-radius: 999px;
  overflow: hidden;
}
.onair-bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(
    to right,
    rgba(244, 63, 94, 0.4) 0%,
    #f43f5e 60%,
    #fb7185 100%
  );
  box-shadow: 0 0 14px rgba(244, 63, 94, 0.55);
  transition: width 1s linear;
}
.onair-bar-grid {
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    to right,
    transparent 0,
    transparent calc(10% - 1px),
    rgba(255, 255, 255, 0.08) calc(10% - 1px),
    rgba(255, 255, 255, 0.08) 10%
  );
  pointer-events: none;
}
.onair-actions {
  grid-area: actions;
  display: flex;
  justify-content: flex-end;
  gap: 0.35rem;
}
@media (max-width: 760px) {
  .onair-actions { justify-content: flex-start; }
}

/* ══════════════════════════════════════════════════════════════
   Schedule sections
   ══════════════════════════════════════════════════════════════ */
.schedule {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.schedule-head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding-bottom: 0.35rem;
  border-bottom: 1px solid rgb(var(--line-default));
}
.schedule-head-icon {
  font-size: 1rem;
  color: #d4a734;
}
.schedule-head-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.schedule-head-count {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  color: rgb(var(--fg-muted));
  margin-left: auto;
}
.schedule-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.slot {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.85rem 1rem;
  padding: 0.85rem 1rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  transition: border-color 0.2s ease, transform 0.2s ease,
    box-shadow 0.2s ease;
  animation: slot-in 0.4s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
}
.slot:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 22px -16px rgba(0, 0, 0, 0.55);
}
.slot--scheduled:hover { border-color: rgba(96, 165, 250, 0.45); }
.slot--disabled:hover { border-color: rgba(251, 146, 60, 0.45); }
.slot--ended:hover { border-color: rgb(var(--line-strong)); }
.slot--ended { opacity: 0.78; }
@keyframes slot-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.slot-rail {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  border-top-left-radius: var(--radius-md);
  border-bottom-left-radius: var(--radius-md);
}
.slot--scheduled .slot-rail {
  background: linear-gradient(to bottom, #60a5fa 0%, rgba(96, 165, 250, 0.45) 100%);
}
.slot--disabled .slot-rail {
  background: linear-gradient(to bottom, #fb923c 0%, rgba(251, 146, 60, 0.45) 100%);
}
.slot--ended .slot-rail {
  background: rgb(var(--line-strong));
}
@media (max-width: 760px) {
  .slot {
    grid-template-columns: minmax(0, 1fr);
  }
}

.slot-id {
  min-width: 0;
  padding-left: 0.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.slot-title-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
}
.slot-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: rgb(var(--fg-strong));
  word-break: break-word;
}
.slot-desc {
  margin: 0;
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
  line-height: 1.5;
}
.slot-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 1.1rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.03em;
}
.slot-when {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: rgb(var(--fg-strong));
}
.slot-when--past {
  color: rgb(var(--fg-muted));
}
.slot-when svg { font-size: 0.9rem; color: inherit; }
.slot-actions {
  display: flex;
  gap: 0.25rem;
  align-self: stretch;
  align-items: center;
}

/* ══════════════════════════════════════════════════════════════
   Preset chip + multiplier pair (used in both the ON AIR panel
   and the schedule rows)
   ══════════════════════════════════════════════════════════════ */
.preset-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.45rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.preset-chip-icon { font-size: 0.85rem; }
.preset-chip--freeleech {
  color: #6cd161;
  border-color: rgba(108, 209, 97, 0.4);
  background: rgba(108, 209, 97, 0.08);
}
.preset-chip--silverleech {
  color: #94a3b8;
  border-color: rgba(148, 163, 184, 0.4);
  background: rgba(148, 163, 184, 0.08);
}
.preset-chip--custom {
  color: #d4a734;
  border-color: rgba(212, 167, 52, 0.4);
  background: rgba(212, 167, 52, 0.06);
}

.mul-pair {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.65rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
}
.mul-pair-cell {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.mul-pair-icon {
  font-size: 0.85rem;
  color: rgb(var(--fg-muted));
}
.mul-pair-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.mul-pair-value {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  font-weight: 800;
  color: rgb(var(--fg-strong));
  letter-spacing: -0.02em;
}
.mul-pair-divider {
  color: rgb(var(--fg-faint));
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.mul-pair--active {
  border-color: rgba(244, 63, 94, 0.45);
  background: rgba(244, 63, 94, 0.06);
}
.mul-pair--active .mul-pair-value { color: #f43f5e; }
.mul-pair--scheduled {
  border-color: rgba(96, 165, 250, 0.3);
}
.mul-pair--scheduled .mul-pair-value { color: #60a5fa; }
.mul-pair--disabled .mul-pair-value { color: #fb923c; }
.mul-pair--ended {
  opacity: 0.75;
}

/* ══════════════════════════════════════════════════════════════
   Action buttons (used in ON AIR + every slot row)
   ══════════════════════════════════════════════════════════════ */
.act {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: all 0.16s ease;
  font-size: 0.9rem;
}
.act:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--line-strong));
}
.act--pause:hover { color: #fb923c; border-color: rgba(251, 146, 60, 0.45); }
.act--resume {
  color: #6cd161;
  border-color: rgba(108, 209, 97, 0.4);
  background: rgba(108, 209, 97, 0.06);
}
.act--resume:hover {
  background: rgba(108, 209, 97, 0.12);
}
.act--delete:hover {
  color: #f43f5e;
  border-color: rgba(244, 63, 94, 0.45);
  background: rgba(244, 63, 94, 0.06);
}

/* ══════════════════════════════════════════════════════════════
   Modal editor (atlas-style numbered blocks)
   ══════════════════════════════════════════════════════════════ */
.ed {
  display: flex;
  flex-direction: column;
}
.ed-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem 1.1rem 1.1rem;
  position: relative;
}
.ed-body::before {
  content: '';
  position: absolute;
  left: 0.55rem;
  top: 0.6rem;
  bottom: 0.6rem;
  width: 1px;
  background: linear-gradient(
    to bottom,
    rgba(212, 167, 52, 0) 0%,
    rgba(212, 167, 52, 0.3) 12%,
    rgba(212, 167, 52, 0.3) 88%,
    rgba(212, 167, 52, 0) 100%
  );
  pointer-events: none;
}

.ed-block {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}
.ed-block-head {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0.7rem;
}
.ed-num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.18em;
  color: #d4a734;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgba(212, 167, 52, 0.35);
  padding: 0.22rem 0.45rem;
  border-radius: var(--radius-sm);
}
.ed-block-id h4 {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}

.ed-input,
.ed-textarea {
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-strong));
  font-size: 0.85rem;
  font-family: inherit;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.ed-input:focus,
.ed-textarea:focus {
  outline: none;
  border-color: rgba(212, 167, 52, 0.55);
  box-shadow: 0 0 0 3px rgba(212, 167, 52, 0.1);
}
.ed-textarea {
  resize: vertical;
  min-height: 60px;
  line-height: 1.5;
}

.ed-hint {
  margin: 0;
  font-size: 11px;
  color: rgb(var(--fg-muted));
  line-height: 1.45;
}
.ed-error {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: 11.5px;
  color: rgb(var(--danger));
}

/* ── Preset chips inside the modal ───────────────────── */
.ed-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.ed-preset {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  padding: 0.5rem 0.75rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
  min-width: 130px;
  flex: 1;
}
.ed-preset:hover:not(.ed-preset--on) {
  border-color: rgb(var(--line-strong));
  color: rgb(var(--fg-strong));
}
.ed-preset-icon {
  font-size: 0.95rem;
}
.ed-preset-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.ed-preset-sub {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-faint));
}
.ed-preset--on {
  background: rgba(212, 167, 52, 0.08);
  border-color: rgba(212, 167, 52, 0.55);
  color: #d4a734;
  box-shadow: inset 0 0 0 1px rgba(212, 167, 52, 0.3);
}
.ed-preset--on .ed-preset-sub { color: rgba(212, 167, 52, 0.7); }

/* ── Multiplier sliders ──────────────────────────────── */
.ed-sliders {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
@media (max-width: 540px) {
  .ed-sliders { grid-template-columns: 1fr; }
}
.ed-slider {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.55rem 0.7rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
}
.ed-slider-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.ed-slider-label {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.ed-slider-label svg { font-size: 0.95rem; }
.ed-slider-value {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.95rem;
  font-weight: 800;
  color: #d4a734;
  letter-spacing: -0.01em;
}
.ed-range {
  width: 100%;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  cursor: pointer;
}
.ed-range::-webkit-slider-runnable-track {
  height: 4px;
  background: linear-gradient(to right, rgba(212, 167, 52, 0.5) 0%, rgb(var(--line-default)) 0%);
  border-radius: 999px;
}
.ed-range::-moz-range-track {
  height: 4px;
  background: rgb(var(--line-default));
  border-radius: 999px;
}
.ed-range::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #d4a734;
  border: 2px solid rgb(var(--bg-elevated));
  box-shadow: 0 0 8px rgba(212, 167, 52, 0.45);
  margin-top: -5px;
  cursor: grab;
}
.ed-range::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #d4a734;
  border: 2px solid rgb(var(--bg-elevated));
  box-shadow: 0 0 8px rgba(212, 167, 52, 0.45);
  cursor: grab;
}
.ed-slider-ticks {
  display: flex;
  justify-content: space-between;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  color: rgb(var(--fg-faint));
  letter-spacing: 0.04em;
}

/* ── Window leg pair ─────────────────────────────────── */
.ed-window {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: end;
  gap: 0.55rem;
}
@media (max-width: 540px) {
  .ed-window {
    grid-template-columns: 1fr;
  }
  .ed-window-arrow { display: none; }
}
.ed-window-leg {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.ed-window-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.ed-window-arrow {
  align-self: center;
  font-size: 1rem;
  color: rgb(var(--fg-faint));
  margin-bottom: 0.55rem;
}

/* ── Toggle row ──────────────────────────────────────── */
.ed-toggle-row {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.55rem 0.85rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-base));
  cursor: pointer;
  transition: all 0.18s ease;
}
.ed-toggle-row--on {
  border-color: rgba(108, 209, 97, 0.4);
  background: rgba(108, 209, 97, 0.04);
}
.ed-toggle {
  position: relative;
  flex-shrink: 0;
  width: 2.5rem;
  height: 1.4rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
}
.ed-toggle--on {
  background: #6cd161;
  border-color: #6cd161;
  box-shadow: 0 0 10px -2px rgba(108, 209, 97, 0.55);
}
.ed-toggle:disabled { cursor: not-allowed; opacity: 0.6; }
.ed-toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 9999px;
  background: rgb(var(--bg-base));
  transition: transform 0.22s cubic-bezier(0.2, 0.7, 0.2, 1),
    background 0.18s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}
.ed-toggle--on .ed-toggle-knob {
  transform: translateX(1rem);
  background: #fff;
}
.ed-toggle-body {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.ed-toggle-title {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.ed-toggle-row--on .ed-toggle-title { color: #6cd161; }
.ed-toggle-sub {
  font-size: 11px;
  color: rgb(var(--fg-muted));
  line-height: 1.4;
}

/* ── Footer buttons ──────────────────────────────────── */
.ed-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.55rem 1rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-strong));
  font-family: inherit;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.ed-btn:hover:not(:disabled) {
  border-color: rgb(var(--line-strong));
}
.ed-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ed-btn--ghost { background: transparent; color: rgb(var(--fg-muted)); }
.ed-btn--primary {
  background: #d4a734;
  border-color: #d4a734;
  color: #1a1a1a;
}
.ed-btn--primary:hover:not(:disabled) {
  background: #e8b94e;
  border-color: #e8b94e;
}
.ed-btn--danger {
  background: #f43f5e;
  border-color: #f43f5e;
  color: white;
}
.ed-btn--danger:hover:not(:disabled) {
  background: #e11d48;
  border-color: #e11d48;
}

/* ── Delete modal ────────────────────────────────────── */
.del {
  padding: 0.5rem 0;
}
.del-message {
  margin: 0;
  font-size: 0.88rem;
  color: rgb(var(--fg-strong));
  line-height: 1.55;
}

/* ── Shared spinner ──────────────────────────────────── */
.spin {
  animation: be-spin 1s linear infinite;
}
@keyframes be-spin {
  to { transform: rotate(360deg); }
}
</style>

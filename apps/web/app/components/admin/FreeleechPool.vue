<template>
  <!--
    /admin/freeleech-pool — pool control surface.

    Aesthetic direction: a modern dark dashboard with one editorial
    moment (the italic serif "Le" in the title). Surfaces are flat
    with hairline borders, the gauge is a refined SVG ring instead
    of a mechanical dial, and inputs follow the site's neutral
    token system. Gold (#d4a734) stays the identity color for the
    pool but is used sparingly as accent — not as wallpaper.

    Sections:
      01 · Reservoir status   (gauge + readouts + patrons + reset)
      02 · Calibration        (toggle + config grid + save)
      03 · Schedule           (tabbed window forms + deployed list)
      04 · Ledger             (cycle history table)
  -->
  <div class="pool">
    <!-- ── Atmospheric backdrop ──────────────────────────── -->
    <div class="bg" aria-hidden="true">
      <div class="bg-orb bg-orb--gold" />
      <div class="bg-orb bg-orb--cool" />
      <div class="bg-grid" />
    </div>

    <!-- ── Hero ──────────────────────────────────────────── -->
    <header class="hero">
      <div class="hero-eyebrow">
        <span class="hero-eyebrow-rule" aria-hidden="true" />
        <span>{{ $t('admin.freeleechPool.cistern.classification') }}</span>
      </div>
      <h1 class="hero-title">
        <span class="hero-title-le">Le</span>
        <span class="hero-title-name">Réservoir</span>
      </h1>
      <p class="hero-intro">{{ $t('admin.freeleechPool.intro') }}</p>
    </header>

    <!-- ── Boot screen ───────────────────────────────────── -->
    <div v-if="loadingConfig" class="boot">
      <Icon name="ph:circle-notch" class="boot-icon spin" />
      <span>{{ $t('admin.freeleechPool.cistern.connecting') }}</span>
    </div>

    <template v-else-if="config">
      <!-- ────────────────────────────────────────────────────
           01 · Reservoir status
           ──────────────────────────────────────────────────── -->
      <section class="card" :style="{ '--stagger': '0ms' }">
        <header class="card-head">
          <span class="card-id">01</span>
          <h2 class="card-title">{{ $t('admin.freeleechPool.cistern.reservoir') }}</h2>
        </header>
        <div class="card-body">
          <div v-if="!currentCycle" class="empty">
            <Icon name="ph:drop-half" class="empty-icon" />
            <p>{{ $t('admin.freeleechPool.noCycle') }}</p>
          </div>

          <div v-else class="reservoir">
            <!-- Gauge — SVG semicircle ring with smooth fill -->
            <div class="gauge-wrap">
              <svg class="gauge" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stop-color="#a47f29" />
                    <stop offset="50%" stop-color="#d4a734" />
                    <stop offset="100%" stop-color="#f0c75b" />
                  </linearGradient>
                  <filter id="gauge-marker-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="3" />
                  </filter>
                </defs>

                <!-- Background arc (dim) -->
                <path
                  d="M 14 104 A 86 86 0 0 1 186 104"
                  fill="none"
                  stroke="rgba(212, 167, 52, 0.12)"
                  stroke-width="5"
                  stroke-linecap="round"
                />
                <!-- Progress arc -->
                <path
                  d="M 14 104 A 86 86 0 0 1 186 104"
                  fill="none"
                  stroke="url(#gauge-grad)"
                  stroke-width="5"
                  stroke-linecap="round"
                  :stroke-dasharray="gaugeCircumference"
                  :stroke-dashoffset="gaugeOffset"
                  style="transition: stroke-dashoffset 1.2s cubic-bezier(0.2, 0.7, 0.2, 1)"
                />
                <!-- Major tick marks (0/25/50/75/100) -->
                <line
                  v-for="i in 5"
                  :key="`tick-${i}`"
                  :x1="tickX(i - 1, 75)"
                  :y1="tickY(i - 1, 75)"
                  :x2="tickX(i - 1, 70)"
                  :y2="tickY(i - 1, 70)"
                  stroke="rgba(212, 167, 52, 0.45)"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
                <!-- Marker dot with halo -->
                <circle
                  :cx="markerX"
                  :cy="markerY"
                  r="7"
                  fill="rgba(240, 199, 91, 0.4)"
                  filter="url(#gauge-marker-glow)"
                  style="transition: cx 1.2s cubic-bezier(0.2,0.7,0.2,1), cy 1.2s cubic-bezier(0.2,0.7,0.2,1)"
                />
                <circle
                  :cx="markerX"
                  :cy="markerY"
                  r="4"
                  fill="#f0c75b"
                  style="transition: cx 1.2s cubic-bezier(0.2,0.7,0.2,1), cy 1.2s cubic-bezier(0.2,0.7,0.2,1)"
                />
              </svg>
              <div class="gauge-center">
                <span class="gauge-num tabular-nums">
                  {{ Math.round(progressPct) }}<span class="gauge-pct">%</span>
                </span>
                <span class="gauge-label">{{ $t('admin.freeleechPool.cistern.fillLevel') }}</span>
              </div>
            </div>

            <!-- Readouts — 2×2 grid of key metrics -->
            <dl class="readouts">
              <div class="readout">
                <dt>{{ $t('admin.freeleechPool.fields.status') }}</dt>
                <dd>
                  <span class="status-dot" :class="`status-dot--${currentCycle.status}`" aria-hidden="true" />
                  <span>{{ $t(`admin.freeleechPool.cycleStatus.${currentCycle.status}`) }}</span>
                </dd>
              </div>
              <div class="readout">
                <dt>{{ $t('admin.freeleechPool.fields.collected') }}</dt>
                <dd>
                  <span class="readout-big tabular-nums">
                    {{ formatNumber(currentCycle.totalContributed) }}
                  </span>
                  <span class="readout-of tabular-nums">
                    / {{ formatNumber(currentCycle.targetSnapshot) }}
                  </span>
                </dd>
              </div>
              <div class="readout">
                <dt>{{ $t('admin.freeleechPool.fields.durationDays') }}</dt>
                <dd class="tabular-nums">{{ currentCycle.durationDaysSnapshot }}d</dd>
              </div>
              <div v-if="currentCycle.endsAt" class="readout">
                <dt>{{ $t('admin.freeleechPool.fields.endsAt') }}</dt>
                <dd class="tabular-nums">{{ formatDateTime(currentCycle.endsAt) }}</dd>
              </div>
            </dl>

            <!-- Patrons — clean ranked list, #1 highlighted -->
            <div v-if="currentTop.length > 0" class="patrons">
              <header class="patrons-head">
                <Icon name="ph:trophy" />
                <span>{{ $t('admin.freeleechPool.topPatrons') }}</span>
              </header>
              <ol class="patrons-list">
                <li
                  v-for="(p, i) in currentTop"
                  :key="p.userId"
                  class="patron"
                  :class="{ 'patron--lead': i === 0 }"
                >
                  <span class="patron-rank tabular-nums">{{ String(i + 1).padStart(2, '0') }}</span>
                  <span class="patron-name">{{ p.username }}</span>
                  <span class="patron-amount tabular-nums">{{ formatNumber(p.total) }}</span>
                </li>
              </ol>
            </div>

            <!-- Reset action — bottom right, danger-outline style -->
            <button
              type="button"
              class="btn btn--danger reservoir-reset"
              :disabled="resetting"
              @click="confirmReset"
            >
              <Icon
                :name="resetting ? 'ph:circle-notch' : 'ph:trash'"
                :class="resetting ? 'spin' : ''"
              />
              <span>{{ $t('admin.freeleechPool.reset') }}</span>
            </button>
          </div>
        </div>
      </section>

      <!-- ────────────────────────────────────────────────────
           02 · Calibration
           ──────────────────────────────────────────────────── -->
      <section class="card" :style="{ '--stagger': '80ms' }">
        <header class="card-head">
          <span class="card-id">02</span>
          <h2 class="card-title">{{ $t('admin.freeleechPool.cistern.calibration') }}</h2>
          <p class="card-help">{{ $t('admin.freeleechPool.configHelp') }}</p>
        </header>
        <div class="card-body">
          <!-- Master switch -->
          <label class="switch">
            <input v-model="config.enabled" type="checkbox" class="switch-input">
            <span class="switch-track">
              <span class="switch-thumb" />
            </span>
            <span class="switch-copy">
              <span class="switch-state" :class="{ 'switch-state--on': config.enabled }">
                {{
                  config.enabled
                    ? $t('admin.freeleechPool.cistern.armed')
                    : $t('admin.freeleechPool.cistern.offline')
                }}
              </span>
              <span class="switch-hint">{{ $t('admin.freeleechPool.cistern.armedHint') }}</span>
            </span>
          </label>

          <!-- Calibration grid -->
          <div class="cal-grid">
            <div class="field field--xl">
              <label class="field-label">{{ $t('admin.freeleechPool.fields.target') }}</label>
              <div class="field-input field-input--unit">
                <input
                  v-model.number="config.pointsTarget"
                  type="number"
                  min="0"
                  class="input input--xl"
                >
                <span class="unit">pts</span>
              </div>
            </div>

            <div class="field">
              <label class="field-label">{{ $t('admin.freeleechPool.fields.durationDays') }}</label>
              <div class="field-input field-input--unit">
                <input
                  v-model.number="config.freeleechDurationDays"
                  type="number"
                  min="1"
                  max="30"
                  class="input"
                >
                <span class="unit">days</span>
              </div>
            </div>

            <div class="field">
              <label class="field-label">{{ $t('admin.freeleechPool.fields.contributionMin') }}</label>
              <div class="field-input field-input--unit">
                <input v-model.number="config.contributionMin" type="number" min="1" class="input">
                <span class="unit">pts</span>
              </div>
            </div>

            <div class="field">
              <label class="field-label">{{ $t('admin.freeleechPool.fields.maxPerUserPct') }}</label>
              <div class="field-input field-input--unit">
                <input
                  v-model.number="maxPerUserPct"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  class="input"
                >
                <span class="unit">%</span>
              </div>
              <span class="field-hint">{{ $t('admin.freeleechPool.fields.maxPerUserHint') }}</span>
            </div>

            <div class="field field--wide">
              <label class="field-label">{{ $t('admin.freeleechPool.fields.presetAmounts') }}</label>
              <input
                v-model="presetAmountsInput"
                type="text"
                :placeholder="$t('admin.freeleechPool.fields.presetAmountsPlaceholder')"
                class="input"
              >
              <span class="field-hint">{{ $t('admin.freeleechPool.fields.presetAmountsHint') }}</span>
            </div>

            <div class="field field--wide">
              <label class="field-label">{{ $t('admin.freeleechPool.fields.eventTitle') }}</label>
              <input v-model="config.eventTitleTemplate" type="text" maxlength="120" class="input">
            </div>

            <div class="field field--wide">
              <label class="field-label">{{ $t('admin.freeleechPool.fields.eventDescription') }}</label>
              <textarea
                v-model="config.eventDescriptionTemplate"
                rows="2"
                maxlength="500"
                class="input textarea"
              />
            </div>
          </div>

          <div class="actions">
            <button
              type="button"
              class="btn btn--primary"
              :disabled="savingConfig"
              @click="saveConfig"
            >
              <Icon
                :name="savingConfig ? 'ph:circle-notch' : 'ph:check-bold'"
                :class="savingConfig ? 'spin' : ''"
              />
              <span>{{ $t('common.save') }}</span>
            </button>
          </div>
        </div>
      </section>

      <!-- ────────────────────────────────────────────────────
           03 · Schedule
           ──────────────────────────────────────────────────── -->
      <section class="card" :style="{ '--stagger': '160ms' }">
        <header class="card-head">
          <span class="card-id">03</span>
          <h2 class="card-title">{{ $t('admin.freeleechPool.cistern.schedule') }}</h2>
          <p class="card-help">{{ $t('admin.freeleechPool.windowsHelp') }}</p>
        </header>
        <div class="card-body">
          <!-- Tabs -->
          <div class="tabs" role="tablist">
            <button
              v-for="k in tabKinds"
              :key="k"
              type="button"
              class="tab"
              :class="{ 'tab--on': scheduleTab === k }"
              :aria-pressed="scheduleTab === k"
              role="tab"
              @click="scheduleTab = k"
            >
              <Icon :name="tabIcon(k)" class="tab-icon" />
              <span>{{ $t(`admin.freeleechPool.kind.${k}`) }}</span>
            </button>
          </div>

          <!-- Tab body -->
          <div class="tab-body">
            <!-- ─── One-off ─── -->
            <div v-if="scheduleTab === 'oneoff'" class="form">
              <div class="form-grid">
                <div class="field">
                  <label class="field-label">{{ $t('admin.freeleechPool.fields.from') }}</label>
                  <input v-model="newOneoff.startsAt" type="datetime-local" class="input">
                </div>
                <div class="field">
                  <label class="field-label">{{ $t('admin.freeleechPool.fields.to') }}</label>
                  <input v-model="newOneoff.endsAt" type="datetime-local" class="input">
                </div>
                <div class="field field--wide">
                  <label class="field-label">{{ $t('admin.freeleechPool.fields.label') }}</label>
                  <input v-model="newOneoff.label" type="text" maxlength="60" class="input">
                </div>
              </div>
              <button
                type="button"
                class="btn btn--primary btn--sm"
                :disabled="!validOneoff"
                @click="addOneoff"
              >
                <Icon name="ph:plus-bold" />
                <span>{{ $t('admin.freeleechPool.add') }}</span>
              </button>
            </div>

            <!-- ─── Weekly ─── -->
            <div v-else-if="scheduleTab === 'weekly'" class="form">
              <div class="form-grid">
                <div class="field">
                  <label class="field-label">{{ $t('admin.freeleechPool.fields.fromDay') }}</label>
                  <select v-model.number="newWeekly.weekdayStart" class="input">
                    <option v-for="d in weekdays" :key="`s-${d.value}`" :value="d.value">
                      {{ d.label }}
                    </option>
                  </select>
                </div>
                <div class="field">
                  <label class="field-label">{{ $t('admin.freeleechPool.fields.fromTime') }}</label>
                  <input v-model="newWeekly.timeStart" type="time" class="input">
                </div>
                <div class="field">
                  <label class="field-label">{{ $t('admin.freeleechPool.fields.toDay') }}</label>
                  <select v-model.number="newWeekly.weekdayEnd" class="input">
                    <option v-for="d in weekdays" :key="`e-${d.value}`" :value="d.value">
                      {{ d.label }}
                    </option>
                  </select>
                </div>
                <div class="field">
                  <label class="field-label">{{ $t('admin.freeleechPool.fields.toTime') }}</label>
                  <input v-model="newWeekly.timeEnd" type="time" class="input">
                </div>
                <div class="field field--wide">
                  <label class="field-label">{{ $t('admin.freeleechPool.fields.label') }}</label>
                  <input v-model="newWeekly.label" type="text" maxlength="60" class="input">
                </div>
              </div>
              <p class="form-hint">{{ $t('admin.freeleechPool.fields.utcHint') }}</p>
              <button
                type="button"
                class="btn btn--primary btn--sm"
                :disabled="!validWeekly"
                @click="addWeekly"
              >
                <Icon name="ph:plus-bold" />
                <span>{{ $t('admin.freeleechPool.add') }}</span>
              </button>
            </div>

            <!-- ─── Monthly ─── -->
            <div v-else-if="scheduleTab === 'monthly'" class="form">
              <div class="field field--full">
                <label class="field-label">{{ $t('admin.freeleechPool.fields.daysOfMonth') }}</label>
                <div class="day-grid">
                  <button
                    v-for="d in 31"
                    :key="d"
                    type="button"
                    class="day-chip"
                    :class="{ 'day-chip--on': newMonthly.days.includes(d) }"
                    @click="toggleMonthlyDay(d)"
                  >
                    {{ d }}
                  </button>
                </div>
                <span class="field-hint">{{ $t('admin.freeleechPool.fields.daysOfMonthHint') }}</span>
              </div>
              <div class="form-grid">
                <div class="field">
                  <label class="field-label">{{ $t('admin.freeleechPool.fields.fromTime') }}</label>
                  <input v-model="newMonthly.timeStart" type="time" class="input">
                </div>
                <div class="field">
                  <label class="field-label">{{ $t('admin.freeleechPool.fields.toTime') }}</label>
                  <input v-model="newMonthly.timeEnd" type="time" class="input">
                </div>
                <div class="field field--wide">
                  <label class="field-label">{{ $t('admin.freeleechPool.fields.label') }}</label>
                  <input v-model="newMonthly.label" type="text" maxlength="60" class="input">
                </div>
              </div>
              <p class="form-hint">{{ $t('admin.freeleechPool.fields.utcHint') }}</p>
              <button
                type="button"
                class="btn btn--primary btn--sm"
                :disabled="!validMonthly"
                @click="addMonthly"
              >
                <Icon name="ph:plus-bold" />
                <span>{{ $t('admin.freeleechPool.add') }}</span>
              </button>
            </div>

            <!-- ─── Yearly ─── -->
            <div v-else-if="scheduleTab === 'yearly'" class="form">
              <div class="form-grid">
                <div class="field">
                  <label class="field-label">{{ $t('admin.freeleechPool.fields.fromMonth') }}</label>
                  <select v-model.number="newYearly.monthStart" class="input">
                    <option v-for="m in months" :key="`ms-${m.value}`" :value="m.value">
                      {{ m.label }}
                    </option>
                  </select>
                </div>
                <div class="field">
                  <label class="field-label">{{ $t('admin.freeleechPool.fields.fromDayOfMonth') }}</label>
                  <input v-model.number="newYearly.dayStart" type="number" min="1" max="31" class="input">
                </div>
                <div class="field">
                  <label class="field-label">{{ $t('admin.freeleechPool.fields.toMonth') }}</label>
                  <select v-model.number="newYearly.monthEnd" class="input">
                    <option v-for="m in months" :key="`me-${m.value}`" :value="m.value">
                      {{ m.label }}
                    </option>
                  </select>
                </div>
                <div class="field">
                  <label class="field-label">{{ $t('admin.freeleechPool.fields.toDayOfMonth') }}</label>
                  <input v-model.number="newYearly.dayEnd" type="number" min="1" max="31" class="input">
                </div>
                <div class="field field--wide">
                  <label class="field-label">{{ $t('admin.freeleechPool.fields.label') }}</label>
                  <input v-model="newYearly.label" type="text" maxlength="60" class="input">
                </div>
              </div>
              <p class="form-hint">{{ $t('admin.freeleechPool.fields.yearlyHint') }}</p>
              <button
                type="button"
                class="btn btn--primary btn--sm"
                :disabled="!validYearly"
                @click="addYearly"
              >
                <Icon name="ph:plus-bold" />
                <span>{{ $t('admin.freeleechPool.add') }}</span>
              </button>
            </div>
          </div>

          <!-- Deployed list -->
          <div class="deployed">
            <header class="deployed-head">
              <span class="deployed-title">
                {{ $t('admin.freeleechPool.cistern.deployed') }}
              </span>
              <span class="deployed-count tabular-nums">{{ windows.length }}</span>
            </header>

            <div v-if="windows.length === 0" class="empty empty--inline">
              <Icon name="ph:circuitry" class="empty-icon" />
              <span>{{ $t('admin.freeleechPool.windowsEmpty') }}</span>
            </div>

            <ul v-else class="deployed-list">
              <li v-for="w in windows" :key="w.id" class="window">
                <span
                  class="window-pip"
                  :class="{ 'window-pip--off': !w.enabled }"
                  aria-hidden="true"
                />
                <span class="window-kind" :class="`window-kind--${w.kind}`">
                  {{ $t(`admin.freeleechPool.kind.${w.kind}`) }}
                </span>
                <span class="window-desc">{{ describeWindow(w) }}</span>
                <span v-if="w.label" class="window-label">{{ w.label }}</span>
                <label class="window-toggle">
                  <input type="checkbox" :checked="w.enabled" @change="toggleWindow(w)">
                  <span>{{ w.enabled ? $t('common.enabled') : $t('common.disabled') }}</span>
                </label>
                <button
                  type="button"
                  class="icon-btn icon-btn--danger"
                  :aria-label="$t('common.delete')"
                  @click="removeWindow(w.id)"
                >
                  <Icon name="ph:trash" />
                </button>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- ────────────────────────────────────────────────────
           04 · Ledger
           ──────────────────────────────────────────────────── -->
      <section class="card" :style="{ '--stagger': '240ms' }">
        <header class="card-head">
          <span class="card-id">04</span>
          <h2 class="card-title">{{ $t('admin.freeleechPool.cistern.ledger') }}</h2>
        </header>
        <div class="card-body card-body--flush">
          <div v-if="loadingCycles" class="empty">
            <Icon name="ph:circle-notch" class="spin" />
          </div>
          <div v-else-if="closedCycles.length === 0" class="empty">
            <Icon name="ph:notebook" class="empty-icon" />
            <p>{{ $t('admin.freeleechPool.historyEmpty') }}</p>
          </div>
          <div v-else class="ledger-wrap">
            <table class="ledger">
              <thead>
                <tr>
                  <th>{{ $t('admin.freeleechPool.cistern.folio') }}</th>
                  <th>{{ $t('admin.freeleechPool.fields.status') }}</th>
                  <th class="right">{{ $t('admin.freeleechPool.fields.target') }}</th>
                  <th class="right">{{ $t('admin.freeleechPool.fields.collected') }}</th>
                  <th>{{ $t('admin.freeleechPool.fields.startedAt') }}</th>
                  <th>{{ $t('admin.freeleechPool.fields.closedAt') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(c, i) in closedCycles" :key="c.id">
                  <td class="folio tabular-nums">
                    №{{ String(closedCycles.length - i).padStart(3, '0') }}
                  </td>
                  <td>
                    <span class="pill" :class="`pill--${c.status}`">
                      {{ $t(`admin.freeleechPool.cycleStatus.${c.status}`) }}
                    </span>
                  </td>
                  <td class="right tabular-nums">{{ formatNumber(c.targetSnapshot) }}</td>
                  <td class="right tabular-nums">{{ formatNumber(c.totalContributed) }}</td>
                  <td class="tabular-nums muted">{{ c.startedAt ? formatDateTime(c.startedAt) : '—' }}</td>
                  <td class="tabular-nums muted">{{ c.closedAt ? formatDateTime(c.closedAt) : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n();
const notifications = useNotificationStore();
const confirm = useConfirm();

interface PoolConfig {
  id: number;
  enabled: boolean;
  pointsTarget: number;
  freeleechDurationDays: number;
  contributionMin: number;
  maxPerUserBp: number;
  presetAmounts: number[];
  eventTitleTemplate: string | null;
  eventDescriptionTemplate: string | null;
  eventLongDescriptionTemplate: string | null;
}
interface Window {
  id: string;
  kind: 'oneoff' | 'weekly' | 'monthly' | 'yearly';
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  weekdayStart: number | null;
  weekdayEnd: number | null;
  minuteStart: number | null;
  minuteEnd: number | null;
  monthlyDays: number[] | null;
  yearMonthStart: number | null;
  yearDayStart: number | null;
  yearMonthEnd: number | null;
  yearDayEnd: number | null;
  label: string | null;
}
interface CycleRow {
  id: string;
  status: 'filling' | 'full_queued' | 'active' | 'ended' | 'cancelled';
  targetSnapshot: number;
  durationDaysSnapshot: number;
  totalContributed: number;
  startedAt: string | null;
  endsAt: string | null;
  closedAt: string | null;
  triggeredEventId: string | null;
  top: Array<{ userId: string; username: string; total: number }>;
}

const config = ref<PoolConfig | null>(null);
const windows = ref<Window[]>([]);
const cycles = ref<CycleRow[]>([]);
const loadingConfig = ref(true);
const loadingCycles = ref(true);
const savingConfig = ref(false);
const resetting = ref(false);

const maxPerUserPct = computed({
  get() {
    return config.value ? config.value.maxPerUserBp / 100 : 0;
  },
  set(v: number) {
    if (config.value) {
      config.value.maxPerUserBp = Math.round(Math.max(0, Math.min(100, v)) * 100);
    }
  },
});

const presetAmountsInput = computed({
  get() {
    return config.value?.presetAmounts.join(', ') ?? '';
  },
  set(raw: string) {
    if (!config.value) return;
    const parsed = raw
      .split(/[,\s]+/)
      .map((x) => parseInt(x, 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    config.value.presetAmounts = parsed.slice(0, 8);
  },
});

const weekdays = computed(() => {
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return keys.map((k, i) => ({
    value: i,
    label: t(`admin.freeleechPool.weekday.${k}`),
  }));
});

const months = computed(() => {
  return Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: t(`admin.freeleechPool.month.${String(i + 1).padStart(2, '0')}`),
  }));
});

const tabKinds = ['oneoff', 'weekly', 'monthly', 'yearly'] as const;
type TabKind = (typeof tabKinds)[number];
const scheduleTab = ref<TabKind>('weekly');

function tabIcon(kind: TabKind): string {
  switch (kind) {
    case 'oneoff':
      return 'ph:calendar-blank-bold';
    case 'weekly':
      return 'ph:repeat-bold';
    case 'monthly':
      return 'ph:calendar-dots-bold';
    case 'yearly':
      return 'ph:flower-tulip-bold';
  }
}

const newOneoff = reactive({
  startsAt: '',
  endsAt: '',
  label: '',
});
const newWeekly = reactive({
  weekdayStart: 5,
  timeStart: '18:00',
  weekdayEnd: 0,
  timeEnd: '23:59',
  label: '',
});
const newMonthly = reactive({
  days: [] as number[],
  timeStart: '00:00',
  timeEnd: '23:59',
  label: '',
});
const newYearly = reactive({
  monthStart: 12,
  dayStart: 20,
  monthEnd: 1,
  dayEnd: 5,
  label: '',
});

const validOneoff = computed(() => {
  if (!newOneoff.startsAt || !newOneoff.endsAt) return false;
  return new Date(newOneoff.endsAt) > new Date(newOneoff.startsAt);
});
const validWeekly = computed(() => {
  if (newWeekly.timeStart === '' || newWeekly.timeEnd === '') return false;
  if (
    newWeekly.weekdayStart === newWeekly.weekdayEnd &&
    newWeekly.timeStart === newWeekly.timeEnd
  )
    return false;
  return true;
});
const validMonthly = computed(() => {
  if (newMonthly.days.length === 0) return false;
  if (newMonthly.timeStart === '' || newMonthly.timeEnd === '') return false;
  if (newMonthly.timeStart === newMonthly.timeEnd) return false;
  return true;
});
const validYearly = computed(() => {
  if (
    !newYearly.monthStart ||
    !newYearly.dayStart ||
    !newYearly.monthEnd ||
    !newYearly.dayEnd
  )
    return false;
  if (newYearly.dayStart < 1 || newYearly.dayStart > 31) return false;
  if (newYearly.dayEnd < 1 || newYearly.dayEnd > 31) return false;
  if (
    newYearly.monthStart === newYearly.monthEnd &&
    newYearly.dayStart === newYearly.dayEnd
  )
    return false;
  return true;
});

function toggleMonthlyDay(d: number) {
  const idx = newMonthly.days.indexOf(d);
  if (idx >= 0) {
    newMonthly.days.splice(idx, 1);
  } else {
    newMonthly.days.push(d);
    newMonthly.days.sort((a, b) => a - b);
  }
}

const currentCycle = computed<CycleRow | null>(() => {
  return (
    cycles.value.find(
      (c) =>
        c.status === 'filling' ||
        c.status === 'full_queued' ||
        c.status === 'active'
    ) ?? null
  );
});
const currentTop = computed(() => currentCycle.value?.top ?? []);
const closedCycles = computed(() =>
  cycles.value.filter((c) => !currentCycle.value || c.id !== currentCycle.value.id)
);

// ── Gauge math ────────────────────────────────────────────────
// The dial is a 200×120 viewBox semicircle, baseline at y=104, arc
// radius 86. The progress arc uses `stroke-dasharray` +
// `stroke-dashoffset` for a smooth fill animation. The marker dot
// rides on the same arc — its (cx, cy) is recomputed from the
// progress angle so it tracks the leading edge.
const progressPct = computed(() => {
  if (!currentCycle.value) return 0;
  const target = currentCycle.value.targetSnapshot;
  if (target <= 0) return 0;
  return Math.min(
    100,
    Math.max(0, (currentCycle.value.totalContributed / target) * 100)
  );
});

const gaugeCircumference = Math.PI * 86;
const gaugeOffset = computed(
  () => gaugeCircumference * (1 - progressPct.value / 100)
);

// SVG: y-axis points down, so we subtract sin() from the baseline.
// Map progress 0..100 to angle π..0 (left → right across the top).
const markerAngle = computed(() => Math.PI - (progressPct.value / 100) * Math.PI);
const markerX = computed(() => 100 + 86 * Math.cos(markerAngle.value));
const markerY = computed(() => 104 - 86 * Math.sin(markerAngle.value));

function tickX(idx: number, r: number): number {
  // 5 ticks at 0%/25%/50%/75%/100% → angles π, 3π/4, π/2, π/4, 0.
  const angle = Math.PI - (idx * Math.PI) / 4;
  return 100 + r * Math.cos(angle);
}
function tickY(idx: number, r: number): number {
  const angle = Math.PI - (idx * Math.PI) / 4;
  return 104 - r * Math.sin(angle);
}

// ── Data loading + mutations ──────────────────────────────────
async function loadConfig() {
  loadingConfig.value = true;
  try {
    const { config: c } = await $fetch<{ config: PoolConfig }>(
      '/api/admin/freeleech-pool/config'
    );
    config.value = c;
  } catch (err: any) {
    notifications.error(err?.data?.message ?? t('common.loadError'));
  } finally {
    loadingConfig.value = false;
  }
}

async function loadWindows() {
  try {
    const { windows: w } = await $fetch<{ windows: Window[] }>(
      '/api/admin/freeleech-pool/windows'
    );
    windows.value = w;
  } catch (err: any) {
    notifications.error(err?.data?.message ?? t('common.loadError'));
  }
}

async function loadCycles() {
  loadingCycles.value = true;
  try {
    const { cycles: rows } = await $fetch<{ cycles: CycleRow[] }>(
      '/api/admin/freeleech-pool/cycles'
    );
    cycles.value = rows;
  } catch (err: any) {
    notifications.error(err?.data?.message ?? t('common.loadError'));
  } finally {
    loadingCycles.value = false;
  }
}

// Initial load runs on the client only — when `$fetch`-ing the
// `/api/admin/freeleech-pool/*` routes from SSR, the auth cookie
// isn't forwarded, so the server fan-out would 401 three times
// and queue three "Authentication required" toasts into the
// hydrated state. Deferring to `onMounted` skips SSR entirely
// (the page renders the boot screen first, then fills in once the
// browser owns the request and its cookies travel with it).
onMounted(() => {
  loadConfig();
  loadWindows();
  loadCycles();
});

async function saveConfig() {
  if (!config.value) return;
  savingConfig.value = true;
  try {
    await $fetch('/api/admin/freeleech-pool/config', {
      method: 'PATCH',
      body: {
        enabled: config.value.enabled,
        pointsTarget: config.value.pointsTarget,
        freeleechDurationDays: config.value.freeleechDurationDays,
        contributionMin: config.value.contributionMin,
        maxPerUserBp: config.value.maxPerUserBp,
        presetAmounts: config.value.presetAmounts,
        eventTitleTemplate: config.value.eventTitleTemplate,
        eventDescriptionTemplate: config.value.eventDescriptionTemplate,
      },
    });
    notifications.success(t('admin.freeleechPool.toasts.configSaved'));
  } catch (err: any) {
    notifications.error(err?.data?.message ?? t('admin.freeleechPool.errors.save'));
  } finally {
    savingConfig.value = false;
  }
}

async function addOneoff() {
  if (!validOneoff.value) return;
  try {
    await $fetch('/api/admin/freeleech-pool/windows', {
      method: 'POST',
      body: {
        kind: 'oneoff',
        startsAt: new Date(newOneoff.startsAt).toISOString(),
        endsAt: new Date(newOneoff.endsAt).toISOString(),
        label: newOneoff.label || null,
      },
    });
    newOneoff.startsAt = '';
    newOneoff.endsAt = '';
    newOneoff.label = '';
    await loadWindows();
  } catch (err: any) {
    notifications.error(err?.data?.message ?? t('admin.freeleechPool.errors.windowAdd'));
  }
}

function timeToMinutes(s: string): number {
  const [h, m] = s.split(':').map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

async function addWeekly() {
  if (!validWeekly.value) return;
  try {
    await $fetch('/api/admin/freeleech-pool/windows', {
      method: 'POST',
      body: {
        kind: 'weekly',
        weekdayStart: newWeekly.weekdayStart,
        weekdayEnd: newWeekly.weekdayEnd,
        minuteStart: timeToMinutes(newWeekly.timeStart),
        minuteEnd: timeToMinutes(newWeekly.timeEnd),
        label: newWeekly.label || null,
      },
    });
    newWeekly.label = '';
    await loadWindows();
  } catch (err: any) {
    notifications.error(err?.data?.message ?? t('admin.freeleechPool.errors.windowAdd'));
  }
}

async function addMonthly() {
  if (!validMonthly.value) return;
  try {
    await $fetch('/api/admin/freeleech-pool/windows', {
      method: 'POST',
      body: {
        kind: 'monthly',
        monthlyDays: [...newMonthly.days].sort((a, b) => a - b),
        minuteStart: timeToMinutes(newMonthly.timeStart),
        minuteEnd: timeToMinutes(newMonthly.timeEnd),
        label: newMonthly.label || null,
      },
    });
    newMonthly.days = [];
    newMonthly.label = '';
    await loadWindows();
  } catch (err: any) {
    notifications.error(err?.data?.message ?? t('admin.freeleechPool.errors.windowAdd'));
  }
}

async function addYearly() {
  if (!validYearly.value) return;
  try {
    await $fetch('/api/admin/freeleech-pool/windows', {
      method: 'POST',
      body: {
        kind: 'yearly',
        yearMonthStart: newYearly.monthStart,
        yearDayStart: newYearly.dayStart,
        yearMonthEnd: newYearly.monthEnd,
        yearDayEnd: newYearly.dayEnd,
        label: newYearly.label || null,
      },
    });
    newYearly.label = '';
    await loadWindows();
  } catch (err: any) {
    notifications.error(err?.data?.message ?? t('admin.freeleechPool.errors.windowAdd'));
  }
}

async function toggleWindow(w: Window) {
  try {
    await $fetch(`/api/admin/freeleech-pool/windows/${w.id}`, {
      method: 'PATCH',
      body: { enabled: !w.enabled },
    });
    await loadWindows();
  } catch (err: any) {
    notifications.error(err?.data?.message ?? t('common.error'));
  }
}

async function removeWindow(id: string) {
  const ok = await confirm({
    title: t('admin.freeleechPool.confirmRemoveWindow.title'),
    message: t('admin.freeleechPool.confirmRemoveWindow.message'),
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
  });
  if (!ok) return;
  try {
    await $fetch(`/api/admin/freeleech-pool/windows/${id}`, { method: 'DELETE' });
    await loadWindows();
  } catch (err: any) {
    notifications.error(err?.data?.message ?? t('common.error'));
  }
}

async function confirmReset() {
  const ok = await confirm({
    title: t('admin.freeleechPool.confirmReset.title'),
    message: t('admin.freeleechPool.confirmReset.message'),
    confirmText: t('admin.freeleechPool.reset'),
    cancelText: t('common.cancel'),
    danger: true,
  });
  if (!ok) return;
  resetting.value = true;
  try {
    await $fetch('/api/admin/freeleech-pool/reset', { method: 'POST' });
    notifications.success(t('admin.freeleechPool.toasts.reset'));
    await loadCycles();
  } catch (err: any) {
    notifications.error(err?.data?.message ?? t('common.error'));
  } finally {
    resetting.value = false;
  }
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    Math.max(0, Math.round(n))
  );
}

function formatDateTime(s: string): string {
  return new Date(s).toLocaleString();
}

function minutesToTime(m: number | null): string {
  if (m === null) return '—';
  const h = Math.floor(m / 60).toString().padStart(2, '0');
  const mm = (m % 60).toString().padStart(2, '0');
  return `${h}:${mm}`;
}

function describeWindow(w: Window): string {
  if (w.kind === 'oneoff') {
    if (!w.startsAt || !w.endsAt) return '—';
    return `${formatDateTime(w.startsAt)} → ${formatDateTime(w.endsAt)}`;
  }
  if (w.kind === 'weekly') {
    const labels = weekdays.value;
    const startLabel = w.weekdayStart !== null ? labels[w.weekdayStart].label : '?';
    const endLabel = w.weekdayEnd !== null ? labels[w.weekdayEnd].label : '?';
    return `${startLabel} ${minutesToTime(w.minuteStart)} → ${endLabel} ${minutesToTime(w.minuteEnd)} UTC`;
  }
  if (w.kind === 'monthly') {
    const days = (w.monthlyDays ?? []).join(', ');
    const span =
      w.minuteStart !== null && w.minuteEnd !== null
        ? ` · ${minutesToTime(w.minuteStart)} → ${minutesToTime(w.minuteEnd)} UTC`
        : '';
    return t('admin.freeleechPool.monthlyDesc', { days }) + span;
  }
  if (w.kind === 'yearly') {
    const ml = months.value;
    const startMonth = w.yearMonthStart !== null ? ml[w.yearMonthStart - 1].label : '?';
    const endMonth = w.yearMonthEnd !== null ? ml[w.yearMonthEnd - 1].label : '?';
    return `${startMonth} ${w.yearDayStart ?? '?'} → ${endMonth} ${w.yearDayEnd ?? '?'}`;
  }
  return '—';
}
</script>

<style scoped>
/* ─────────────────────────────────────────────────────────────
   Local palette — pool identity colors layered over the site's
   neutral token system (--bg-elevated, --fg-strong, etc.).
   ───────────────────────────────────────────────────────────── */
.pool {
  --gold: #d4a734;
  --gold-bright: #f0c75b;
  --gold-soft: rgba(212, 167, 52, 0.12);
  --gold-faint: rgba(212, 167, 52, 0.06);
  --cool: #7dd3fc;
  --cool-soft: rgba(125, 211, 252, 0.18);
  --success: #4ade80;
  --alert: #ef4444;

  --font-display: 'Iowan Old Style', 'Palatino Linotype', 'Palatino',
    Georgia, serif;
  --font-mono: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace,
    SFMono-Regular, Menlo, monospace;

  position: relative;
  max-width: 1240px;
  margin: 0 auto;
  padding: 3rem 1.5rem 6rem;
  color: rgb(var(--fg-default));
  isolation: isolate;
}

/* ─────────────────────────────────────────────────────────────
   Atmospheric backdrop — two soft orbs + a faint geometric grid.
   ───────────────────────────────────────────────────────────── */
.bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  overflow: hidden;
}
.bg-orb {
  position: absolute;
  width: 56vw;
  height: 56vw;
  border-radius: 50%;
  filter: blur(120px);
}
.bg-orb--gold {
  top: -18vw;
  right: -12vw;
  background: radial-gradient(
    circle,
    rgba(212, 167, 52, 0.22) 0%,
    transparent 70%
  );
}
.bg-orb--cool {
  bottom: -16vw;
  left: -18vw;
  background: radial-gradient(
    circle,
    rgba(125, 211, 252, 0.1) 0%,
    transparent 70%
  );
}
.bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(
    ellipse at center,
    black 30%,
    transparent 80%
  );
  -webkit-mask-image: radial-gradient(
    ellipse at center,
    black 30%,
    transparent 80%
  );
}

/* ─────────────────────────────────────────────────────────────
   Hero — minimal, one editorial moment via the italic "Le".
   ───────────────────────────────────────────────────────────── */
.hero {
  margin-bottom: 2.6rem;
  animation: fade-down 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
}
@keyframes fade-down {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}
.hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 1.1rem;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--gold);
}
.hero-eyebrow-rule {
  display: inline-block;
  width: 26px;
  height: 1px;
  background: currentColor;
}
.hero-title {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  margin: 0 0 1.1rem;
  font-size: clamp(2.4rem, 6vw, 4rem);
  line-height: 0.95;
  letter-spacing: -0.025em;
}
.hero-title-le {
  font-family: var(--font-display);
  font-style: italic;
  font-weight: 400;
  color: var(--gold);
  letter-spacing: 0;
}
.hero-title-name {
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.hero-intro {
  max-width: 64ch;
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.65;
  color: rgb(var(--fg-muted));
}

/* ─────────────────────────────────────────────────────────────
   Boot — when the config is loading.
   ───────────────────────────────────────────────────────────── */
.boot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.7rem;
  padding: 4rem 1rem;
  color: rgb(var(--fg-muted));
  font-family: var(--font-mono);
  font-size: 0.8rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.boot-icon {
  font-size: 1.5rem;
  color: var(--gold);
}

/* ─────────────────────────────────────────────────────────────
   Card — the base block, used for each numbered section.
   ───────────────────────────────────────────────────────────── */
.card {
  position: relative;
  margin-bottom: 1.4rem;
  background: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md, 6px);
  overflow: hidden;
  animation: fade-up 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
}
@keyframes fade-up {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
/* Hairline gold ribbon at the left edge — the single decorative
   nod that ties every card to the pool's identity color. */
.card::before {
  content: '';
  position: absolute;
  top: 28px;
  bottom: 28px;
  left: 0;
  width: 2px;
  background: linear-gradient(
    180deg,
    transparent 0%,
    var(--gold-soft) 18%,
    var(--gold) 50%,
    var(--gold-soft) 82%,
    transparent 100%
  );
  pointer-events: none;
}
.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem 1rem;
  padding: 1.5rem 1.8rem 0;
}
.card-id {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.18em;
  color: rgb(var(--fg-faint));
}
.card-title {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 600;
  letter-spacing: -0.012em;
  color: rgb(var(--fg-strong));
}
.card-help {
  flex-basis: 100%;
  margin: 0.4rem 0 0;
  font-size: 0.88rem;
  line-height: 1.6;
  color: rgb(var(--fg-muted));
  max-width: 78ch;
}
.card-body {
  padding: 1.5rem 1.8rem 1.8rem;
}
.card-body--flush {
  padding: 0;
}

/* ─────────────────────────────────────────────────────────────
   Empty state — used by reservoir / windows / ledger.
   ───────────────────────────────────────────────────────────── */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.7rem;
  padding: 3rem 1rem;
  color: rgb(var(--fg-muted));
  font-size: 0.92rem;
}
.empty p { margin: 0; }
.empty-icon {
  font-size: 2.4rem;
  color: var(--gold);
  opacity: 0.55;
}
.empty--inline {
  flex-direction: row;
  justify-content: flex-start;
  padding: 1.2rem;
  gap: 0.5rem;
  border: 1px dashed rgb(var(--line-default));
  font-size: 0.85rem;
}
.empty--inline .empty-icon { font-size: 1.2rem; }

/* ─────────────────────────────────────────────────────────────
   01 · Reservoir
   ───────────────────────────────────────────────────────────── */
.reservoir {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(280px, 1fr);
  grid-template-areas:
    'gauge readouts'
    'patrons patrons'
    'reset reset';
  gap: 1.2rem;
}
@media (max-width: 760px) {
  .reservoir {
    grid-template-columns: 1fr;
    grid-template-areas:
      'gauge'
      'readouts'
      'patrons'
      'reset';
  }
}

/* Gauge — SVG semicircle. */
.gauge-wrap {
  grid-area: gauge;
  position: relative;
  padding: 1.4rem 1.4rem 1rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm, 4px);
  overflow: hidden;
}
.gauge {
  display: block;
  width: 100%;
  height: auto;
}
.gauge-center {
  position: absolute;
  left: 50%;
  bottom: 1.4rem;
  transform: translateX(-50%);
  text-align: center;
}
.gauge-num {
  display: block;
  font-size: 2.2rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: rgb(var(--fg-strong));
  line-height: 1;
}
.gauge-pct {
  font-size: 0.5em;
  font-weight: 500;
  color: var(--gold);
  margin-left: 0.1em;
}
.gauge-label {
  display: block;
  margin-top: 0.45rem;
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}

/* Readouts panel — 2×2 metric grid. */
.readouts {
  grid-area: readouts;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  margin: 0;
  padding: 1px;
  background: rgb(var(--line-default));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm, 4px);
  overflow: hidden;
}
.readout {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.95rem 1.1rem;
  margin: 0;
  background: rgb(var(--bg-elevated));
}
.readout dt {
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}
.readout dd {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
.readout-big {
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--gold);
  letter-spacing: -0.01em;
}
.readout-of {
  font-size: 0.82rem;
  font-weight: 500;
  color: rgb(var(--fg-muted));
}

/* Status dot — small animated indicator. */
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgb(var(--fg-faint));
  flex-shrink: 0;
}
.status-dot--filling {
  background: var(--gold);
  box-shadow: 0 0 8px rgba(212, 167, 52, 0.6);
  animation: dot-pulse 2.4s ease-in-out infinite;
}
.status-dot--full_queued {
  background: var(--cool);
  box-shadow: 0 0 8px rgba(125, 211, 252, 0.6);
  animation: dot-pulse 1.6s ease-in-out infinite;
}
.status-dot--active {
  background: var(--success);
  box-shadow: 0 0 10px rgba(74, 222, 128, 0.65);
  animation: dot-pulse 1.1s ease-in-out infinite;
}
@keyframes dot-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

/* Patrons — leaderboard card. */
.patrons {
  grid-area: patrons;
  padding: 1.2rem 1.4rem 1.3rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-left: 2px solid var(--gold);
  border-radius: var(--radius-sm, 4px);
}
.patrons-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.95rem;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--gold);
}
.patrons-head > svg,
.patrons-head > .iconify {
  font-size: 0.95rem;
}
.patrons-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.patron {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: baseline;
  gap: 0.8rem;
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius-sm, 4px);
  transition: background 0.18s ease;
}
.patron:hover { background: rgba(255, 255, 255, 0.025); }
.patron-rank {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: rgb(var(--fg-faint));
}
.patron-name {
  font-size: 0.95rem;
  font-weight: 500;
  color: rgb(var(--fg-strong));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.patron-amount {
  font-family: var(--font-mono);
  font-size: 0.88rem;
  font-weight: 600;
  color: rgb(var(--fg-muted));
}
/* Lead patron gets a subtle gold wash + brighter text. */
.patron--lead {
  background: var(--gold-soft);
}
.patron--lead .patron-rank { color: var(--gold-bright); }
.patron--lead .patron-name { color: var(--gold-bright); font-weight: 600; }
.patron--lead .patron-amount { color: var(--gold); font-weight: 700; }

.reservoir-reset {
  grid-area: reset;
  justify-self: start;
}

/* ─────────────────────────────────────────────────────────────
   02 · Calibration
   ───────────────────────────────────────────────────────────── */

/* Modern toggle switch — pill with a sliding thumb. */
.switch {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1.1rem;
  align-items: start;
  margin-bottom: 1.6rem;
  padding: 1.1rem 1.3rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  transition: border-color 0.18s ease;
}
.switch:hover { border-color: rgb(var(--line-strong)); }
.switch-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.switch-track {
  position: relative;
  width: 50px;
  height: 28px;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 14px;
  margin-top: 2px;
  transition: background 0.25s ease, border-color 0.25s ease;
}
.switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgb(var(--fg-faint));
  transition: all 0.3s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.switch-input:checked ~ .switch-track {
  background: var(--gold-soft);
  border-color: var(--gold);
}
.switch-input:checked ~ .switch-track .switch-thumb {
  left: 25px;
  background: var(--gold);
  box-shadow: 0 0 12px rgba(212, 167, 52, 0.55);
}
.switch-copy {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.switch-state {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  transition: color 0.2s ease;
}
.switch-state--on { color: var(--gold); }
.switch-hint {
  font-size: 0.85rem;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
}

/* Calibration grid. */
.cal-grid,
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}
@media (min-width: 760px) {
  .form-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
@media (max-width: 540px) {
  .cal-grid {
    grid-template-columns: 1fr;
  }
}

/* Fields — label + input + optional hint. */
.field {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.field--xl,
.field--wide {
  grid-column: span 2;
}
.field--full {
  grid-column: 1 / -1;
}
@media (min-width: 760px) {
  .form-grid .field--wide {
    grid-column: span 4;
  }
}
@media (max-width: 540px) {
  .field--xl,
  .field--wide {
    grid-column: span 1;
  }
}
.field-label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.field-hint {
  font-size: 0.78rem;
  line-height: 1.5;
  color: rgb(var(--fg-faint));
}
.field-input {
  display: flex;
}

/* Unified input style. */
.input {
  width: 100%;
  padding: 0.65rem 0.85rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-sm, 4px);
  color: rgb(var(--fg-default));
  font-family: var(--font-mono);
  font-size: 0.92rem;
  font-weight: 500;
  outline: 0;
  transition: border-color 0.18s ease, box-shadow 0.18s ease,
    background-color 0.18s ease;
}
.input::placeholder {
  color: rgb(var(--fg-faint));
}
.input:hover {
  border-color: rgb(var(--fg-faint));
}
.input:focus {
  border-color: var(--gold);
  box-shadow: 0 0 0 3px rgba(212, 167, 52, 0.18);
}
.input--xl {
  padding: 0.85rem 1rem;
  font-size: 1.7rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.textarea {
  resize: vertical;
  min-height: 80px;
  font-family: var(--font-display);
  font-size: 0.95rem;
  font-weight: 400;
  font-style: italic;
  line-height: 1.55;
}

/* Field with a unit suffix — connect input and unit visually. */
.field-input--unit .input {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border-right: 0;
}
.field-input--unit:focus-within .input {
  box-shadow: 0 0 0 3px rgba(212, 167, 52, 0.18);
}
.unit {
  display: inline-flex;
  align-items: center;
  padding: 0 0.95rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-top-right-radius: var(--radius-sm, 4px);
  border-bottom-right-radius: var(--radius-sm, 4px);
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.field-input--unit:focus-within .unit {
  border-color: var(--gold);
}

/* Custom select arrow — keeps the input from looking like text. */
select.input {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 2.4rem;
  cursor: pointer;
  background-image:
    linear-gradient(45deg, transparent 50%, rgb(var(--fg-muted)) 50%),
    linear-gradient(-45deg, transparent 50%, rgb(var(--fg-muted)) 50%);
  background-position:
    calc(100% - 18px) 50%,
    calc(100% - 13px) 50%;
  background-size: 6px 6px;
  background-repeat: no-repeat;
}
select.input option {
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
}

/* Footer actions row. */
.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 1.5rem;
  padding-top: 1.4rem;
  border-top: 1px solid rgb(var(--line-default));
}

/* Button system. */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.7rem 1.2rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-sm, 4px);
  color: rgb(var(--fg-default));
  font-size: 0.88rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: all 0.18s ease;
}
.btn:hover:not(:disabled) {
  border-color: rgb(var(--fg-faint));
  background: rgb(var(--bg-hover));
}
.btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}
.btn--primary {
  background: var(--gold);
  border-color: var(--gold);
  color: rgb(var(--bg-base));
  font-weight: 700;
}
.btn--primary:hover:not(:disabled) {
  background: var(--gold-bright);
  border-color: var(--gold-bright);
  box-shadow: 0 6px 22px -8px rgba(212, 167, 52, 0.55);
  transform: translateY(-1px);
}
.btn--primary:active:not(:disabled) {
  transform: translateY(0);
}
.btn--danger {
  background: transparent;
  border-color: rgba(239, 68, 68, 0.4);
  color: var(--alert);
}
.btn--danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.08);
  border-color: var(--alert);
  box-shadow: 0 0 20px rgba(239, 68, 68, 0.2);
}
.btn--sm {
  padding: 0.55rem 0.95rem;
  font-size: 0.82rem;
}

/* ─────────────────────────────────────────────────────────────
   03 · Schedule
   ───────────────────────────────────────────────────────────── */
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  margin-bottom: 1.6rem;
  border-bottom: 1px solid rgb(var(--line-default));
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem 1.05rem;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  color: rgb(var(--fg-muted));
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.18s ease, border-color 0.22s ease;
}
.tab:hover {
  color: rgb(var(--fg-strong));
}
.tab--on {
  color: var(--gold);
  border-bottom-color: var(--gold);
}
.tab-icon { font-size: 1rem; }

.tab-body {
  animation: tab-slide 0.32s cubic-bezier(0.2, 0.7, 0.2, 1);
}
@keyframes tab-slide {
  from { opacity: 0; transform: translateX(-6px); }
  to { opacity: 1; transform: translateX(0); }
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: flex-start;
}
.form-hint {
  margin: 0;
  font-size: 0.82rem;
  font-style: italic;
  color: rgb(var(--fg-muted));
}

/* Day-of-month chip grid. */
.day-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.35rem;
  margin-top: 0.3rem;
}
.day-chip {
  padding: 0.55rem 0;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm, 4px);
  color: rgb(var(--fg-muted));
  font-family: var(--font-mono);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}
.day-chip:hover:not(.day-chip--on) {
  border-color: rgb(var(--fg-faint));
  color: rgb(var(--fg-strong));
}
.day-chip--on {
  background: var(--gold);
  border-color: var(--gold);
  color: rgb(var(--bg-base));
  box-shadow: 0 0 14px rgba(212, 167, 52, 0.35);
}

/* Deployed list. */
.deployed {
  margin-top: 2rem;
  padding-top: 1.4rem;
  border-top: 1px solid rgb(var(--line-default));
}
.deployed-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.9rem;
}
.deployed-title {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.deployed-count {
  padding: 0.15rem 0.55rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm, 4px);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
.deployed-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.window {
  display: grid;
  grid-template-columns: auto auto 1fr auto auto auto;
  align-items: center;
  gap: 0.7rem;
  padding: 0.6rem 0.95rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm, 4px);
  transition: border-color 0.2s ease;
}
.window:hover {
  border-color: rgb(var(--line-strong));
}
.window-pip {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 8px rgba(74, 222, 128, 0.45);
}
.window-pip--off {
  background: rgb(var(--fg-faint));
  box-shadow: none;
}
.window-kind {
  padding: 0.2rem 0.55rem;
  border: 1px solid currentColor;
  border-radius: var(--radius-sm, 4px);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.window-kind--oneoff { color: var(--cool); }
.window-kind--weekly { color: var(--gold); }
.window-kind--monthly { color: #6cd2f0; }
.window-kind--yearly { color: #c896f0; }
.window-desc {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: rgb(var(--fg-strong));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.window-label {
  font-size: 0.8rem;
  font-style: italic;
  color: rgb(var(--fg-muted));
}
.window-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  cursor: pointer;
}
.window-toggle input[type='checkbox'] {
  accent-color: var(--gold);
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm, 4px);
  color: rgb(var(--fg-muted));
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.16s ease;
}
.icon-btn:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--bg-hover));
}
.icon-btn--danger:hover {
  color: var(--alert);
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.3);
}

/* ─────────────────────────────────────────────────────────────
   04 · Ledger
   ───────────────────────────────────────────────────────────── */
.ledger-wrap {
  overflow-x: auto;
}
.ledger {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.ledger th {
  text-align: left;
  padding: 0.85rem 1.2rem;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
  border-bottom: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
}
.ledger td {
  padding: 0.85rem 1.2rem;
  border-bottom: 1px solid rgb(var(--line-default));
  color: rgb(var(--fg-default));
}
.ledger tbody tr {
  transition: background 0.16s ease;
}
.ledger tbody tr:hover td {
  background: rgb(var(--bg-elevated));
}
.ledger .right { text-align: right; }
.ledger .muted { color: rgb(var(--fg-muted)); }
.folio {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: rgb(var(--fg-faint));
}

.pill {
  display: inline-flex;
  padding: 0.2rem 0.6rem;
  border: 1px solid currentColor;
  border-radius: var(--radius-sm, 4px);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.pill--filling { color: var(--gold); }
.pill--full_queued { color: var(--cool); }
.pill--active { color: var(--success); }
.pill--ended { color: rgb(var(--fg-muted)); }
.pill--cancelled { color: var(--alert); }

/* ─────────────────────────────────────────────────────────────
   Utilities
   ───────────────────────────────────────────────────────────── */
.tabular-nums {
  font-variant-numeric: tabular-nums;
}
.spin {
  animation: pool-spin 1s linear infinite;
}
@keyframes pool-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

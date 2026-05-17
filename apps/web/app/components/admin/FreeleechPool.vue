<template>
  <!--
    /admin/freeleech-pool — Salle de contrôle.

    Aesthetic register: a 1950s hydraulic-cistern control panel
    repurposed as the operator surface for the community freeleech
    pool. The "pool" metaphor is taken literally — the page reads as
    pressure gauges, brass plaques, stencilled sector labels, and a
    bound register for the cycle history.

    Palette: deep teal-navy (the water) + brass family (the
    instrumentation) + parchment cream (engraved labels) + a single
    alert red for danger states. The aesthetic deliberately diverges
    from /admin/bonus-events (broadcast tower) and /shop (curiosity
    cabinet) so each operator surface has a clear identity.

    Sectors:
      A — Reservoir status (gauge + readouts + reset)
      B — Calibration (config form on brass plaques)
      C — Schedule (tabbed window forms + deployed floodgates list)
      D — Ledger (bound-book history of past cycles)
  -->
  <div class="cistern">
    <!-- ── Atmospheric backdrop ──────────────────────────── -->
    <div class="bg" aria-hidden="true">
      <div class="bg-mesh" />
      <div class="bg-topo" />
      <div class="bg-grain" />
      <div class="bg-vignette" />
    </div>

    <!-- ── Hero ──────────────────────────────────────────── -->
    <header class="hero">
      <div class="hero-stamp">
        <span class="hero-stamp-no">PANEL · 04</span>
        <span class="hero-stamp-rule" aria-hidden="true" />
        <span class="hero-stamp-cls">
          {{ $t('admin.freeleechPool.cistern.classification') }}
        </span>
      </div>
      <h1 class="hero-title">
        <span class="hero-title-stencil" :data-text="title">{{ title }}</span>
      </h1>
      <p class="hero-intro">{{ $t('admin.freeleechPool.intro') }}</p>

      <!-- Rivets row separating hero from sectors. -->
      <div class="hero-rivets" aria-hidden="true">
        <span v-for="i in 24" :key="i" class="rivet" />
      </div>
    </header>

    <!-- ── Loading boot screen ───────────────────────────── -->
    <div v-if="loadingConfig" class="boot">
      <Icon name="ph:gauge-bold" class="boot-icon spin" />
      <span class="boot-copy">{{ $t('admin.freeleechPool.cistern.connecting') }}</span>
    </div>

    <template v-else-if="config">
      <!-- ────────────────────────────────────────────────────
           SECTOR A — Reservoir status
           ──────────────────────────────────────────────────── -->
      <section class="sector sector--a" :style="{ '--stagger': '0ms' }">
        <header class="sector-head">
          <span class="sector-tag">SECTOR&nbsp;A</span>
          <h2 class="sector-title">{{ $t('admin.freeleechPool.cistern.reservoir') }}</h2>
        </header>

        <div v-if="!currentCycle" class="reservoir-empty">
          <Icon name="ph:drop-half" class="reservoir-empty-icon" />
          <p class="reservoir-empty-copy">{{ $t('admin.freeleechPool.noCycle') }}</p>
        </div>

        <div v-else class="reservoir">
          <!-- Gauge -->
          <div class="gauge">
            <div class="gauge-frame">
              <span class="gauge-corner gauge-corner--tl" aria-hidden="true" />
              <span class="gauge-corner gauge-corner--tr" aria-hidden="true" />
              <span class="gauge-corner gauge-corner--bl" aria-hidden="true" />
              <span class="gauge-corner gauge-corner--br" aria-hidden="true" />

              <div class="gauge-dial">
                <div
                  class="gauge-arc"
                  :style="{ '--arc-pct': `${progressPct / 2}%` }"
                />
                <div class="gauge-ticks" aria-hidden="true">
                  <span
                    v-for="i in 11"
                    :key="i"
                    class="gauge-tick"
                    :class="{ 'gauge-tick--major': (i - 1) % 5 === 0 }"
                    :style="{ '--i': i - 1 }"
                  />
                </div>
                <div
                  class="gauge-needle"
                  :style="{ '--angle': `${progressAngle}deg` }"
                  aria-hidden="true"
                >
                  <span class="gauge-needle-tip" />
                </div>
                <div class="gauge-pivot" aria-hidden="true">
                  <span class="gauge-pivot-screw" />
                </div>
              </div>

            </div>
            <!-- Readout flows below the dial inside the same frame
                 so it never crashes into the plaque underneath. -->
            <div class="gauge-readout">
              <span class="gauge-readout-rule gauge-readout-rule--l" aria-hidden="true" />
              <span class="gauge-readout-num tabular-nums">
                {{ Math.round(progressPct) }}<span class="gauge-readout-pct">%</span>
              </span>
              <span class="gauge-readout-rule gauge-readout-rule--r" aria-hidden="true" />
              <span class="gauge-readout-label">
                {{ $t('admin.freeleechPool.cistern.fillLevel') }}
              </span>
            </div>
          </div>

          <!-- Readouts panel -->
          <div class="readouts">
            <header class="readouts-head">
              <span class="readouts-screw" aria-hidden="true" />
              <span class="readouts-title">INSTRUMENTATION</span>
              <span class="readouts-screw" aria-hidden="true" />
            </header>
            <dl class="readouts-grid">
              <div class="readout">
                <dt class="readout-tag">STATUS</dt>
                <dd class="readout-value">
                  <span class="status-led" :class="`status-led--${currentCycle.status}`" aria-hidden="true" />
                  {{ $t(`admin.freeleechPool.cycleStatus.${currentCycle.status}`) }}
                </dd>
              </div>
              <div class="readout">
                <dt class="readout-tag">LEVEL</dt>
                <dd class="readout-value">
                  <span class="readout-big tabular-nums">{{ formatNumber(currentCycle.totalContributed) }}</span>
                  <span class="readout-of tabular-nums">
                    / {{ formatNumber(currentCycle.targetSnapshot) }}
                  </span>
                </dd>
              </div>
              <div class="readout">
                <dt class="readout-tag">DURATION</dt>
                <dd class="readout-value tabular-nums">
                  {{ currentCycle.durationDaysSnapshot }}d
                </dd>
              </div>
              <div v-if="currentCycle.endsAt" class="readout">
                <dt class="readout-tag">DRAIN AT</dt>
                <dd class="readout-value tabular-nums">
                  {{ formatDateTime(currentCycle.endsAt) }}
                </dd>
              </div>
            </dl>
          </div>

          <!-- Patrons brass plaque -->
          <div v-if="currentTop.length > 0" class="plaque">
            <span class="plaque-corner plaque-corner--tl" aria-hidden="true" />
            <span class="plaque-corner plaque-corner--tr" aria-hidden="true" />
            <span class="plaque-corner plaque-corner--bl" aria-hidden="true" />
            <span class="plaque-corner plaque-corner--br" aria-hidden="true" />

            <header class="plaque-head">
              <span class="plaque-rule" aria-hidden="true" />
              <span class="plaque-title">
                {{ $t('admin.freeleechPool.topPatrons') }}
              </span>
              <span class="plaque-rule" aria-hidden="true" />
            </header>
            <ol class="plaque-list">
              <li v-for="(p, i) in currentTop" :key="p.userId" class="plaque-row">
                <span class="plaque-rank tabular-nums">
                  N°{{ String(i + 1).padStart(2, '0') }}
                </span>
                <span class="plaque-name">{{ p.username }}</span>
                <span class="plaque-dotline" aria-hidden="true" />
                <span class="plaque-amount tabular-nums">{{ formatNumber(p.total) }}</span>
              </li>
            </ol>
          </div>

          <!-- Emergency drain (reset) -->
          <button
            type="button"
            class="drain-btn"
            :disabled="resetting"
            @click="confirmReset"
          >
            <span class="drain-btn-bezel" aria-hidden="true" />
            <Icon
              :name="resetting ? 'ph:circle-notch' : 'ph:warning-octagon-fill'"
              :class="resetting ? 'spin' : ''"
              class="drain-btn-icon"
            />
            <span class="drain-btn-label">{{ $t('admin.freeleechPool.reset') }}</span>
          </button>
        </div>
      </section>

      <!-- ────────────────────────────────────────────────────
           SECTOR B — Calibration
           ──────────────────────────────────────────────────── -->
      <section class="sector sector--b" :style="{ '--stagger': '90ms' }">
        <header class="sector-head">
          <span class="sector-tag">SECTOR&nbsp;B</span>
          <h2 class="sector-title">{{ $t('admin.freeleechPool.cistern.calibration') }}</h2>
          <p class="sector-help">{{ $t('admin.freeleechPool.configHelp') }}</p>
        </header>

        <!-- Master arm switch — visually dominant. -->
        <div class="arm">
          <button
            type="button"
            class="arm-switch"
            :class="{ 'arm-switch--on': config.enabled }"
            :aria-pressed="config.enabled"
            @click="config.enabled = !config.enabled"
          >
            <span class="arm-switch-frame" aria-hidden="true" />
            <span class="arm-switch-led" />
            <span class="arm-switch-knob" aria-hidden="true">
              <span class="arm-switch-knob-handle" />
            </span>
            <span class="arm-switch-state">
              {{
                config.enabled
                  ? $t('admin.freeleechPool.cistern.armed')
                  : $t('admin.freeleechPool.cistern.offline')
              }}
            </span>
          </button>
          <div class="arm-copy">
            <span class="arm-label">MASTER SUPPLY</span>
            <p class="arm-hint">{{ $t('admin.freeleechPool.cistern.armedHint') }}</p>
          </div>
        </div>

        <!-- Calibration grid -->
        <div class="cal-grid">
          <div class="cal-card cal-card--big">
            <span class="cal-card-pin" aria-hidden="true" />
            <span class="cal-card-pin cal-card-pin--right" aria-hidden="true" />
            <span class="cal-card-label">
              {{ $t('admin.freeleechPool.fields.target') }}
            </span>
            <span class="cal-card-meter">
              <input
                v-model.number="config.pointsTarget"
                type="number"
                min="0"
                class="cal-input cal-input--xl"
              >
              <span class="cal-input-unit">PTS</span>
            </span>
          </div>

          <div class="cal-card">
            <span class="cal-card-pin" aria-hidden="true" />
            <span class="cal-card-label">
              {{ $t('admin.freeleechPool.fields.durationDays') }}
            </span>
            <span class="cal-card-meter">
              <input
                v-model.number="config.freeleechDurationDays"
                type="number"
                min="1"
                max="30"
                class="cal-input"
              >
              <span class="cal-input-unit">DAY</span>
            </span>
          </div>

          <div class="cal-card">
            <span class="cal-card-pin" aria-hidden="true" />
            <span class="cal-card-label">
              {{ $t('admin.freeleechPool.fields.contributionMin') }}
            </span>
            <span class="cal-card-meter">
              <input
                v-model.number="config.contributionMin"
                type="number"
                min="1"
                class="cal-input"
              >
              <span class="cal-input-unit">PTS</span>
            </span>
          </div>

          <div class="cal-card">
            <span class="cal-card-pin" aria-hidden="true" />
            <span class="cal-card-label">
              {{ $t('admin.freeleechPool.fields.maxPerUserPct') }}
            </span>
            <span class="cal-card-meter">
              <input
                v-model.number="maxPerUserPct"
                type="number"
                min="0"
                max="100"
                step="0.01"
                class="cal-input"
              >
              <span class="cal-input-unit">%</span>
            </span>
            <span class="cal-card-hint">{{ $t('admin.freeleechPool.fields.maxPerUserHint') }}</span>
          </div>

          <div class="cal-card cal-card--wide">
            <span class="cal-card-pin" aria-hidden="true" />
            <span class="cal-card-pin cal-card-pin--right" aria-hidden="true" />
            <span class="cal-card-label">
              {{ $t('admin.freeleechPool.fields.presetAmounts') }}
            </span>
            <input
              v-model="presetAmountsInput"
              type="text"
              :placeholder="$t('admin.freeleechPool.fields.presetAmountsPlaceholder')"
              class="cal-input cal-input--text"
            >
            <span class="cal-card-hint">{{ $t('admin.freeleechPool.fields.presetAmountsHint') }}</span>
          </div>

          <div class="cal-card cal-card--wide">
            <span class="cal-card-pin" aria-hidden="true" />
            <span class="cal-card-pin cal-card-pin--right" aria-hidden="true" />
            <span class="cal-card-label">
              {{ $t('admin.freeleechPool.fields.eventTitle') }}
            </span>
            <input
              v-model="config.eventTitleTemplate"
              type="text"
              maxlength="120"
              class="cal-input cal-input--text"
            >
          </div>

          <div class="cal-card cal-card--wide">
            <span class="cal-card-pin" aria-hidden="true" />
            <span class="cal-card-pin cal-card-pin--right" aria-hidden="true" />
            <span class="cal-card-label">
              {{ $t('admin.freeleechPool.fields.eventDescription') }}
            </span>
            <textarea
              v-model="config.eventDescriptionTemplate"
              rows="2"
              maxlength="500"
              class="cal-input cal-textarea"
            />
          </div>
        </div>

        <footer class="cal-foot">
          <button
            type="button"
            class="brass-btn"
            :disabled="savingConfig"
            @click="saveConfig"
          >
            <span class="brass-btn-bezel" aria-hidden="true" />
            <Icon
              :name="savingConfig ? 'ph:circle-notch' : 'ph:wrench-fill'"
              :class="savingConfig ? 'spin' : ''"
              class="brass-btn-icon"
            />
            <span class="brass-btn-label">{{ $t('common.save') }}</span>
          </button>
        </footer>
      </section>

      <!-- ────────────────────────────────────────────────────
           SECTOR C — Schedule (floodgate timetable)
           ──────────────────────────────────────────────────── -->
      <section class="sector sector--c" :style="{ '--stagger': '180ms' }">
        <header class="sector-head">
          <span class="sector-tag">SECTOR&nbsp;C</span>
          <h2 class="sector-title">{{ $t('admin.freeleechPool.cistern.schedule') }}</h2>
          <p class="sector-help">{{ $t('admin.freeleechPool.windowsHelp') }}</p>
        </header>

        <!-- Tab strip -->
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

        <!-- Active tab form -->
        <div class="tab-body">
          <!-- ─── One-off ─── -->
          <div v-if="scheduleTab === 'oneoff'" class="sched-form">
            <div class="sched-grid">
              <label class="cal-card">
                <span class="cal-card-pin" aria-hidden="true" />
                <span class="cal-card-label">{{ $t('admin.freeleechPool.fields.from') }}</span>
                <input v-model="newOneoff.startsAt" type="datetime-local" class="cal-input cal-input--text">
              </label>
              <label class="cal-card">
                <span class="cal-card-pin" aria-hidden="true" />
                <span class="cal-card-label">{{ $t('admin.freeleechPool.fields.to') }}</span>
                <input v-model="newOneoff.endsAt" type="datetime-local" class="cal-input cal-input--text">
              </label>
              <label class="cal-card cal-card--wide">
                <span class="cal-card-pin" aria-hidden="true" />
                <span class="cal-card-label">{{ $t('admin.freeleechPool.fields.label') }}</span>
                <input v-model="newOneoff.label" type="text" maxlength="60" class="cal-input cal-input--text">
              </label>
            </div>
            <button type="button" class="brass-btn brass-btn--sm" :disabled="!validOneoff" @click="addOneoff">
              <span class="brass-btn-bezel" aria-hidden="true" />
              <Icon name="ph:plus-bold" class="brass-btn-icon" />
              <span class="brass-btn-label">{{ $t('admin.freeleechPool.add') }}</span>
            </button>
          </div>

          <!-- ─── Weekly ─── -->
          <div v-else-if="scheduleTab === 'weekly'" class="sched-form">
            <div class="sched-grid">
              <label class="cal-card">
                <span class="cal-card-pin" aria-hidden="true" />
                <span class="cal-card-label">{{ $t('admin.freeleechPool.fields.fromDay') }}</span>
                <select v-model.number="newWeekly.weekdayStart" class="cal-input cal-input--text">
                  <option v-for="d in weekdays" :key="`s-${d.value}`" :value="d.value">{{ d.label }}</option>
                </select>
              </label>
              <label class="cal-card">
                <span class="cal-card-pin" aria-hidden="true" />
                <span class="cal-card-label">{{ $t('admin.freeleechPool.fields.fromTime') }}</span>
                <input v-model="newWeekly.timeStart" type="time" class="cal-input cal-input--text">
              </label>
              <label class="cal-card">
                <span class="cal-card-pin" aria-hidden="true" />
                <span class="cal-card-label">{{ $t('admin.freeleechPool.fields.toDay') }}</span>
                <select v-model.number="newWeekly.weekdayEnd" class="cal-input cal-input--text">
                  <option v-for="d in weekdays" :key="`e-${d.value}`" :value="d.value">{{ d.label }}</option>
                </select>
              </label>
              <label class="cal-card">
                <span class="cal-card-pin" aria-hidden="true" />
                <span class="cal-card-label">{{ $t('admin.freeleechPool.fields.toTime') }}</span>
                <input v-model="newWeekly.timeEnd" type="time" class="cal-input cal-input--text">
              </label>
              <label class="cal-card cal-card--wide">
                <span class="cal-card-pin" aria-hidden="true" />
                <span class="cal-card-label">{{ $t('admin.freeleechPool.fields.label') }}</span>
                <input v-model="newWeekly.label" type="text" maxlength="60" class="cal-input cal-input--text">
              </label>
            </div>
            <p class="sched-hint">{{ $t('admin.freeleechPool.fields.utcHint') }}</p>
            <button type="button" class="brass-btn brass-btn--sm" :disabled="!validWeekly" @click="addWeekly">
              <span class="brass-btn-bezel" aria-hidden="true" />
              <Icon name="ph:plus-bold" class="brass-btn-icon" />
              <span class="brass-btn-label">{{ $t('admin.freeleechPool.add') }}</span>
            </button>
          </div>

          <!-- ─── Monthly ─── -->
          <div v-else-if="scheduleTab === 'monthly'" class="sched-form">
            <div class="cal-card cal-card--full">
              <span class="cal-card-pin" aria-hidden="true" />
              <span class="cal-card-pin cal-card-pin--right" aria-hidden="true" />
              <span class="cal-card-label">{{ $t('admin.freeleechPool.fields.daysOfMonth') }}</span>
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
              <span class="cal-card-hint">{{ $t('admin.freeleechPool.fields.daysOfMonthHint') }}</span>
            </div>
            <div class="sched-grid">
              <label class="cal-card">
                <span class="cal-card-pin" aria-hidden="true" />
                <span class="cal-card-label">{{ $t('admin.freeleechPool.fields.fromTime') }}</span>
                <input v-model="newMonthly.timeStart" type="time" class="cal-input cal-input--text">
              </label>
              <label class="cal-card">
                <span class="cal-card-pin" aria-hidden="true" />
                <span class="cal-card-label">{{ $t('admin.freeleechPool.fields.toTime') }}</span>
                <input v-model="newMonthly.timeEnd" type="time" class="cal-input cal-input--text">
              </label>
              <label class="cal-card cal-card--wide">
                <span class="cal-card-pin" aria-hidden="true" />
                <span class="cal-card-label">{{ $t('admin.freeleechPool.fields.label') }}</span>
                <input v-model="newMonthly.label" type="text" maxlength="60" class="cal-input cal-input--text">
              </label>
            </div>
            <p class="sched-hint">{{ $t('admin.freeleechPool.fields.utcHint') }}</p>
            <button type="button" class="brass-btn brass-btn--sm" :disabled="!validMonthly" @click="addMonthly">
              <span class="brass-btn-bezel" aria-hidden="true" />
              <Icon name="ph:plus-bold" class="brass-btn-icon" />
              <span class="brass-btn-label">{{ $t('admin.freeleechPool.add') }}</span>
            </button>
          </div>

          <!-- ─── Yearly ─── -->
          <div v-else-if="scheduleTab === 'yearly'" class="sched-form">
            <div class="sched-grid">
              <label class="cal-card">
                <span class="cal-card-pin" aria-hidden="true" />
                <span class="cal-card-label">{{ $t('admin.freeleechPool.fields.fromMonth') }}</span>
                <select v-model.number="newYearly.monthStart" class="cal-input cal-input--text">
                  <option v-for="m in months" :key="`ms-${m.value}`" :value="m.value">{{ m.label }}</option>
                </select>
              </label>
              <label class="cal-card">
                <span class="cal-card-pin" aria-hidden="true" />
                <span class="cal-card-label">{{ $t('admin.freeleechPool.fields.fromDayOfMonth') }}</span>
                <input v-model.number="newYearly.dayStart" type="number" min="1" max="31" class="cal-input">
              </label>
              <label class="cal-card">
                <span class="cal-card-pin" aria-hidden="true" />
                <span class="cal-card-label">{{ $t('admin.freeleechPool.fields.toMonth') }}</span>
                <select v-model.number="newYearly.monthEnd" class="cal-input cal-input--text">
                  <option v-for="m in months" :key="`me-${m.value}`" :value="m.value">{{ m.label }}</option>
                </select>
              </label>
              <label class="cal-card">
                <span class="cal-card-pin" aria-hidden="true" />
                <span class="cal-card-label">{{ $t('admin.freeleechPool.fields.toDayOfMonth') }}</span>
                <input v-model.number="newYearly.dayEnd" type="number" min="1" max="31" class="cal-input">
              </label>
              <label class="cal-card cal-card--wide">
                <span class="cal-card-pin" aria-hidden="true" />
                <span class="cal-card-label">{{ $t('admin.freeleechPool.fields.label') }}</span>
                <input v-model="newYearly.label" type="text" maxlength="60" class="cal-input cal-input--text">
              </label>
            </div>
            <p class="sched-hint">{{ $t('admin.freeleechPool.fields.yearlyHint') }}</p>
            <button type="button" class="brass-btn brass-btn--sm" :disabled="!validYearly" @click="addYearly">
              <span class="brass-btn-bezel" aria-hidden="true" />
              <Icon name="ph:plus-bold" class="brass-btn-icon" />
              <span class="brass-btn-label">{{ $t('admin.freeleechPool.add') }}</span>
            </button>
          </div>
        </div>

        <!-- Deployed floodgates -->
        <div class="floodgates">
          <header class="floodgates-head">
            <span class="floodgates-rule" aria-hidden="true" />
            <span class="floodgates-title">
              {{ $t('admin.freeleechPool.cistern.deployed') }}
            </span>
            <span class="floodgates-count tabular-nums">
              {{ windows.length }}
            </span>
            <span class="floodgates-rule" aria-hidden="true" />
          </header>

          <div v-if="windows.length === 0" class="floodgates-empty">
            <Icon name="ph:circuitry" class="floodgates-empty-icon" />
            <span>{{ $t('admin.freeleechPool.windowsEmpty') }}</span>
          </div>

          <ul v-else class="floodgates-list">
            <li v-for="w in windows" :key="w.id" class="floodgate">
              <span class="floodgate-pip" :class="{ 'floodgate-pip--off': !w.enabled }" aria-hidden="true" />
              <span class="floodgate-kind" :class="`floodgate-kind--${w.kind}`">
                {{ $t(`admin.freeleechPool.kind.${w.kind}`) }}
              </span>
              <span class="floodgate-desc">{{ describeWindow(w) }}</span>
              <span v-if="w.label" class="floodgate-label">{{ w.label }}</span>
              <label class="floodgate-toggle">
                <input type="checkbox" :checked="w.enabled" @change="toggleWindow(w)">
                <span>{{ w.enabled ? $t('common.enabled') : $t('common.disabled') }}</span>
              </label>
              <button
                type="button"
                class="floodgate-remove"
                :aria-label="$t('common.delete')"
                @click="removeWindow(w.id)"
              >
                <Icon name="ph:trash" />
              </button>
            </li>
          </ul>
        </div>
      </section>

      <!-- ────────────────────────────────────────────────────
           SECTOR D — Ledger
           ──────────────────────────────────────────────────── -->
      <section class="sector sector--d" :style="{ '--stagger': '270ms' }">
        <header class="sector-head">
          <span class="sector-tag">SECTOR&nbsp;D</span>
          <h2 class="sector-title">{{ $t('admin.freeleechPool.cistern.ledger') }}</h2>
        </header>

        <div class="ledger">
          <span class="ledger-bind ledger-bind--top" aria-hidden="true" />
          <span class="ledger-bind ledger-bind--bottom" aria-hidden="true" />
          <div class="ledger-page">
            <div v-if="loadingCycles" class="ledger-loading">
              <Icon name="ph:circle-notch" class="spin" />
            </div>
            <div v-else-if="closedCycles.length === 0" class="ledger-empty">
              <Icon name="ph:notebook" class="ledger-empty-icon" />
              <span>{{ $t('admin.freeleechPool.historyEmpty') }}</span>
            </div>
            <table v-else class="ledger-table">
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
                <tr v-for="(c, i) in closedCycles" :key="c.id" :class="`row--${c.status}`">
                  <td class="folio tabular-nums">№ {{ String(closedCycles.length - i).padStart(3, '0') }}</td>
                  <td>
                    <span class="ledger-status" :class="`ledger-status--${c.status}`">
                      {{ $t(`admin.freeleechPool.cycleStatus.${c.status}`) }}
                    </span>
                  </td>
                  <td class="right tabular-nums">{{ formatNumber(c.targetSnapshot) }}</td>
                  <td class="right tabular-nums">{{ formatNumber(c.totalContributed) }}</td>
                  <td class="tabular-nums">{{ c.startedAt ? formatDateTime(c.startedAt) : '—' }}</td>
                  <td class="tabular-nums">{{ c.closedAt ? formatDateTime(c.closedAt) : '—' }}</td>
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

const title = computed(() => t('admin.freeleechPool.cistern.title'));

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

// ── Schedule tab state ─────────────────────────────────────
// Each window kind has its own form, but the operator only ever
// edits one at a time. A single ref drives the active tab so the
// inactive forms stay unmounted (their inputs don't pollute the
// tab order) and the page reads as one focused control surface.
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

// ── Gauge math ─────────────────────────────────────────────
// `progressPct` drives the arc fill (0..100) and the readout
// numeral. `progressAngle` rotates the needle: -90° at 0%, +90° at
// 100% — the dial is a semicircle that sweeps left-to-right.
const progressPct = computed(() => {
  if (!currentCycle.value) return 0;
  const t = currentCycle.value.targetSnapshot;
  if (t <= 0) return 0;
  return Math.min(100, Math.max(0, (currentCycle.value.totalContributed / t) * 100));
});
const progressAngle = computed(() => (progressPct.value / 100) * 180 - 90);

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

await Promise.all([loadConfig(), loadWindows(), loadCycles()]);

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
   Palette + shared CSS variables.
   ───────────────────────────────────────────────────────────── */
.cistern {
  /* Ink — the cistern's interior */
  --ink-abyss: #06141a;
  --ink-deep: #0a1d24;
  --ink-panel: #122a33;
  --ink-plaque: #1a3a47;
  --ink-rim: #06141a;

  /* Brass — the instrumentation */
  --brass-shadow: #2a1d08;
  --brass-deep: #4d3815;
  --brass-mid: #8a652a;
  --brass-bright: #c5972f;
  --brass-gleam: #f0c75b;

  /* Engraved + alerts */
  --cream: #ead9b6;
  --cream-dim: rgba(234, 217, 182, 0.6);
  --alert: #d34c4c;
  --alert-deep: #6b1f1f;
  --mist: #6b9aab;

  /* Typography */
  --font-stencil: 'Big Shoulders Stencil Display', 'Black Ops One',
    'Major Mono Display', ui-monospace, monospace;
  --font-serif: 'Iowan Old Style', 'Palatino Linotype', 'Palatino',
    'Bitstream Vera Serif', 'Liberation Serif', Georgia, serif;
  --font-mono: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace,
    SFMono-Regular, monospace;

  position: relative;
  max-width: 1240px;
  margin: 0 auto;
  padding: 3rem 1.5rem 6rem;
  color: var(--cream);
  background: var(--ink-deep);
  isolation: isolate;
}

/* ─────────────────────────────────────────────────────────────
   Atmospheric backdrop — layered textures.
   ───────────────────────────────────────────────────────────── */
.bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  overflow: hidden;
  background: var(--ink-deep);
}
.bg-mesh {
  position: absolute;
  inset: -10%;
  background:
    radial-gradient(
      ellipse at 20% 15%,
      rgba(197, 151, 47, 0.08) 0%,
      transparent 45%
    ),
    radial-gradient(
      ellipse at 85% 80%,
      rgba(107, 154, 171, 0.05) 0%,
      transparent 50%
    ),
    linear-gradient(180deg, var(--ink-abyss) 0%, var(--ink-deep) 100%);
}
.bg-topo {
  position: absolute;
  inset: 0;
  opacity: 0.18;
  background-image:
    repeating-linear-gradient(
      90deg,
      transparent 0 80px,
      rgba(197, 151, 47, 0.07) 80px 81px
    ),
    repeating-linear-gradient(
      0deg,
      transparent 0 80px,
      rgba(197, 151, 47, 0.05) 80px 81px
    );
}
.bg-grain {
  position: absolute;
  inset: 0;
  opacity: 0.5;
  background-image: radial-gradient(
    rgba(255, 255, 255, 0.02) 1px,
    transparent 1px
  );
  background-size: 4px 4px;
}
.bg-vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse at center,
    transparent 30%,
    rgba(6, 20, 26, 0.6) 100%
  );
}

/* ─────────────────────────────────────────────────────────────
   Hero — stencilled identity strip + rivets row.
   ───────────────────────────────────────────────────────────── */
.hero {
  position: relative;
  margin-bottom: 3.5rem;
  text-align: left;
  animation: hero-in 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
}
@keyframes hero-in {
  from {
    opacity: 0;
    transform: translateY(-12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.hero-stamp {
  display: inline-flex;
  align-items: center;
  gap: 0.8rem;
  margin-bottom: 1.4rem;
  padding: 0.35rem 0.85rem;
  background: linear-gradient(180deg, var(--brass-bright) 0%, var(--brass-mid) 100%);
  color: var(--ink-abyss);
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.18);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.3),
    inset 0 -1px 0 rgba(0, 0, 0, 0.25),
    0 2px 4px rgba(0, 0, 0, 0.4);
}
.hero-stamp-rule {
  display: inline-block;
  width: 18px;
  height: 1px;
  background: var(--ink-abyss);
}

.hero-title {
  position: relative;
  margin: 0 0 1.2rem;
  line-height: 0.9;
}
.hero-title-stencil {
  position: relative;
  display: inline-block;
  font-family: var(--font-stencil);
  font-size: clamp(3rem, 9vw, 6.5rem);
  font-weight: 900;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: transparent;
  -webkit-text-stroke: 1.5px var(--brass-bright);
  text-stroke: 1.5px var(--brass-bright);
}
/* Stencil cuts — interrupted horizontal bars across the letterforms
   for the "cut from a steel plate" feel. */
.hero-title-stencil::before {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  color: var(--brass-bright);
  -webkit-text-stroke: 0;
  clip-path: polygon(
    0 0, 100% 0, 100% 22%, 0 22%,
    0 40%, 100% 40%, 100% 58%, 0 58%,
    0 76%, 100% 76%, 100% 100%, 0 100%
  );
  /* Subtle gleam animation across the lit segments. */
  background: linear-gradient(
    90deg,
    transparent 30%,
    rgba(240, 199, 91, 0.4) 50%,
    transparent 70%
  );
  background-size: 200% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  animation: stencil-gleam 7s ease-in-out infinite;
}
@keyframes stencil-gleam {
  0%, 100% { background-position: 200% 50%; }
  50% { background-position: -100% 50%; }
}

.hero-intro {
  max-width: 64ch;
  margin: 0 0 2.2rem;
  font-family: var(--font-serif);
  font-size: 1rem;
  line-height: 1.65;
  color: var(--cream);
  opacity: 0.85;
}

.hero-rivets {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 0;
  border-top: 1px solid var(--brass-deep);
  border-bottom: 1px solid var(--brass-deep);
}
.rivet {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: radial-gradient(
    circle at 30% 30%,
    var(--brass-gleam) 0%,
    var(--brass-mid) 60%,
    var(--brass-shadow) 100%
  );
  box-shadow:
    0 0 0 1px var(--brass-deep),
    0 1px 2px rgba(0, 0, 0, 0.5);
}

/* ─────────────────────────────────────────────────────────────
   Boot screen — when the config hasn't loaded yet.
   ───────────────────────────────────────────────────────────── */
.boot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.8rem;
  padding: 4rem 2rem;
  color: var(--brass-bright);
}
.boot-icon {
  font-size: 3rem;
}
.boot-copy {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.28em;
  text-transform: uppercase;
}

/* ─────────────────────────────────────────────────────────────
   Sectors — the four primary blocks.
   ───────────────────────────────────────────────────────────── */
.sector {
  position: relative;
  margin-bottom: 3rem;
  padding: 2rem 2rem 2.2rem;
  background: linear-gradient(
    180deg,
    var(--ink-panel) 0%,
    var(--ink-deep) 100%
  );
  border: 1px solid var(--brass-deep);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.03),
    0 24px 48px -24px rgba(0, 0, 0, 0.7);
  animation: sector-in 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
}
@keyframes sector-in {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
.sector::before,
.sector::after {
  /* Corner brass-cap brackets — anchored at all four corners. */
  content: '';
  position: absolute;
  width: 20px;
  height: 20px;
  border: 2px solid var(--brass-bright);
  pointer-events: none;
}
.sector::before {
  top: -2px;
  left: -2px;
  border-right: 0;
  border-bottom: 0;
}
.sector::after {
  bottom: -2px;
  right: -2px;
  border-left: 0;
  border-top: 0;
}

.sector-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem 1.2rem;
  margin-bottom: 1.8rem;
  padding-bottom: 1.2rem;
  border-bottom: 1px solid var(--brass-deep);
}
.sector-tag {
  flex-shrink: 0;
  padding: 0.2rem 0.6rem;
  background: var(--ink-plaque);
  border: 1px solid var(--brass-mid);
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--brass-bright);
}
.sector-title {
  margin: 0;
  font-family: var(--font-stencil);
  font-size: clamp(1.6rem, 3vw, 2.2rem);
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--cream);
}
.sector-help {
  flex-basis: 100%;
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.88rem;
  line-height: 1.55;
  color: var(--cream-dim);
  max-width: 78ch;
}

/* ─────────────────────────────────────────────────────────────
   SECTOR A · Reservoir
   ───────────────────────────────────────────────────────────── */
.reservoir-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 3rem 1rem;
  color: var(--cream-dim);
}
.reservoir-empty-icon {
  font-size: 3rem;
  color: var(--brass-mid);
}
.reservoir-empty-copy {
  margin: 0;
  font-family: var(--font-serif);
  font-style: italic;
}

.reservoir {
  display: grid;
  grid-template-columns: minmax(300px, 1fr) minmax(280px, 1fr);
  grid-template-areas:
    'gauge readouts'
    'plaque plaque'
    'drain drain';
  gap: 1.6rem;
}
@media (max-width: 760px) {
  .reservoir {
    grid-template-columns: 1fr;
    grid-template-areas:
      'gauge'
      'readouts'
      'plaque'
      'drain';
  }
}

/* Gauge — circular pressure dial.
   ----------------------------------------------------------- */
.gauge {
  grid-area: gauge;
}
.gauge-frame {
  position: relative;
  padding: 1.4rem 1.4rem 1.8rem;
  background:
    radial-gradient(
      circle at 30% 20%,
      rgba(197, 151, 47, 0.08) 0%,
      transparent 50%
    ),
    linear-gradient(180deg, var(--ink-plaque) 0%, var(--ink-rim) 100%);
  border: 1px solid var(--brass-mid);
  box-shadow:
    inset 0 1px 0 rgba(240, 199, 91, 0.15),
    inset 0 -2px 4px rgba(0, 0, 0, 0.5);
}
.gauge-corner {
  position: absolute;
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--brass-bright);
  pointer-events: none;
}
.gauge-corner--tl { top: 6px; left: 6px; border-right: 0; border-bottom: 0; }
.gauge-corner--tr { top: 6px; right: 6px; border-left: 0; border-bottom: 0; }
.gauge-corner--bl { bottom: 6px; left: 6px; border-right: 0; border-top: 0; }
.gauge-corner--br { bottom: 6px; right: 6px; border-left: 0; border-top: 0; }

.gauge-dial {
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 1;
  margin-inline: auto;
  overflow: hidden;
}
/* The arc — uses @property for smooth conic-gradient transition. */
@property --arc-pct {
  syntax: '<percentage>';
  inherits: false;
  initial-value: 0%;
}
.gauge-arc {
  position: absolute;
  inset: 0;
  /* The pixel ring is wider than tall — the bottom half of the
     dial is clipped by aspect-ratio. */
  height: 200%;
  border-radius: 50%;
  background: conic-gradient(
    from -90deg,
    var(--brass-gleam) 0%,
    var(--brass-bright) var(--arc-pct),
    rgba(255, 255, 255, 0.06) var(--arc-pct),
    rgba(255, 255, 255, 0.06) 50%,
    transparent 50%
  );
  /* Donut hole — show only the outer ring portion. */
  mask:
    radial-gradient(circle, transparent 56%, black 56% 94%, transparent 94%);
  -webkit-mask:
    radial-gradient(circle, transparent 56%, black 56% 94%, transparent 94%);
  filter: drop-shadow(0 0 18px rgba(197, 151, 47, 0.35));
  transition: --arc-pct 1.2s cubic-bezier(0.2, 0.7, 0.2, 1);
}

.gauge-ticks {
  position: absolute;
  inset: 0;
  height: 200%;
  border-radius: 50%;
}
.gauge-tick {
  position: absolute;
  top: 6px;
  left: calc(50% - 1px);
  width: 2px;
  height: 12px;
  background: var(--brass-mid);
  /* Each tick rotates around the center of the FULL circle. */
  transform-origin: 1px 50%;
  /* Distribute 11 ticks across 180° (every 18°), starting at -90°. */
  transform: rotate(calc(var(--i) * 18deg - 90deg));
}
.gauge-tick--major {
  height: 18px;
  width: 3px;
  left: calc(50% - 1.5px);
  background: var(--brass-bright);
  transform-origin: 1.5px 50%;
}

/* Needle — rotated by --angle (in degrees, -90 to +90). */
.gauge-needle {
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 4px;
  height: 88%;
  /* Anchored at the bottom-center of the dial (the pivot). */
  transform-origin: 50% 100%;
  transform: translateX(-50%) rotate(var(--angle, -90deg));
  transition: transform 1.2s cubic-bezier(0.2, 0.7, 0.2, 1);
  pointer-events: none;
}
.gauge-needle::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    var(--brass-deep) 0%,
    var(--alert) 35%,
    var(--alert) 100%
  );
  box-shadow:
    0 0 8px rgba(211, 76, 76, 0.55),
    0 0 16px rgba(211, 76, 76, 0.3);
  clip-path: polygon(50% 0%, 100% 12%, 100% 100%, 0 100%, 0 12%);
}
.gauge-needle-tip {
  position: absolute;
  top: -4px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 10px solid var(--alert);
  filter: drop-shadow(0 0 4px rgba(211, 76, 76, 0.6));
}

.gauge-pivot {
  position: absolute;
  bottom: -14px;
  left: 50%;
  transform: translateX(-50%);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background:
    radial-gradient(
      circle at 30% 30%,
      var(--brass-gleam) 0%,
      var(--brass-bright) 40%,
      var(--brass-deep) 100%
    );
  box-shadow:
    inset 0 -2px 4px rgba(0, 0, 0, 0.4),
    0 2px 4px rgba(0, 0, 0, 0.6),
    0 0 0 2px var(--ink-deep);
}
.gauge-pivot-screw {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2px;
  height: 14px;
  background: var(--brass-shadow);
  transform: translate(-50%, -50%) rotate(-25deg);
}
.gauge-pivot-screw::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--brass-shadow);
  transform: rotate(50deg);
}

/* In-flow readout — sits below the dial inside the same frame.
   Centered with two short brass rules flanking the percentage to
   sell the "instrument label" feel without competing with the
   underlying patrons plaque. */
.gauge-readout {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.7rem 0.85rem;
  margin-top: 0.9rem;
  padding-top: 1rem;
  border-top: 1px solid var(--brass-deep);
}
.gauge-readout-rule {
  height: 1px;
  background: linear-gradient(
    to right,
    transparent 0%,
    var(--brass-deep) 50%,
    transparent 100%
  );
}
.gauge-readout-rule--l { justify-self: end; width: 100%; max-width: 80px; }
.gauge-readout-rule--r { justify-self: start; width: 100%; max-width: 80px; }
.gauge-readout-num {
  font-family: var(--font-mono);
  font-size: 2rem;
  font-weight: 900;
  color: var(--cream);
  letter-spacing: -0.02em;
  line-height: 1;
  text-shadow:
    0 0 14px rgba(234, 217, 182, 0.18),
    0 2px 4px rgba(0, 0, 0, 0.6);
}
.gauge-readout-pct {
  font-size: 0.55em;
  margin-left: 0.1em;
  color: var(--brass-bright);
  font-weight: 700;
}
.gauge-readout-label {
  grid-column: 1 / -1;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--brass-mid);
}

/* Readouts panel (instrumentation grid).
   ----------------------------------------------------------- */
.readouts {
  grid-area: readouts;
  display: flex;
  flex-direction: column;
  background: var(--ink-rim);
  border: 1px solid var(--brass-deep);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.03),
    inset 0 -2px 4px rgba(0, 0, 0, 0.5);
}
.readouts-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.8rem;
  background: linear-gradient(
    180deg,
    var(--brass-bright) 0%,
    var(--brass-mid) 50%,
    var(--brass-deep) 100%
  );
  color: var(--ink-abyss);
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.18);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    inset 0 -1px 0 rgba(0, 0, 0, 0.3);
}
.readouts-screw {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, var(--cream), var(--brass-shadow));
  box-shadow:
    0 0 0 1px var(--brass-shadow),
    inset 0 -1px 0 rgba(0, 0, 0, 0.4);
}
.readouts-title {
  flex: 1;
  text-align: center;
}
.readouts-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  margin: 0;
  padding: 1px;
  background: var(--brass-deep);
}
.readout {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.85rem 1rem;
  margin: 0;
  background: var(--ink-rim);
}
.readout-tag {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--brass-mid);
}
.readout-value {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--cream);
}
.readout-big {
  font-size: 1.3rem;
  color: var(--brass-bright);
  letter-spacing: -0.01em;
}
.readout-of {
  color: var(--cream-dim);
  font-size: 0.78rem;
}

/* Status LED — animated dot. */
.status-led {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--brass-mid);
  box-shadow: 0 0 0 2px var(--ink-rim);
}
.status-led--filling {
  background: var(--brass-bright);
  box-shadow:
    0 0 0 2px var(--ink-rim),
    0 0 10px var(--brass-bright);
  animation: led-pulse 2.4s ease-in-out infinite;
}
.status-led--full_queued {
  background: var(--mist);
  box-shadow:
    0 0 0 2px var(--ink-rim),
    0 0 10px var(--mist);
  animation: led-pulse 1.6s ease-in-out infinite;
}
.status-led--active {
  background: #4ade80;
  box-shadow:
    0 0 0 2px var(--ink-rim),
    0 0 12px rgba(74, 222, 128, 0.7);
  animation: led-pulse 1.1s ease-in-out infinite;
}
@keyframes led-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

/* Patrons brass plaque — engraved leaderboard.
   ----------------------------------------------------------- */
.plaque {
  grid-area: plaque;
  position: relative;
  padding: 1.6rem 1.8rem 1.4rem;
  background:
    radial-gradient(
      ellipse at 50% 0%,
      rgba(240, 199, 91, 0.18) 0%,
      transparent 60%
    ),
    linear-gradient(
      180deg,
      var(--brass-mid) 0%,
      #5d4319 50%,
      #3e2c10 100%
    );
  border: 1.5px solid var(--brass-deep);
  box-shadow:
    inset 0 1px 0 var(--brass-gleam),
    inset 0 -2px 6px rgba(0, 0, 0, 0.5),
    0 6px 18px -8px rgba(0, 0, 0, 0.6);
}
.plaque-corner {
  position: absolute;
  width: 18px;
  height: 18px;
  background: radial-gradient(
    circle at 30% 30%,
    var(--brass-gleam) 0%,
    var(--brass-mid) 50%,
    var(--brass-shadow) 100%
  );
  border-radius: 50%;
  box-shadow:
    0 0 0 1px var(--brass-shadow),
    inset 0 -1px 1px rgba(0, 0, 0, 0.3);
}
.plaque-corner--tl { top: 8px; left: 8px; }
.plaque-corner--tr { top: 8px; right: 8px; }
.plaque-corner--bl { bottom: 8px; left: 8px; }
.plaque-corner--br { bottom: 8px; right: 8px; }

.plaque-head {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-bottom: 1rem;
}
.plaque-rule {
  flex: 1;
  height: 1px;
  background: linear-gradient(
    to right,
    transparent 0%,
    var(--brass-shadow) 50%,
    transparent 100%
  );
}
.plaque-title {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-abyss);
  text-shadow:
    0 1px 0 rgba(255, 255, 255, 0.18),
    0 -1px 0 rgba(0, 0, 0, 0.2);
}

.plaque-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.plaque-row {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: baseline;
  gap: 0.6rem;
}
.plaque-rank {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 800;
  color: var(--ink-abyss);
  letter-spacing: 0.15em;
  opacity: 0.7;
}
.plaque-name {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 1.05rem;
  font-weight: 500;
  color: var(--ink-abyss);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.18);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.plaque-dotline {
  height: 1px;
  background-image: radial-gradient(
    circle,
    var(--ink-abyss) 0.5px,
    transparent 0.5px
  );
  background-size: 6px 1px;
  background-repeat: repeat-x;
  background-position: center;
  opacity: 0.5;
  align-self: center;
}
.plaque-amount {
  font-family: var(--font-mono);
  font-size: 0.95rem;
  font-weight: 800;
  color: var(--ink-abyss);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.15);
}

/* Drain button — emergency-style red.
   ----------------------------------------------------------- */
.drain-btn {
  grid-area: drain;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.7rem;
  padding: 0.95rem 1.4rem;
  background: linear-gradient(
    180deg,
    var(--alert) 0%,
    #a83232 50%,
    #6b1f1f 100%
  );
  color: var(--cream);
  border: 1px solid var(--alert-deep);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.2),
    inset 0 -2px 4px rgba(0, 0, 0, 0.3),
    0 4px 12px -4px rgba(211, 76, 76, 0.5);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.drain-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    inset 0 -2px 4px rgba(0, 0, 0, 0.3),
    0 6px 18px -4px rgba(211, 76, 76, 0.7);
}
.drain-btn:active:not(:disabled) {
  transform: translateY(0);
}
.drain-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.drain-btn-bezel {
  position: absolute;
  inset: 3px;
  border: 1px solid rgba(0, 0, 0, 0.3);
  pointer-events: none;
}
.drain-btn-icon {
  font-size: 1.1rem;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.4));
}
.drain-btn-label {
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
}

/* ─────────────────────────────────────────────────────────────
   SECTOR B · Calibration
   ───────────────────────────────────────────────────────────── */

/* Master arm switch — the dominant configuration control. */
.arm {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1.4rem;
  align-items: center;
  margin-bottom: 1.8rem;
  padding: 1.2rem 1.4rem;
  background: linear-gradient(
    180deg,
    var(--ink-plaque) 0%,
    var(--ink-rim) 100%
  );
  border: 1px solid var(--brass-deep);
}
@media (max-width: 580px) {
  .arm {
    grid-template-columns: 1fr;
  }
}

.arm-switch {
  position: relative;
  display: inline-grid;
  grid-template-columns: auto auto auto;
  align-items: center;
  gap: 0.85rem;
  padding: 0.7rem 1.2rem;
  background: linear-gradient(180deg, #122a33 0%, #06141a 100%);
  border: 0;
  cursor: pointer;
  font-family: var(--font-mono);
}
.arm-switch-frame {
  position: absolute;
  inset: 0;
  border: 2px solid var(--brass-deep);
  pointer-events: none;
}
.arm-switch-led {
  position: relative;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--brass-shadow);
  box-shadow:
    inset 0 -1px 1px rgba(0, 0, 0, 0.5),
    0 0 0 1px var(--brass-deep);
  transition: background 0.2s ease, box-shadow 0.2s ease;
}
.arm-switch--on .arm-switch-led {
  background: var(--alert);
  box-shadow:
    inset 0 -1px 1px rgba(0, 0, 0, 0.4),
    0 0 0 1px var(--alert-deep),
    0 0 10px var(--alert),
    0 0 20px rgba(211, 76, 76, 0.5);
  animation: led-pulse 1.4s ease-in-out infinite;
}

.arm-switch-knob {
  display: inline-block;
  position: relative;
  width: 44px;
  height: 28px;
  background: linear-gradient(180deg, var(--ink-abyss) 0%, #02080a 100%);
  border: 1px solid var(--brass-deep);
}
.arm-switch-knob-handle {
  position: absolute;
  top: 50%;
  left: 5px;
  width: 14px;
  height: 18px;
  background: linear-gradient(
    180deg,
    var(--brass-gleam) 0%,
    var(--brass-bright) 40%,
    var(--brass-deep) 100%
  );
  border: 1px solid var(--brass-shadow);
  transform: translateY(-50%);
  transition: left 0.25s cubic-bezier(0.2, 0.7, 0.2, 1);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.3),
    inset 0 -1px 0 rgba(0, 0, 0, 0.4),
    0 1px 2px rgba(0, 0, 0, 0.5);
}
.arm-switch--on .arm-switch-knob-handle {
  left: 23px;
}

.arm-switch-state {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--cream-dim);
  transition: color 0.2s ease;
}
.arm-switch--on .arm-switch-state {
  color: var(--alert);
  text-shadow: 0 0 6px rgba(211, 76, 76, 0.5);
}

.arm-copy {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.arm-label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--brass-bright);
}
.arm-hint {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.85rem;
  color: var(--cream-dim);
  line-height: 1.5;
}

/* Calibration grid — each "card" is a brass-plate input. */
.cal-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}
@media (max-width: 720px) {
  .cal-grid {
    grid-template-columns: 1fr;
  }
}

.cal-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem 1.1rem;
  background:
    linear-gradient(180deg, var(--ink-plaque) 0%, var(--ink-rim) 100%);
  border: 1px solid var(--brass-deep);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.03);
}
.cal-card--big {
  grid-column: span 2;
}
.cal-card--wide,
.cal-card--full {
  grid-column: span 2;
}
@media (max-width: 720px) {
  .cal-card--big,
  .cal-card--wide,
  .cal-card--full {
    grid-column: span 1;
  }
}

/* Decorative corner pins on each card. */
.cal-card-pin {
  position: absolute;
  top: 6px;
  left: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: radial-gradient(
    circle at 30% 30%,
    var(--brass-gleam) 0%,
    var(--brass-mid) 60%,
    var(--brass-shadow) 100%
  );
  box-shadow: 0 0 0 1px var(--brass-shadow);
}
.cal-card-pin--right {
  left: auto;
  right: 6px;
}

.cal-card-label {
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: var(--brass-bright);
  padding-left: 14px;
}
.cal-card-meter {
  display: flex;
  align-items: stretch;
  background: var(--ink-abyss);
  border: 1px solid var(--brass-deep);
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.6),
    inset 0 -1px 0 rgba(240, 199, 91, 0.05);
}
.cal-input {
  flex: 1;
  min-width: 0;
  padding: 0.65rem 0.85rem;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--cream);
  font-family: var(--font-mono);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-shadow: 0 0 8px rgba(234, 217, 182, 0.12);
}
.cal-input::placeholder {
  color: var(--cream-dim);
  opacity: 0.4;
}
.cal-input--xl {
  font-size: 1.6rem;
  font-weight: 800;
}

/* Standalone text-like inputs (no surrounding `.cal-card-meter`
   wrapper). They get the same "well" treatment as the meter so it's
   obvious they're editable. Apply to <input>, <textarea> and
   <select> together so the whole control surface reads as one
   instrument family. */
.cal-input--text,
.cal-textarea,
select.cal-input,
input.cal-input[type='time'],
input.cal-input[type='datetime-local'] {
  width: 100%;
  padding: 0.6rem 0.85rem;
  background: var(--ink-abyss);
  border: 1px solid var(--brass-deep);
  color: var(--cream);
  font-family: var(--font-mono);
  font-size: 0.92rem;
  font-weight: 600;
  outline: 0;
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.55),
    inset 0 -1px 0 rgba(240, 199, 91, 0.05);
  transition: border-color 0.18s ease, box-shadow 0.18s ease,
    background-color 0.18s ease;
}
.cal-input--text:hover,
.cal-textarea:hover,
select.cal-input:hover,
input.cal-input[type='time']:hover,
input.cal-input[type='datetime-local']:hover {
  border-color: var(--brass-mid);
  background-color: #061318;
}
.cal-input--text:focus,
.cal-textarea:focus,
select.cal-input:focus,
input.cal-input[type='time']:focus,
input.cal-input[type='datetime-local']:focus {
  border-color: var(--brass-bright);
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.55),
    inset 0 -1px 0 rgba(240, 199, 91, 0.1),
    0 0 0 1px rgba(197, 151, 47, 0.35),
    0 0 14px rgba(197, 151, 47, 0.18);
}

/* Custom select arrow — bare default looks like static text. */
select.cal-input {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 2.2rem;
  background-image:
    linear-gradient(45deg, transparent 50%, var(--brass-bright) 50%),
    linear-gradient(-45deg, transparent 50%, var(--brass-bright) 50%);
  background-position:
    calc(100% - 16px) 50%,
    calc(100% - 11px) 50%;
  background-size: 5px 5px;
  background-repeat: no-repeat;
  cursor: pointer;
}
select.cal-input option {
  background: var(--ink-rim);
  color: var(--cream);
}

.cal-textarea {
  resize: vertical;
  min-height: 80px;
  font-family: var(--font-serif);
  font-size: 0.95rem;
  font-weight: 500;
  line-height: 1.55;
  letter-spacing: 0.01em;
}
.cal-input-unit {
  display: inline-flex;
  align-items: center;
  padding: 0 0.75rem;
  border-left: 1px solid var(--brass-deep);
  background: var(--ink-plaque);
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: var(--brass-bright);
}
.cal-card-hint {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--cream-dim);
  padding-left: 14px;
}

.cal-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 1.6rem;
  padding-top: 1.4rem;
  border-top: 1px solid var(--brass-deep);
}

/* Primary brass action button. */
.brass-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  padding: 0.85rem 1.4rem;
  background: linear-gradient(
    180deg,
    var(--brass-gleam) 0%,
    var(--brass-bright) 45%,
    var(--brass-mid) 100%
  );
  color: var(--ink-abyss);
  border: 1px solid var(--brass-shadow);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.18);
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease,
    filter 0.18s ease;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    inset 0 -2px 4px rgba(0, 0, 0, 0.3),
    0 4px 12px -4px rgba(0, 0, 0, 0.5);
}
.brass-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.06);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.4),
    inset 0 -2px 4px rgba(0, 0, 0, 0.3),
    0 6px 18px -4px rgba(0, 0, 0, 0.6);
}
.brass-btn:active:not(:disabled) {
  transform: translateY(0);
  filter: brightness(0.96);
}
.brass-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.brass-btn-bezel {
  position: absolute;
  inset: 3px;
  border: 1px solid rgba(0, 0, 0, 0.25);
  pointer-events: none;
}
.brass-btn-icon {
  font-size: 1rem;
}
.brass-btn--sm {
  padding: 0.55rem 1rem;
  font-size: 10px;
  margin-top: 1rem;
}

/* ─────────────────────────────────────────────────────────────
   SECTOR C · Schedule
   ───────────────────────────────────────────────────────────── */
.tabs {
  display: flex;
  gap: 0;
  margin-bottom: 1.8rem;
  border-bottom: 1px solid var(--brass-deep);
}
.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.85rem 1.15rem;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  color: var(--cream-dim);
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 0.18s ease, border-color 0.22s ease,
    background 0.18s ease;
}
.tab:hover {
  color: var(--cream);
  background: rgba(197, 151, 47, 0.05);
}
.tab--on {
  color: var(--brass-bright);
  border-bottom-color: var(--brass-bright);
  background: linear-gradient(
    180deg,
    transparent 0%,
    rgba(197, 151, 47, 0.08) 100%
  );
}
.tab--on::before {
  /* Small brass rivet above the active tab — sells the metallic
     "selected indicator nail" feel. */
  content: '';
  position: absolute;
  top: -3px;
  left: 50%;
  transform: translateX(-50%);
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: radial-gradient(
    circle at 30% 30%,
    var(--brass-gleam) 0%,
    var(--brass-mid) 60%,
    var(--brass-shadow) 100%
  );
}
.tab-icon {
  font-size: 1.05rem;
}

.tab-body {
  animation: tab-in 0.32s cubic-bezier(0.2, 0.7, 0.2, 1);
}
@keyframes tab-in {
  from {
    opacity: 0;
    transform: translateX(-6px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.sched-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: flex-start;
}
.sched-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  width: 100%;
}
@media (min-width: 760px) {
  .sched-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
.sched-hint {
  margin: 0;
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 0.82rem;
  color: var(--cream-dim);
}

/* Day-of-month picker — 7-column chip grid. */
.day-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.3rem;
  margin-top: 0.5rem;
}
.day-chip {
  position: relative;
  padding: 0.55rem 0;
  background: linear-gradient(
    180deg,
    var(--ink-rim) 0%,
    var(--ink-abyss) 100%
  );
  border: 1px solid var(--brass-deep);
  color: var(--cream-dim);
  font-family: var(--font-mono);
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}
.day-chip:hover:not(.day-chip--on) {
  border-color: var(--brass-mid);
  color: var(--cream);
}
.day-chip--on {
  background: linear-gradient(
    180deg,
    var(--brass-gleam) 0%,
    var(--brass-bright) 50%,
    var(--brass-mid) 100%
  );
  border-color: var(--brass-shadow);
  color: var(--ink-abyss);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.2);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    inset 0 -1px 0 rgba(0, 0, 0, 0.25),
    0 0 8px rgba(197, 151, 47, 0.3);
}

/* Deployed floodgates list.
   ----------------------------------------------------------- */
.floodgates {
  margin-top: 2rem;
  padding-top: 1.6rem;
  border-top: 1px dashed var(--brass-deep);
}
.floodgates-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1rem;
}
.floodgates-rule {
  flex: 1;
  height: 1px;
  background: linear-gradient(
    to right,
    transparent 0%,
    var(--brass-deep) 50%,
    transparent 100%
  );
}
.floodgates-title {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--brass-bright);
}
.floodgates-count {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 800;
  color: var(--cream);
  padding: 0.18rem 0.5rem;
  border: 1px solid var(--brass-deep);
}

.floodgates-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 2.5rem 1rem;
  color: var(--cream-dim);
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 0.88rem;
}
.floodgates-empty-icon {
  font-size: 2.4rem;
  color: var(--brass-mid);
}

.floodgates-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.floodgate {
  display: grid;
  grid-template-columns: auto auto 1fr auto auto auto;
  gap: 0.7rem;
  align-items: center;
  padding: 0.55rem 0.85rem;
  background: linear-gradient(
    90deg,
    var(--ink-rim) 0%,
    var(--ink-panel) 100%
  );
  border: 1px solid var(--brass-deep);
  transition: border-color 0.22s ease;
}
.floodgate:hover {
  border-color: var(--brass-mid);
}
.floodgate-pip {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.5);
}
.floodgate-pip--off {
  background: var(--brass-shadow);
  box-shadow: none;
}
.floodgate-kind {
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 0.18rem 0.5rem;
  border: 1px solid currentColor;
}
.floodgate-kind--oneoff { color: var(--mist); }
.floodgate-kind--weekly { color: var(--brass-bright); }
.floodgate-kind--monthly { color: #6cd2f0; }
.floodgate-kind--yearly { color: #c896f0; }

.floodgate-desc {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--cream);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.floodgate-label {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 0.78rem;
  color: var(--cream-dim);
}
.floodgate-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--cream-dim);
  cursor: pointer;
}
.floodgate-toggle input[type='checkbox'] {
  accent-color: var(--brass-bright);
}
.floodgate-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem;
  background: transparent;
  border: 1px solid transparent;
  color: var(--cream-dim);
  cursor: pointer;
  font-size: 1rem;
  transition: all 0.16s ease;
}
.floodgate-remove:hover {
  border-color: var(--alert);
  color: var(--alert);
  background: rgba(211, 76, 76, 0.06);
}

/* ─────────────────────────────────────────────────────────────
   SECTOR D · Ledger
   ───────────────────────────────────────────────────────────── */
.ledger {
  position: relative;
  padding: 1.2rem 1.4rem;
  background:
    linear-gradient(180deg, #e8dfc4 0%, #d4c79f 100%);
  border: 1px solid var(--brass-deep);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.5),
    inset 0 -2px 4px rgba(0, 0, 0, 0.15);
}
.ledger-bind {
  position: absolute;
  left: 0;
  right: 0;
  height: 6px;
  background: linear-gradient(
    180deg,
    var(--brass-deep) 0%,
    var(--brass-shadow) 100%
  );
}
.ledger-bind--top { top: -3px; }
.ledger-bind--bottom { bottom: -3px; }
.ledger-bind::before,
.ledger-bind::after {
  content: '';
  position: absolute;
  top: -2px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: radial-gradient(
    circle at 30% 30%,
    var(--brass-gleam) 0%,
    var(--brass-mid) 60%,
    var(--brass-shadow) 100%
  );
}
.ledger-bind::before { left: 16px; }
.ledger-bind::after { right: 16px; }

.ledger-page {
  position: relative;
  padding: 1rem;
  background-image:
    repeating-linear-gradient(
      to bottom,
      transparent 0 28px,
      rgba(106, 78, 24, 0.12) 28px 29px
    );
}
.ledger-loading {
  display: flex;
  justify-content: center;
  padding: 2rem;
  color: var(--brass-mid);
  font-size: 1.6rem;
}
.ledger-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 2.5rem 1rem;
  color: rgba(38, 26, 8, 0.5);
  font-family: var(--font-serif);
  font-style: italic;
}
.ledger-empty-icon {
  font-size: 2.4rem;
}

.ledger-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 0.82rem;
  color: var(--ink-abyss);
}
.ledger-table th {
  text-align: left;
  padding: 0.5rem 0.7rem;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--brass-shadow);
  border-bottom: 2px solid var(--brass-mid);
  background: transparent;
}
.ledger-table td {
  padding: 0.5rem 0.7rem;
  border-bottom: 1px solid rgba(106, 78, 24, 0.2);
  color: var(--ink-abyss);
}
.ledger-table .right {
  text-align: right;
}
.ledger-table tr:hover td {
  background: rgba(197, 151, 47, 0.12);
}
.folio {
  font-weight: 800;
  color: var(--brass-shadow);
}

.ledger-status {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.5rem;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  border: 1px solid currentColor;
}
.ledger-status--filling { color: var(--brass-shadow); }
.ledger-status--full_queued { color: #2a5e7c; }
.ledger-status--active { color: #1e6b3a; }
.ledger-status--ended { color: rgba(38, 26, 8, 0.6); }
.ledger-status--cancelled { color: var(--alert-deep); }

/* ─────────────────────────────────────────────────────────────
   Utilities
   ───────────────────────────────────────────────────────────── */
.tabular-nums {
  font-variant-numeric: tabular-nums;
}
.spin {
  animation: cistern-spin 1s linear infinite;
}
@keyframes cistern-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

<template>
  <!--
    A register, not a policy.

    Somebody opens this page once, worried, and wants one thing: how long
    is this kept. So the duration IS the typography — set in the left
    gutter at display size, in tabular figures, with the sentence beside
    it. "Kept until you delete it" is set at exactly the same size as a
    number, because an unbounded retention is the loudest fact on the page
    and prose is where that kind of fact goes to hide.

    Every figure is read from the running instance rather than written
    down here. A page that says fourteen days while the sweep runs on
    thirty is worse than no page, and nothing about that drift is visible
    from the outside.
  -->
  <div class="pv">
    <header class="pv-head">
      <p class="pv-eyebrow">
        <span class="pv-eyebrow-rule" aria-hidden="true" />
        {{ $t('privacy.eyebrow') }}
      </p>
      <h1 class="pv-title">{{ $t('privacy.title') }}</h1>
      <p class="pv-lede">{{ $t('privacy.lede') }}</p>
      <p class="pv-asof">
        {{ $t('privacy.asOf', { instance: siteName }) }}
      </p>
    </header>

    <!-- ── The register ────────────────────────────────────────────── -->
    <section class="pv-register" :aria-label="$t('privacy.registerLabel')">
      <article
        v-for="(entry, i) in entries"
        :key="entry.key"
        class="pv-entry"
        :style="`--i: ${i}`"
      >
        <p class="pv-duration" :class="{ 'pv-duration--forever': entry.forever }">
          <template v-if="entry.forever">
            <span class="pv-forever-mark" aria-hidden="true">∞</span>
          </template>
          <template v-else>
            <span class="pv-num tabular-nums">{{ entry.days }}</span>
            <span class="pv-unit">{{ $t('privacy.unitDays') }}</span>
          </template>
        </p>

        <div class="pv-body">
          <h2 class="pv-entry-title">{{ entry.title }}</h2>
          <p class="pv-entry-text">{{ entry.text }}</p>
        </div>
      </article>
    </section>

    <!-- ── The things that are not a duration ──────────────────────── -->
    <section class="pv-notes" :aria-label="$t('privacy.notesLabel')">
      <article v-for="note in notes" :key="note.key" class="pv-note">
        <h2 class="pv-note-title">{{ note.title }}</h2>
        <p class="pv-note-text">{{ note.text }}</p>
      </article>
    </section>

    <footer class="pv-foot">
      <p>{{ $t('privacy.foot') }}</p>
    </footer>
  </div>
</template>

<script setup lang="ts">
/**
 * Everything here comes from `/api/privacy`, which reads the settings the
 * sweeps themselves read. Public, because a retention period nobody can
 * look up is a retention period nobody was told about.
 */
interface PrivacyFacts {
  messaging: {
    directMessages: boolean;
    room: boolean;
    /** Days, or 0 — kept until a participant deletes them. */
    directMessageDays: number;
    roomMessageDays: number;
  };
  notifications: {
    notificationsReadDays: number;
    notificationsUnreadDays: number;
  };
}

const { t } = useI18n();
const branding = await useBranding();
const siteName = computed(() => branding.value?.siteName || 'Trackarr');

const { data } = await useFetch<PrivacyFacts>('/api/privacy');

interface Entry {
  key: string;
  days: number;
  forever: boolean;
  title: string;
  text: string;
}

/**
 * Only what this instance actually holds. A surface that is switched off
 * has nothing to retain, so it is left out rather than listed with a
 * duration that describes nothing.
 */
const entries = computed<Entry[]>(() => {
  const f = data.value;
  if (!f) return [];
  const rows: Entry[] = [];

  if (f.messaging.directMessages) {
    const d = f.messaging.directMessageDays;
    rows.push({
      key: 'dm',
      days: d,
      forever: d <= 0,
      title: t('privacy.dm.title'),
      text: d > 0 ? t('privacy.dm.timed', { n: d }) : t('privacy.dm.forever'),
    });
  }

  if (f.messaging.room) {
    rows.push({
      key: 'room',
      days: f.messaging.roomMessageDays,
      forever: false,
      title: t('privacy.room.title'),
      text: t('privacy.room.text', { n: f.messaging.roomMessageDays }),
    });
  }

  rows.push({
    key: 'notifications',
    days: f.notifications.notificationsReadDays,
    forever: false,
    title: t('privacy.notifications.title'),
    text: t('privacy.notifications.text', {
      read: f.notifications.notificationsReadDays,
      unread: f.notifications.notificationsUnreadDays,
    }),
  });

  return rows;
});

/** The facts that are not a number, and are the ones people ask about. */
const notes = computed(() => [
  { key: 'erasure', title: t('privacy.erasure.title'), text: t('privacy.erasure.text') },
  { key: 'crypto', title: t('privacy.crypto.title'), text: t('privacy.crypto.text') },
  { key: 'staff', title: t('privacy.staff.title'), text: t('privacy.staff.text') },
]);

useHead({ title: () => t('privacy.title') });
</script>

<style scoped>
/*
 * A ledger: hairline rules, a wide left gutter for the figure, and a
 * measure short enough to read. Nothing decorative — the page is read
 * once, under stress, and every flourish is one more thing between the
 * reader and the number.
 */
.pv {
  max-width: 46rem;
  margin: 0 auto;
  padding: 3rem 1.25rem 5rem;
}

/* ── Head ─────────────────────────────────────────────────────────── */
.pv-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0 0 1.25rem;
  color: rgb(var(--fg-subtle));
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
}
.pv-eyebrow-rule {
  width: 2.5rem;
  height: 1px;
  background: rgb(var(--line-strong));
}

.pv-title {
  margin: 0 0 1.25rem;
  font-family: var(--font-display);
  font-size: clamp(2rem, 6vw, 3rem);
  font-weight: 400;
  line-height: 1.05;
  letter-spacing: -0.01em;
  color: rgb(var(--fg-strong));
}

.pv-lede {
  margin: 0 0 0.75rem;
  max-width: 34rem;
  font-size: 1rem;
  line-height: 1.65;
  color: rgb(var(--fg-default));
}

.pv-asof {
  margin: 0;
  color: rgb(var(--fg-subtle));
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
}

/* ── The register ─────────────────────────────────────────────────── */
.pv-register {
  margin-top: 3.5rem;
  border-top: 1px solid rgb(var(--line-default));
}

.pv-entry {
  display: grid;
  grid-template-columns: 8.5rem 1fr;
  gap: 1.75rem;
  align-items: baseline;
  padding: 1.75rem 0;
  border-bottom: 1px solid rgb(var(--line-default));
  animation: pv-rise var(--dur-4) ease-out backwards;
  animation-delay: calc(var(--i) * 60ms);
}

/* The figure. Set at display size because it is the answer. */
.pv-duration {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  margin: 0;
  font-family: var(--font-mono);
  color: rgb(var(--fg-strong));
}
.pv-num {
  font-size: 2.25rem;
  font-weight: 300;
  line-height: 1;
  letter-spacing: -0.03em;
}
.pv-unit {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: rgb(var(--fg-subtle));
}

/* No duration is the loudest entry, so it is set at the same size and
   carries the one accent on the page. */
.pv-duration--forever { color: rgb(var(--accent-warm)); }
.pv-forever-mark {
  font-size: 2.5rem;
  font-weight: 300;
  line-height: 1;
}

.pv-body { min-width: 0; }
.pv-entry-title {
  margin: 0 0 0.4rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: rgb(var(--fg-default));
}
.pv-entry-text {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.7;
  color: rgb(var(--fg-muted));
}

/* ── Notes ────────────────────────────────────────────────────────── */
.pv-notes {
  margin-top: 3.5rem;
  display: grid;
  gap: 2rem;
}
.pv-note-title {
  margin: 0 0 0.4rem;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: rgb(var(--fg-subtle));
}
.pv-note-text {
  margin: 0;
  max-width: 38rem;
  font-size: 0.9rem;
  line-height: 1.7;
  color: rgb(var(--fg-default));
}

.pv-foot {
  margin-top: 3.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid rgb(var(--line-default));
  color: rgb(var(--fg-subtle));
  font-size: 0.8rem;
  line-height: 1.65;
}
.pv-foot p { margin: 0; }

@keyframes pv-rise {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

/* The stagger is a nicety; the page has to read instantly without it. */
@media (prefers-reduced-motion: reduce) {
  .pv-entry { animation: none; }
}

/* Below the fold of a phone the gutter costs more than it gives: the
   figure goes above its sentence and the rules carry the structure. */
@media (max-width: 40rem) {
  .pv-entry {
    grid-template-columns: 1fr;
    gap: 0.65rem;
  }
}
</style>

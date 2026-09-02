<template>
  <div class="err">
    <div class="err-aura" aria-hidden="true">
      <span class="err-blob" />
    </div>

    <main class="err-body">
      <p class="err-code">{{ code }}</p>
      <h1 class="err-title">{{ title }}</h1>
      <p class="err-text">{{ text }}</p>

      <!-- The message the server actually sent, when there is one worth
           reading. Kept behind a disclosure rather than in the lede: a member
           who mistyped a torrent hash does not need a stack of words, and an
           operator debugging a 500 does. -->
      <details v-if="detail" class="err-detail">
        <summary>{{ $t('error.detail') }}</summary>
        <code>{{ detail }}</code>
      </details>

      <div class="err-actions">
        <button type="button" class="btn btn-primary" @click="goHome">
          <Icon name="ph:house" />
          {{ $t('error.home') }}
        </button>
        <button type="button" class="btn btn-secondary" @click="reload">
          <Icon name="ph:arrow-clockwise" />
          {{ $t('error.retry') }}
        </button>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
/**
 * The error page.
 *
 * There was not one. Every 404 — a mistyped torrent hash, a link to a release
 * a moderator has since removed, a federated id that no longer resolves — and
 * every 500 landed on Nuxt's built-in page: English, unthemed, no header, no
 * way back to the site, and Nuxt's own branding on a self-hosted tracker. On an
 * invite-only site where members share links with each other, a dead link is
 * the single most common failure anybody sees.
 *
 * Deliberately standalone rather than wrapped in the default layout: the layout
 * fetches the session, the branding and the live tracker status, and an error
 * page that needs three round-trips to render is an error page that fails when
 * the API is what broke. Everything here is local.
 */
const props = defineProps<{
  error?: {
    statusCode?: number;
    statusMessage?: string;
    message?: string;
  };
}>();

const { t } = useI18n();

const code = computed(() => props.error?.statusCode ?? 500);

/** 404 and 403 get their own words; everything else is "something broke". */
const kind = computed(() => {
  const c = code.value;
  if (c === 404) return 'notFound';
  if (c === 403) return 'forbidden';
  if (c === 401) return 'unauthorised';
  return 'server';
});

const title = computed(() => t(`error.${kind.value}.title`));
const text = computed(() => t(`error.${kind.value}.text`));

/**
 * The server's own message, when it says more than the status already does.
 *
 * Suppressed on 404 and 403: those messages are written for a log, and a member
 * who followed a dead link is not helped by "Torrent not found".
 */
const detail = computed(() => {
  if (kind.value === 'notFound' || kind.value === 'forbidden') return '';
  const m = props.error?.statusMessage || props.error?.message || '';
  return m && m !== String(code.value) ? m : '';
});

/** `clearError` rather than a plain navigation: it tears the error state down,
 *  otherwise the next route renders inside it. */
function goHome() {
  void clearError({ redirect: '/' });
}
function reload() {
  void clearError({ redirect: useRoute().fullPath });
}

useHead({ title: () => `${code.value} — ${title.value}` });
</script>

<style scoped>
.err {
  position: relative;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 2rem 1.25rem;
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-default));
  overflow: hidden;
}
/* One soft blob, the same atmospheric device the member-facing pages use, so
   the error page reads as part of the site rather than as the browser's. */
.err-aura {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.err-blob {
  position: absolute;
  top: -12rem;
  left: 50%;
  width: 34rem;
  height: 34rem;
  transform: translateX(-50%);
  border-radius: 50%;
  background: rgb(var(--accent-warm) / 0.08);
  filter: blur(90px);
}
.err-body {
  position: relative;
  max-width: 34rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: center;
}
.err-code {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: clamp(3.5rem, 14vw, 6rem);
  font-weight: 700;
  line-height: 1;
  color: rgb(var(--accent-warm-text));
}
.err-title {
  font-family: var(--font-display);
  font-size: clamp(1.5rem, 4vw, 2rem);
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.err-text {
  font-size: 0.9375rem;
  line-height: 1.6;
  color: rgb(var(--fg-muted));
  max-width: 48ch;
}
.err-detail {
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: rgb(var(--fg-subtle));
}
.err-detail summary {
  cursor: pointer;
  padding: 0.4rem 0;
}
.err-detail code {
  display: block;
  margin-top: 0.35rem;
  padding: 0.6rem 0.8rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-surface));
  font-family: var(--font-mono);
  text-align: left;
  overflow-wrap: anywhere;
}
.err-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  justify-content: center;
  margin-top: 0.75rem;
}
</style>

<template>
  <div class="ru">
    <header class="ru-head">
      <p class="ru-eyebrow">
        <span class="ru-eyebrow-rule" aria-hidden="true" />
        {{ $t('rules.eyebrow') }}
      </p>
      <h1 class="ru-title">{{ $t('rules.title', { instance: siteName }) }}</h1>
    </header>

    <!-- A failed read is not "there are no rules": said apart. -->
    <p v-if="pending" class="ru-state">{{ $t('rules.loading') }}</p>
    <p v-else-if="error" class="ru-state ru-state--bad" role="alert">
      {{ $t('rules.unavailable') }}
    </p>
    <p v-else-if="!rulesHtml" class="ru-state">{{ $t('rules.empty') }}</p>
    <!-- Staff-written rich text, sanitised with the editor's own profile so
         it reads as the admin composed it. -->
    <!-- sanitizeRichHtml (DOMPurify). -->
    <!-- nosemgrep: javascript.vue.security.audit.xss.templates.avoid-v-html.avoid-v-html -->
    <div v-else class="ru-body" v-html="rulesHtml" />
  </div>
</template>

<script setup lang="ts">
/**
 * The site rules from Admin → Branding. Readable signed out too (see the
 * route's `openRoutes` entry): an invitation is accepted after reading them.
 */
const { t } = useI18n();
const branding = await useBranding();
const siteName = computed(() => branding.value?.siteName || 'Trackarr');

const { data, pending, error } = await useFetch<{ rules: string }>('/api/rules');
const rulesHtml = computed(() => sanitizeRichHtml(data.value?.rules));

useHead({ title: () => t('rules.eyebrow') });
</script>

<style scoped>
.ru {
  max-width: 46rem;
  margin: 0 auto;
  padding: 3rem 1.25rem 5rem;
}

.ru-eyebrow {
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
.ru-eyebrow-rule {
  width: 2.5rem;
  height: 1px;
  background: rgb(var(--line-strong));
}

.ru-title {
  margin: 0 0 2.5rem;
  font-family: var(--font-display);
  font-size: clamp(2rem, 6vw, 3rem);
  font-weight: 400;
  line-height: 1.05;
  letter-spacing: -0.01em;
  color: rgb(var(--fg-strong));
}

.ru-state {
  margin: 0;
  padding: 1.25rem 0;
  border-top: 1px solid rgb(var(--line-default));
  border-bottom: 1px solid rgb(var(--line-default));
  font-size: 0.875rem;
  color: rgb(var(--fg-muted));
}
.ru-state--bad {
  color: rgb(var(--danger));
}

.ru-body {
  padding-top: 2rem;
  border-top: 1px solid rgb(var(--line-default));
  color: rgb(var(--fg-default));
  font-size: 1rem;
  line-height: 1.7;
}
.ru-body :deep(h1),
.ru-body :deep(h2),
.ru-body :deep(h3) {
  margin: 2rem 0 0.75rem;
  color: rgb(var(--fg-strong));
  line-height: 1.25;
}
.ru-body :deep(h1) { font-size: 1.5rem; }
.ru-body :deep(h2) { font-size: 1.25rem; }
.ru-body :deep(h3) { font-size: 1.0625rem; }
.ru-body :deep(p) {
  margin: 0 0 1rem;
}
.ru-body :deep(ul),
.ru-body :deep(ol) {
  margin: 0 0 1rem;
  padding-left: 1.5rem;
}
.ru-body :deep(ul) { list-style: disc; }
.ru-body :deep(ol) { list-style: decimal; }
.ru-body :deep(li) {
  margin: 0.25rem 0;
}
.ru-body :deep(a) {
  color: rgb(var(--accent));
  text-decoration: underline;
}
.ru-body :deep(blockquote) {
  margin: 0 0 1rem;
  padding-left: 1rem;
  border-left: 3px solid rgb(var(--line-strong));
  color: rgb(var(--fg-muted));
}
</style>

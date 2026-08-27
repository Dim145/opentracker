<template>
  <FederationOff v-if="!federationEnabled" />
  <div v-else class="tax">
    <header class="tax-head">
      <div>
        <h1 class="tax-title">{{ $t('admin.taxonomy.title') }}</h1>
        <p class="tax-sub">{{ $t('admin.taxonomy.sub') }}</p>
      </div>
    </header>

    <!-- Declared mappings ---------------------------------------------------->
    <section class="tax-card">
      <h2 class="tax-h2">
        <Icon name="ph:link-bold" /> {{ $t('admin.taxonomy.mapped') }}
        <span class="tax-count">{{ mappings.length }}</span>
      </h2>

      <p v-if="!mappings.length" class="tax-empty">
        {{ $t('admin.taxonomy.noMappings') }}
      </p>

      <ul v-else class="tax-list">
        <li v-for="m in mappings" :key="m.id" class="tax-row">
          <code class="tax-slug">{{ m.remoteSlug }}</code>
          <Icon name="ph:arrow-right-bold" class="tax-arrow" />
          <span class="tax-local">
            {{ m.categoryName }}
            <code class="tax-localslug">{{ m.categorySlug }}</code>
          </span>
          <button
            class="tax-remove"
            :disabled="removing.has(m.id)"
            @click="remove(m.id)"
          >
            <Icon name="ph:x-bold" /> {{ $t('admin.taxonomy.remove') }}
          </button>
        </li>
      </ul>
    </section>

    <!-- Add by hand ---------------------------------------------------------->
    <section class="tax-card">
      <h2 class="tax-h2"><Icon name="ph:plus-bold" /> {{ $t('admin.taxonomy.addTitle') }}</h2>
      <form class="tax-add" @submit.prevent="add(form.slug, form.category)">
        <input
          v-model="form.slug"
          class="tax-input"
          :placeholder="$t('admin.taxonomy.slugPlaceholder')"
        />
        <Icon name="ph:arrow-right" class="tax-arrow" />
        <select v-model="form.category" class="tax-input tax-input--grow">
          <option value="">{{ $t('admin.taxonomy.pickCategory') }}</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">
            {{ categoryLabel(c) }}
          </option>
        </select>
        <button class="tax-btn" :disabled="busy || !form.slug.trim() || !form.category">
          <Icon name="ph:link-bold" /> {{ $t('admin.taxonomy.map') }}
        </button>
      </form>
    </section>

    <!-- Unmapped worklist ---------------------------------------------------->
    <section class="tax-card">
      <h2 class="tax-h2">
        <Icon name="ph:warning-bold" /> {{ $t('admin.taxonomy.unmapped') }}
        <span class="tax-count">{{ unmapped.length }}</span>
      </h2>
      <p class="tax-hint">{{ $t('admin.taxonomy.unmappedHint') }}</p>

      <p v-if="!unmapped.length" class="tax-empty">
        {{ $t('admin.taxonomy.allMapped') }}
      </p>

      <ul v-else class="tax-list">
        <li v-for="u in unmapped" :key="u.slug!" class="tax-row">
          <code class="tax-slug">{{ u.slug }}</code>
          <span class="tax-n">{{ $t('admin.taxonomy.releases', { n: u.count }) }}</span>
          <select v-model="pick[u.slug!]" class="tax-input tax-input--grow">
            <option value="">{{ $t('admin.taxonomy.pickCategory') }}</option>
            <option v-for="c in categories" :key="c.id" :value="c.id">
              {{ categoryLabel(c) }}
            </option>
          </select>
          <button
            class="tax-btn"
            :disabled="busy || !pick[u.slug!]"
            @click="add(u.slug!, pick[u.slug!]!)"
          >
            <Icon name="ph:link-bold" /> {{ $t('admin.taxonomy.map') }}
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
interface Mapping {
  id: string;
  remoteSlug: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  createdAt: string;
}
interface Cat {
  id: string;
  name: string;
  slug: string;
  type: string | null;
  parentId: string | null;
  isAdult: boolean;
}
interface Resp {
  mappings: Mapping[];
  unmapped: { slug: string | null; count: number }[];
  categories: Cat[];
}

const { t } = useI18n();
const branding = await useBranding();
const federationEnabled = computed(() =>
  Boolean(branding.value?.federationEnabled),
);

const { data, refresh } = await useFetch<Resp>('/api/admin/federation/taxonomy', {
  // immediate: no partner vocabulary to map when federation is off.
  default: () => ({ mappings: [], unmapped: [], categories: [] }),
  immediate: federationEnabled.value,
});
const mappings = computed(() => data.value?.mappings ?? []);
const unmapped = computed(() => data.value?.unmapped ?? []);
const categories = computed(() => data.value?.categories ?? []);

const form = reactive({ slug: '', category: '' });
const pick = reactive<Record<string, string>>({});
const busy = ref(false);
const removing = ref(new Set<string>());

function categoryLabel(c: Cat): string {
  const bits = [c.name];
  if (c.isAdult) bits.push(t('admin.taxonomy.adultTag'));
  return bits.join(' · ');
}

async function add(slug: string, categoryId: string): Promise<void> {
  const remoteSlug = slug.trim();
  if (!remoteSlug || !categoryId) return;
  busy.value = true;
  try {
    await $fetch('/api/admin/federation/taxonomy', {
      method: 'POST',
      body: { remoteSlug, localCategoryId: categoryId },
    });
    form.slug = '';
    form.category = '';
    delete pick[remoteSlug];
    await refresh();
  } catch {
    /* validation error keeps the form as-is */
  } finally {
    busy.value = false;
  }
}

async function remove(id: string): Promise<void> {
  removing.value = new Set(removing.value).add(id);
  try {
    await $fetch(`/api/admin/federation/taxonomy/${id}`, { method: 'DELETE' });
    await refresh();
  } catch {
    /* a refresh reconciles */
  } finally {
    const next = new Set(removing.value);
    next.delete(id);
    removing.value = next;
  }
}
</script>

<style scoped>
.tax { max-width: 940px; margin: 0 auto; padding: 0.5rem 0 3rem; }
.tax-head { margin-bottom: 1.5rem; }
.tax-title { font-size: 1.4rem; font-weight: 700; color: rgb(var(--fg-strong)); }
.tax-sub { color: rgb(var(--fg-muted)); font-size: 0.9rem; margin-top: 0.3rem; max-width: 68ch; }

.tax-card {
  background: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  padding: 1.1rem 1.25rem;
  margin-bottom: 1.25rem;
}
.tax-h2 {
  display: flex; align-items: center; gap: 0.5rem;
  font-size: 0.95rem; font-weight: 600; color: rgb(var(--fg-strong));
  margin-bottom: 0.9rem;
}
.tax-h2 :deep(svg) { color: var(--gold, #d4a734); }
.tax-count {
  font-family: var(--font-mono, monospace); font-size: 0.72rem;
  color: rgb(var(--fg-subtle)); background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default)); border-radius: 99px; padding: 0.05rem 0.5rem;
}
.tax-hint { color: rgb(var(--fg-muted)); font-size: 0.82rem; margin: -0.4rem 0 0.9rem; }
.tax-empty { color: rgb(var(--fg-subtle)); font-size: 0.85rem; padding: 0.6rem 0; }

.tax-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.tax-row {
  display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;
  padding: 0.55rem 0.7rem; border: 1px solid rgb(var(--line-default) / 0.7);
  border-radius: var(--radius-sm); background: rgb(var(--bg-inset) / 0.4);
}
.tax-slug {
  font-family: var(--font-mono, monospace); font-size: 0.8rem;
  color: #7dd3fc; background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.25); border-radius: var(--radius-sm);
  padding: 0.1rem 0.45rem; flex: none;
}
.tax-arrow { color: rgb(var(--fg-subtle)); flex: none; }
.tax-local { display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 600; color: rgb(var(--fg-default)); flex: 1; min-width: 0; }
.tax-localslug { font-family: var(--font-mono, monospace); font-size: 0.7rem; color: rgb(var(--fg-subtle)); font-weight: 400; }
.tax-n { font-family: var(--font-mono, monospace); font-size: 0.72rem; color: rgb(var(--fg-muted)); flex: none; }

.tax-add { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.tax-input {
  padding: 0.45rem 0.65rem; border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm); background: rgb(var(--bg-inset) / 0.5);
  color: rgb(var(--fg-default)); font-size: 0.83rem;
}
.tax-input--grow { flex: 1; min-width: 14ch; }
.tax-btn {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.45rem 0.8rem; border: 1px solid rgba(212, 167, 52, 0.5);
  border-radius: var(--radius-sm); background: rgba(212, 167, 52, 0.12);
  color: var(--gold, #d4a734); cursor: pointer; font-weight: 600; font-size: 0.82rem; flex: none;
}
.tax-btn:disabled { opacity: 0.45; cursor: default; }
.tax-remove {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.3rem 0.6rem; border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm); background: transparent;
  color: rgb(var(--fg-muted)); cursor: pointer; font-size: 0.76rem; flex: none;
}
.tax-remove:hover:not(:disabled) { color: #fca5a5; border-color: rgba(239, 68, 68, 0.4); }
.tax-remove:disabled { opacity: 0.5; cursor: default; }
</style>

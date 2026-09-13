<template>
  <!--
    Fields scanned by the catalogue's free-text search.

    Each field is served by its own full-text GIN index: ticking a box adds a
    branch to the query's OR, unticking removes it. This is therefore not a
    weighting setting but a scope one — an unticked field is not read at all.

    The title stays recommended in every case; unticking everything is not
    forbidden, but free-text search then returns nothing (infohash search and
    IMDb / TMDb / TVDB link search keep working, they do not go through this
    path).
  -->
  <div class="card">
    <div class="card-header">
      <div class="flex items-center gap-2">
        <Icon name="ph:magnifying-glass-bold" class="text-text-muted" />
        <h3 class="text-xs font-bold uppercase tracking-wider text-text-primary">
          {{ $t('admin.search.title') }}
        </h3>
      </div>
    </div>
    <div class="card-body space-y-6">
      <p class="text-xs text-text-muted leading-relaxed">
        {{ $t('admin.search.description') }}
      </p>

      <SettingsGroup
          :control-id="fid('fields')"
        :label="$t('admin.search.fields')"
        :description="$t('admin.search.fieldsHint')"
      >
        <div class="space-y-2">
          <label
            v-for="f in FIELDS"
            :key="f"
            class="flex items-start gap-3 cursor-pointer group"
          >
            <input
              :id="fid('fields')"
              v-model="fields"
              type="checkbox"
              :value="f"
              class="mt-0.5 accent-text-primary"
            />
            <span class="min-w-0">
              <span class="block text-sm text-text-primary">
                {{ $t(`admin.search.field.${f}`) }}
              </span>
              <span class="block text-xs text-text-muted leading-relaxed">
                {{ $t(`admin.search.fieldHint.${f}`) }}
              </span>
            </span>
          </label>
        </div>
      </SettingsGroup>

      <p v-if="fields.length === 0" class="text-xs text-warning leading-relaxed">
        {{ $t('admin.search.noneWarning') }}
      </p>

      <!-- Le catalogue : ce qu'un membre trouve en arrivant. -->
      <SettingsGroup
        :control-id="fid('catalogue-view')"
        :label="$t('admin.search.catalogue.view')"
        :description="$t('admin.search.catalogue.viewHint')"
      >
        <select
          :id="fid('catalogue-view')"
          v-model="catalogueView"
          class="rounded-md border border-border-field bg-bg-secondary px-2 py-1.5 text-sm text-text-primary"
        >
          <option v-for="v in VIEWS" :key="v" :value="v">{{ $t(`admin.search.catalogue.views.${v}`) }}</option>
        </select>
      </SettingsGroup>
      <SettingsGroup
        :control-id="fid('catalogue-sort')"
        :label="$t('admin.search.catalogue.sort')"
        :description="$t('admin.search.catalogue.sortHint')"
      >
        <select
          :id="fid('catalogue-sort')"
          v-model="catalogueSort"
          class="rounded-md border border-border-field bg-bg-secondary px-2 py-1.5 text-sm text-text-primary"
        >
          <option v-for="s in SORTS" :key="s" :value="s">{{ $t(`admin.search.catalogue.sorts.${s}`) }}</option>
        </select>
      </SettingsGroup>
      <SettingsGroup
        :control-id="fid('catalogue-size')"
        :label="$t('admin.search.catalogue.pageSize')"
        :description="$t('admin.search.catalogue.pageSizeHint')"
      >
        <input
          :id="fid('catalogue-size')"
          v-model.number="cataloguePageSize"
          type="number"
          min="10"
          max="50"
          step="5"
          class="w-24 rounded-md border border-border-field bg-bg-secondary px-2 py-1.5 text-sm text-text-primary"
        />
      </SettingsGroup>
      <SettingsGroup
        :control-id="fid(`catalogue-facets-${FACETS[0]}`)"
        :label="$t('admin.search.catalogue.facets')"
        :description="$t('admin.search.catalogue.facetsHint')"
      >
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label v-for="f in FACETS" :key="f" class="flex items-center gap-2 cursor-pointer text-sm text-text-primary">
            <input :id="fid(`catalogue-facets-${f}`)" v-model="catalogueFacets" type="checkbox" :value="f" class="accent-text-primary" />
            {{ $t(`admin.search.catalogue.facetNames.${f}`) }}
          </label>
        </div>
      </SettingsGroup>

      <SettingsGroup
          :control-id="fid('fuzzy')"
        :label="$t('admin.search.fuzzy')"
        :description="$t('admin.search.fuzzyHint')"
      >
        <label class="flex items-start gap-3 cursor-pointer">
          <input :id="fid('fuzzy')" v-model="fuzzy" type="checkbox" class="mt-0.5 accent-text-primary" />
          <span class="text-sm text-text-primary">
            {{ $t('admin.search.fuzzyLabel') }}
          </span>
        </label>
      </SettingsGroup>

      <button
        :disabled="loading || saved"
        class="w-full text-[10px] font-bold uppercase tracking-widest py-2.5 rounded transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        :class="
          saved
            ? 'bg-success text-white'
            : 'bg-text-primary text-bg-primary hover:opacity-90'
        "
        @click="save"
      >
        <Icon v-if="loading" name="ph:circle-notch" class="animate-spin" />
        <Icon v-else-if="saved" name="ph:check-bold" />
        {{
          loading
            ? $t('admin.registration.saving')
            : saved
              ? $t('admin.registration.saved')
              : $t('admin.registration.saveConfiguration')
        }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Les libellés de `SettingsGroup` ne désignaient aucun champ : ni `for`, ni
// imbrication. Voir `useFieldIds()`.
const fid = useFieldIds();

/** Same order as on the server side, most to least obvious to enable. */
const FIELDS = ['name', 'description', 'nfo', 'tags'] as const;
type Field = (typeof FIELDS)[number];

const fields = ref<Field[]>(['name', 'description']);
// On by default: without it, a typo returns an empty page.
const fuzzy = ref(true);
// Le catalogue : la vue et le tri à l'arrivée, la taille d'une page, les facettes du rail.
const VIEWS = ['grouped', 'simple'] as const;
const SORTS = ['auto', 'age', 'name', 'size', 'seeders', 'leechers', 'completed'] as const;
const FACETS = ['category', 'resolution', 'source', 'codec', 'language', 'hdr', 'audio', 'year', 'options'] as const;
const catalogueView = ref<(typeof VIEWS)[number]>('grouped');
const catalogueSort = ref<(typeof SORTS)[number]>('auto');
const cataloguePageSize = ref(20);
const catalogueFacets = ref<string[]>([...FACETS]);
const loading = ref(false);
const saved = ref(false);

const { data } = await useFetch<{
  searchFields?: Field[];
  searchFuzzy?: boolean;
  catalogueDefaultView?: (typeof VIEWS)[number];
  catalogueDefaultSort?: (typeof SORTS)[number];
  cataloguePageSize?: number;
  catalogueFacets?: string[];
}>('/api/admin/settings');
watch(
  data,
  (v) => {
    if (Array.isArray(v?.searchFields)) fields.value = [...v.searchFields];
    if (typeof v?.searchFuzzy === 'boolean') fuzzy.value = v.searchFuzzy;
    if (v?.catalogueDefaultView) catalogueView.value = v.catalogueDefaultView;
    if (v?.catalogueDefaultSort) catalogueSort.value = v.catalogueDefaultSort;
    if (typeof v?.cataloguePageSize === 'number') cataloguePageSize.value = v.cataloguePageSize;
    if (Array.isArray(v?.catalogueFacets)) catalogueFacets.value = [...v.catalogueFacets];
  },
  { immediate: true },
);

async function save() {
  loading.value = true;
  saved.value = false;
  try {
    // Reordered against FIELDS so the stored value is stable whatever order
    // the boxes were ticked in.
    await $fetch('/api/admin/settings', {
      method: 'PUT',
      body: {
        searchFields: FIELDS.filter((f) => fields.value.includes(f)),
        searchFuzzy: fuzzy.value,
        catalogueDefaultView: catalogueView.value,
        catalogueDefaultSort: catalogueSort.value,
        cataloguePageSize: Math.min(50, Math.max(10, Math.round(cataloguePageSize.value) || 20)),
        catalogueFacets: FACETS.filter((f) => catalogueFacets.value.includes(f)),
      },
    });
    saved.value = true;
    setTimeout(() => (saved.value = false), 2000);
  } finally {
    loading.value = false;
  }
}
</script>

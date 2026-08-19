<template>
  <!--
    Champs balayés par la recherche libre du catalogue.

    Chaque champ est servi par son propre index GIN plein-texte : cocher une
    case ajoute une branche au OR de la requête, la décocher la retire. Ce
    n'est donc pas un réglage de pondération mais de périmètre — un champ
    décoché n'est pas lu du tout.

    Le titre reste conseillé dans tous les cas ; tout décocher n'est pas
    interdit, mais la recherche libre ne rend alors plus rien (la recherche par
    infohash et par lien IMDb / TMDb / TVDB continue de fonctionner, elle ne
    passe pas par ce chemin).
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

      <SettingsGroup
        :label="$t('admin.search.fuzzy')"
        :description="$t('admin.search.fuzzyHint')"
      >
        <label class="flex items-start gap-3 cursor-pointer">
          <input v-model="fuzzy" type="checkbox" class="mt-0.5 accent-text-primary" />
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
/** Même ordre que côté serveur, du plus au moins évident à activer. */
const FIELDS = ['name', 'description', 'nfo', 'tags'] as const;
type Field = (typeof FIELDS)[number];

const fields = ref<Field[]>(['name', 'description']);
// Actif par défaut : sans lui, une faute de frappe rend une page vide.
const fuzzy = ref(true);
const loading = ref(false);
const saved = ref(false);

const { data } = await useFetch<{ searchFields?: Field[]; searchFuzzy?: boolean }>(
  '/api/admin/settings',
);
watch(
  data,
  (v) => {
    if (Array.isArray(v?.searchFields)) fields.value = [...v.searchFields];
    if (typeof v?.searchFuzzy === 'boolean') fuzzy.value = v.searchFuzzy;
  },
  { immediate: true },
);

async function save() {
  loading.value = true;
  saved.value = false;
  try {
    // On réordonne sur FIELDS pour que la valeur stockée soit stable quel que
    // soit l'ordre dans lequel les cases ont été cochées.
    await $fetch('/api/admin/settings', {
      method: 'PUT',
      body: {
        searchFields: FIELDS.filter((f) => fields.value.includes(f)),
        searchFuzzy: fuzzy.value,
      },
    });
    saved.value = true;
    setTimeout(() => (saved.value = false), 2000);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="card">
    <div class="card-header">
      <div class="dec-head">
        <div class="dec-head-left">
          <Icon name="ph:clock-counter-clockwise" class="dec-head-icon" />
          <h3 class="dec-head-title">{{ $t('mod.decisions.title') }}</h3>
        </div>

        <div class="dec-filters">
          <label class="dec-filter">
            <span class="field-label">{{ $t('mod.decisions.windowLabel') }}</span>
            <select v-model.number="days" class="input dec-select" @change="load()">
              <option :value="7">{{ $t('mod.decisions.window', { n: 7 }) }}</option>
              <option :value="30">{{ $t('mod.decisions.window', { n: 30 }) }}</option>
              <option :value="90">{{ $t('mod.decisions.window', { n: 90 }) }}</option>
            </select>
          </label>
          <label class="dec-filter">
            <span class="field-label">{{ $t('mod.decisions.target') }}</span>
            <select v-model="targetType" class="input dec-select" @change="load()">
              <option value="">{{ $t('mod.decisions.allTypes') }}</option>
              <option v-for="ty in TYPES" :key="ty" :value="ty">
                {{ $t(`mod.decisions.types.${ty}`) }}
              </option>
            </select>
          </label>
        </div>
      </div>
    </div>

    <div class="card-body">
      <p class="dec-tagline">{{ $t('mod.decisions.tagline') }}</p>

      <div v-if="loading" class="dec-state">
        <Icon name="ph:circle-notch" class="animate-spin" />
        {{ $t('common.loading') }}
      </div>

      <div v-else-if="error" class="dec-state dec-state--error" role="alert">
        <Icon name="ph:warning-octagon" class="dec-state-glyph" />
        {{ $t('mod.decisions.error') }}
        <button type="button" class="btn btn-secondary btn-sm" @click="load()">
          {{ $t('common.retry') }}
        </button>
      </div>

      <div v-else-if="rows.length === 0" class="dec-state">
        <Icon name="ph:tray" class="dec-state-glyph" />
        {{ $t('mod.decisions.empty') }}
      </div>

      <template v-else>
        <ol class="dec-list">
          <li v-for="r in rows" :key="r.id" class="dec-row">
            <span class="dec-action">{{ r.action }}</span>
            <span class="dec-target">
              <span class="dec-target-type">{{ targetLabel(r.targetType) }}</span>
              <span class="dec-target-label" :title="r.targetLabel ?? r.targetId ?? ''">
                {{ r.targetLabel || r.targetId || '—' }}
              </span>
            </span>
            <time class="dec-when" :datetime="r.createdAt" :title="new Date(r.createdAt).toLocaleString()">
              {{ formatDate(r.createdAt) }}
            </time>
          </li>
        </ol>

        <Pager
          v-if="pagination.pages > 1"
          :page="pagination.page"
          :pages="pagination.pages"
          @go="go"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * « Qu'est-ce que j'ai décidé la semaine dernière ? »
 *
 * Le journal d'audit couvre structurellement `/api/mod/**`, mais il se lit
 * avec `requireAdminSession` : un modérateur REMPLIT la table et ne peut pas
 * la lire. Le choix se défend pour un registre d'autorité — il n'appartient
 * pas à celui qu'il surveille.
 *
 * Ce que cette page ouvre n'est pas le registre : c'est la projection de SES
 * propres lignes. Un modérateur ne voit pas le travail des autres, et le
 * registre complet reste chez les administrateurs.
 */
import { ref, onMounted } from 'vue';
import Pager from '~/components/search/Pager.vue';

const { t } = useI18n();

definePageMeta({ title: 'My decisions' });

interface Row {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  createdAt: string;
}

const TYPES = ['torrent', 'user', 'report', 'ticket', 'setting'] as const;

const rows = ref<Row[]>([]);
const loading = ref(true);
const days = ref(30);
const targetType = ref('');
const pagination = ref({ page: 1, pages: 1, total: 0 });
// Un échec de chargement ne doit pas se lire « rien sur cette période » : un
// 403 ou une coupure réseau racontaient alors exactement le contraire de ce
// qui s'était passé.
const error = ref(false);

/** Les types de cible sont des identifiants ; la page, elle, est traduite. */
function targetLabel(ty: string | null): string {
  if (!ty) return '—';
  const key = `mod.decisions.types.${ty}`;
  const label = t(key);
  // Un type que l'API ajouterait demain n'a pas de clé : on montre alors
  // l'identifiant brut plutôt qu'un chemin de traduction.
  return label === key ? ty : label;
}

async function load(page = 1) {
  loading.value = true;
  error.value = false;
  try {
    const q = new URLSearchParams({ page: String(page), days: String(days.value) });
    if (targetType.value) q.set('targetType', targetType.value);
    const res = await $fetch<{ data: Row[]; pagination: typeof pagination.value }>(
      `/api/mod/my-decisions?${q}`
    );
    rows.value = res.data;
    pagination.value = res.pagination;
  } catch {
    rows.value = [];
    error.value = true;
  } finally {
    loading.value = false;
  }
}

const go = (p: number) => load(p);
onMounted(() => load());

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<style scoped>
.dec-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 0.875rem;
  width: 100%;
}
.dec-head-left {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
}
.dec-head-icon {
  font-size: 1.1rem;
  color: rgb(var(--accent-warm-text));
}
.dec-head-title {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: calc(0.18em * var(--tracking-scale));
  color: rgb(var(--fg-strong));
}
.dec-filters {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.dec-filter {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.dec-select {
  min-height: 2rem;
  padding-block: 0.25rem;
  font-size: 0.75rem;
}
.dec-tagline {
  margin: 0 0 0.9rem;
  font-size: 0.7813rem;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
}

.dec-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  color: rgb(var(--fg-muted));
  font-size: 0.8125rem;
}
.dec-state-glyph {
  font-size: 2rem;
  color: rgb(var(--fg-subtle));
}
.dec-state--error .dec-state-glyph {
  color: rgb(var(--danger));
}

.dec-list {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  display: grid;
  gap: 0.3rem;
}
.dec-row {
  display: grid;
  grid-template-columns: minmax(9rem, auto) 1fr auto;
  align-items: baseline;
  gap: 0.5rem 0.85rem;
  padding: 0.5rem 0.7rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
}
.dec-action {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  overflow-wrap: anywhere;
}
.dec-target {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  min-width: 0;
}
.dec-target-type {
  flex: none;
  padding: 0.02rem 0.35rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-pill);
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  text-transform: uppercase;
  letter-spacing: calc(0.1em * var(--tracking-scale));
  color: rgb(var(--fg-subtle));
}
.dec-target-label {
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dec-when {
  font-family: var(--font-mono);
  font-size: 0.6563rem;
  color: rgb(var(--fg-subtle));
  white-space: nowrap;
}

/* Sous 640 px la grille à trois colonnes écrase la cible : on empile. */
@media (max-width: 640px) {
  .dec-row {
    grid-template-columns: 1fr;
  }
  .dec-when {
    justify-self: start;
  }
}
</style>

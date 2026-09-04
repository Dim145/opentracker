<script setup lang="ts">
/**
 * Le pointeur de remplacement d'une release, dans les deux sens.
 *
 * # Deux états, jamais les deux
 *
 * Ou bien la release EST déjà remplacée — on le dit, et on offre de lever le
 * marquage ; ou bien elle ne l'est pas — on demande le hash du remplaçant et
 * une raison. Il n'y a rien à afficher entre les deux, donc rien à empiler.
 *
 * # Pourquoi un hash et pas un sélecteur
 *
 * C'est ce que le modérateur a sous les yeux : il regarde la page de la
 * nouvelle release dans l'autre onglet. Un champ de recherche l'obligerait à
 * retrouver par le nom ce qu'il tient déjà par l'identifiant.
 *
 * Marquer ne retire rien : l'ancienne reste téléchargeable et garde son swarm.
 * Ce qui change, c'est que les deux pages disent laquelle est la courante.
 *
 * # Le libellé
 *
 * Les deux champs restent ENVELOPPÉS dans leur `<label>` — c'est ce qui leur
 * donne leur nom accessible, et `test/formControlNames.test.ts` casse la
 * construction si l'un d'eux en sort sans `for`/`id` apparié.
 */
const props = withDefaults(
  defineProps<{
    /** Le hash, pour `PUT|DELETE /api/mod/torrents/:hash/supersede`. */
    hash: string;
    /** Ce qui remplace cette release, quand quelque chose la remplace. */
    supersededBy?: { name?: string | null } | null;
  }>(),
  { supersededBy: null },
);

const emit = defineEmits<{
  /** Une écriture a abouti : la page peut recharger les supersessions. */
  (e: 'changed'): void;
}>();

const { t } = useI18n();
const notifications = useNotificationStore();

const form = reactive({ hash: '', reason: '' });
const busy = ref(false);

/** Un infohash SHA-1, c'est 40 caractères. En deçà, le bouton reste inerte. */
const HASH_LENGTH = 40;

async function save() {
  busy.value = true;
  try {
    await $fetch(`/api/mod/torrents/${props.hash}/supersede`, {
      method: 'PUT',
      body: {
        supersededById: form.hash.trim().toLowerCase(),
        reason: form.reason.trim() || undefined,
      },
    });
    form.hash = '';
    form.reason = '';
    emit('changed');
    notifications.success(t('torrents.detail.supersede.saved'));
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; message?: string };
    notifications.error(
      e?.data?.message || e?.message || t('torrents.detail.supersede.failed'),
    );
  } finally {
    busy.value = false;
  }
}

async function clear() {
  busy.value = true;
  try {
    await $fetch(`/api/mod/torrents/${props.hash}/supersede`, { method: 'DELETE' });
    emit('changed');
    notifications.success(t('torrents.detail.supersede.cleared'));
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; message?: string };
    notifications.error(
      e?.data?.message || e?.message || t('torrents.detail.supersede.failed'),
    );
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="section">
    <SectionHead
      :title="$t('torrents.detail.supersede.staffTitle')"
      icon="ph:arrow-bend-right-up"
    />

    <p class="supersede-lede">{{ $t('torrents.detail.supersede.staffLede') }}</p>

    <!-- Déjà remplacée : il n'y a plus qu'une chose à faire, la lever. -->
    <div v-if="supersededBy" class="supersede-actions">
      <p class="supersede-lede supersede-lede--inline">
        {{ $t('torrents.detail.supersede.currently', { name: supersededBy.name ?? '' }) }}
      </p>
      <button type="button" class="btn-ghost" :disabled="busy" @click="clear">
        {{ $t('torrents.detail.supersede.clear') }}
      </button>
    </div>

    <div v-else class="supersede-grid">
      <label class="supersede-field supersede-field--hash">
        <span class="field-label">{{ $t('torrents.detail.supersede.hashLabel') }}</span>
        <input
          v-model="form.hash"
          type="text"
          class="input"
          autocomplete="off"
          spellcheck="false"
          :placeholder="$t('torrents.detail.supersede.hashPlaceholder')"
        />
      </label>
      <label class="supersede-field supersede-field--reason">
        <span class="field-label">{{ $t('torrents.detail.supersede.reasonLabel') }}</span>
        <input v-model="form.reason" type="text" class="input" maxlength="500" />
      </label>
      <button
        type="button"
        class="btn btn-secondary"
        :disabled="busy || form.hash.length !== HASH_LENGTH"
        @click="save"
      >
        <Icon
          :name="busy ? 'ph:circle-notch' : 'ph:arrow-bend-right-up-bold'"
          :class="{ 'animate-spin': busy }"
        />
        {{ $t('torrents.detail.supersede.mark') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
/* Copie locale : `.section` appartenait à la page, pas au CSS global. */
.section {
  /* Même bloc que dans `AdminSwarmTable.vue`, `SupersedeForm.vue` et
     `FederationSwarmToggle.vue` : quatre copies d'un motif que la page
     possédait et que `main.css` ne connaît pas. Le rail bleu est la marque de
     la famille « exploitation » ; il est ajouté aux quatre à l'identique, et
     l'en-tête de `AdminSwarmTable.vue` porte la mesure. */
  --section-tone: var(--chart-1);
  padding: 1rem 1.1rem;
  border: 1px solid rgb(var(--line-default));
  border-left: 3px solid rgb(var(--chart-1) / 0.55);
  border-radius: var(--radius-lg);
  background: rgb(var(--bg-surface));
}

.supersede-lede {
  max-width: 62ch;
  margin: 0 0 1rem;
  font-size: 0.8125rem;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
}
/* Sur la ligne « déjà remplacée », la phrase et le bouton se répondent :
   la marge basse ferait un décalage vertical entre les deux. */
.supersede-lede--inline {
  margin: 0;
}

.supersede-grid {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.85rem;
}
.supersede-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 11rem;
}
.supersede-field--hash {
  flex: 1 1 22rem;
}
.supersede-field--reason {
  flex: 1 1 16rem;
}

.supersede-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 1rem;
}

@media (max-width: 40rem) {
  .supersede-field {
    flex: 1 1 100%;
    min-width: 0;
  }
}
</style>

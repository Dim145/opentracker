<script setup lang="ts">
import { datetimeLocalToIso, isoToDatetimeLocal } from '~/utils/format';

/**
 * Les multiplicateurs d'une release, et son épinglage.
 *
 * # Deux droits dans un seul formulaire
 *
 * Épingler est éditorial : n'importe quel modérateur peut le faire. Les
 * multiplicateurs frappent du crédit, et seul un administrateur y touche. Le
 * formulaire dit lequel est lequel en désactivant les trois champs plutôt qu'en
 * cachant un 403 derrière un bouton qui a l'air disponible.
 *
 * Et `save` envoie **uniquement** `isSticky` quand celui qui l'actionne n'est
 * pas administrateur : la route refuse les multiplicateurs, donc les envoyer
 * quand même transformerait chaque épinglage en 403.
 *
 * # Pourquoi l'état du formulaire n'est pas la ligne
 *
 * Un `datetime-local` veut `AAAA-MM-JJTHH:mm` en heure LOCALE, la ligne porte
 * un instant ISO. Les deux ne peuvent pas partager une référence sans que l'une
 * soit fausse. On amorce une fois, on convertit à l'enregistrement, et la
 * conversion vit à un seul endroit — `toISOString().slice(0, 16)` écrivait
 * l'heure UTC dans un champ qui la relit comme locale, donc l'échéance reculait
 * d'un fuseau à chaque enregistrement.
 *
 * # Les libellés
 *
 * Chaque contrôle reste ENVELOPPÉ dans son `<label>`. C'est ce qui lui donne
 * son nom accessible, et `test/formControlNames.test.ts` casse la construction
 * si l'un d'eux en sort sans un `for`/`id` apparié pour le remplacer.
 */
const props = withDefaults(
  defineProps<{
    /** Le hash, pour `PUT /api/mod/torrents/:hash/buffs`. */
    hash: string;
    /** La ligne, dont le formulaire s'amorce. Tout est optionnel : le détail
     *  arrive en `Record<string, any>` et rien ici n'est garanti présent. */
    torrent?: {
      downloadMultiplier?: number;
      uploadMultiplier?: number;
      multipliersUntil?: string | null;
      isSticky?: boolean;
    } | null;
    /** Un modérateur voit le formulaire ; seul un administrateur l'édite. */
    isAdmin?: boolean;
  }>(),
  { torrent: null, isAdmin: false },
);

const emit = defineEmits<{
  /** Une écriture a abouti : la page peut recharger la ligne. */
  (e: 'changed'): void;
}>();

const { t } = useI18n();
const notifications = useNotificationStore();

const form = reactive({
  downloadMultiplier: 100,
  uploadMultiplier: 100,
  until: '',
  isSticky: false,
});
const busy = ref(false);

watch(
  () => props.torrent,
  (row) => {
    if (!row) return;
    form.downloadMultiplier = row.downloadMultiplier ?? 100;
    form.uploadMultiplier = row.uploadMultiplier ?? 100;
    form.isSticky = row.isSticky ?? false;
    form.until = isoToDatetimeLocal(row.multipliersUntil);
  },
  // Pas de `deep` : la page remplace l'objet entier à chaque rechargement, et
  // c'est ce remplacement — pas une mutation interne — qui doit ré-amorcer le
  // formulaire. En profondeur, une frappe dans un autre champ de la ligne
  // écraserait ce que l'exploitant est en train de saisir.
  { immediate: true },
);

/**
 * La release porte-t-elle un buff, oui ou non.
 *
 * Même règle que le badge : un buff échu se lit comme aucun buff, et `1× / 1×`
 * n'en est pas un. C'est ce qui décide si « retirer le buff » a quelque chose
 * à retirer.
 */
const hasBuff = computed(() => {
  const row = props.torrent;
  if (!row || row.downloadMultiplier === undefined || row.uploadMultiplier === undefined) {
    return false;
  }
  if (row.multipliersUntil && new Date(row.multipliersUntil) <= new Date()) return false;
  return !(row.downloadMultiplier === 100 && row.uploadMultiplier === 100);
});

async function put(body: Record<string, unknown>) {
  busy.value = true;
  try {
    await $fetch(`/api/mod/torrents/${props.hash}/buffs`, { method: 'PUT', body });
    emit('changed');
    notifications.success(t('torrents.detail.buffs.saved'));
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; message?: string };
    notifications.error(
      e?.data?.message || e?.message || t('torrents.detail.buffs.failed'),
    );
  } finally {
    busy.value = false;
  }
}

function save() {
  // Un modérateur n'envoie QUE l'épingle. Les multiplicateurs seraient refusés.
  if (!props.isAdmin) return put({ isSticky: form.isSticky });
  return put({
    downloadMultiplier: form.downloadMultiplier,
    uploadMultiplier: form.uploadMultiplier,
    until: datetimeLocalToIso(form.until),
    isSticky: form.isSticky,
  });
}

function clear() {
  return put({ downloadMultiplier: 100, uploadMultiplier: 100, until: null });
}
</script>

<template>
  <section class="section">
    <SectionHead :title="$t('torrents.detail.buffs.title')" icon="ph:sparkle" />

    <p class="buffs-lede">{{ $t('torrents.detail.buffs.lede') }}</p>

    <div class="buffs-grid">
      <label class="buffs-field">
        <span class="field-label">{{ $t('torrents.detail.buffs.download') }}</span>
        <select v-model.number="form.downloadMultiplier" class="input" :disabled="!isAdmin">
          <option :value="0">0× — {{ $t('torrent.buff.freeleech') }}</option>
          <option :value="50">0.5× — {{ $t('torrent.buff.silverleech') }}</option>
          <option :value="100">1× — {{ $t('torrents.detail.buffs.normal') }}</option>
        </select>
      </label>

      <label class="buffs-field">
        <span class="field-label">{{ $t('torrents.detail.buffs.upload') }}</span>
        <select v-model.number="form.uploadMultiplier" class="input" :disabled="!isAdmin">
          <option :value="100">1× — {{ $t('torrents.detail.buffs.normal') }}</option>
          <option :value="150">1.5×</option>
          <option :value="200">2× — {{ $t('torrent.buff.doubleUpload') }}</option>
          <option :value="300">3×</option>
        </select>
      </label>

      <label class="buffs-field">
        <span class="field-label">{{ $t('torrents.detail.buffs.until') }}</span>
        <input v-model="form.until" type="datetime-local" class="input" :disabled="!isAdmin" />
        <span class="buffs-hint">{{ $t('torrents.detail.buffs.untilHint') }}</span>
      </label>

      <!-- Le `<span>` vide n'est pas un oubli : il rend à la case la même boîte
           que ses voisins, dont le libellé occupe cette place. Voir le style. -->
      <div class="buffs-field buffs-field--toggle">
        <span class="field-label" aria-hidden="true">&nbsp;</span>
        <label class="buffs-toggle">
          <input v-model="form.isSticky" type="checkbox" />
          <span>{{ $t('torrents.detail.buffs.pin') }}</span>
        </label>
      </div>
    </div>

    <div class="buffs-actions">
      <button type="button" class="btn btn-secondary" :disabled="busy" @click="save">
        <Icon
          :name="busy ? 'ph:circle-notch' : 'ph:check-bold'"
          :class="{ 'animate-spin': busy }"
        />
        {{ $t('torrents.detail.buffs.save') }}
      </button>
      <button
        v-if="hasBuff"
        type="button"
        class="btn-ghost"
        :disabled="busy || !isAdmin"
        @click="clear"
      >
        {{ $t('torrents.detail.buffs.clear') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
/* `.section` était une classe de la PAGE, pas une classe globale. Chaque
   composant sorti d'elle porte sa propre copie — c'est le piège dans lequel
   `.tool-btn` est tombée ici : utilisée par cinq fichiers, définie dans deux. */
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

.buffs-lede {
  max-width: 62ch;
  margin: 0 0 1rem;
  font-size: 0.8125rem;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
}
.buffs-grid {
  display: flex;
  flex-wrap: wrap;
  /*
   * Par le HAUT, et c'était `flex-end`.
   *
   * Aligner les bas de groupes marche tant que les groupes font la même
   * hauteur. Celui de « Fin » porte une aide sous son champ — 83 px contre 59
   * — donc son libellé remontait de vingt-quatre pixels au-dessus de ceux de
   * « Téléchargement » et « Envoi ». Un champ décalé dans une rangée de trois.
   *
   * Par le haut, les trois libellés s'alignent, les trois contrôles aussi
   * (les blocs de libellé ont la même hauteur), et seule l'aide dépasse en
   * dessous — là où elle doit être.
   */
  align-items: flex-start;
  gap: 0.85rem;
}
.buffs-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 11rem;
}
.buffs-hint {
  font-size: 0.7rem;
  color: rgb(var(--fg-subtle));
}
/*
 * La case n'a pas de libellé au-dessus, donc l'alignement par le haut la
 * mettait au niveau des LIBELLÉS et non des contrôles. Plutôt qu'un décalage
 * calculé à la main — l'ancien `padding-bottom: 0.55rem` était exactement ça,
 * la compensation du `flex-end` d'avant — elle reçoit un libellé VIDE : même
 * structure que ses voisins, donc même géométrie, sans un seul nombre magique.
 */
.buffs-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8125rem;
}
.buffs-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: 1rem;
}

@media (max-width: 40rem) {
  .buffs-field {
    flex: 1 1 100%;
    min-width: 0;
  }
}
/* Elle ne porte pas de champ : la largeur minimale des autres colonnes la
   ferait passer seule à la ligne bien avant qu'il ne le faille. */
.buffs-field--toggle {
  min-width: 0;
}
</style>

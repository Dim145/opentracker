<script setup lang="ts">
/**
 * Partager le swarm de CE torrent avec les instances partenaires, ou non.
 *
 * # Ce que le bouton engage
 *
 * Activé, les pairs de ce torrent peuvent être annoncés aux partenaires avec
 * qui l'instance a un lien de swarm — et mélangés depuis eux. Cela partage des
 * IP de pairs : le réglage est désactivé par défaut et se prend torrent par
 * torrent, jamais globalement.
 *
 * # Deux gardes, pas une
 *
 * L'appelant ne monte ce composant que si l'exploitant peut éditer la release
 * ET que l'instance est fédérée. Sur une instance non fédérée il n'y a
 * personne AVEC qui partager, et proposer l'interrupteur n'inviterait qu'une
 * question : pourquoi ne fait-il rien ?
 *
 * # L'état local
 *
 * `enabled` amorce la référence interne et ne la pilote pas : en cas d'échec du
 * PUT on garde l'état visuel précédent plutôt que d'annoncer un changement qui
 * n'a pas eu lieu.
 */
const props = withDefaults(
  defineProps<{
    /** Le hash, pour `PUT /api/torrents/:hash/federate-swarm`. */
    hash: string;
    /** L'état stocké sur la ligne, qui amorce l'interrupteur. */
    enabled?: boolean;
  }>(),
  { enabled: false },
);

const on = ref(false);
const busy = ref(false);

watch(
  () => props.enabled,
  (v) => {
    on.value = !!v;
  },
  { immediate: true },
);

async function toggle() {
  const next = !on.value;
  if (!props.hash) return;
  busy.value = true;
  try {
    await $fetch(`/api/torrents/${props.hash}/federate-swarm`, {
      method: 'PUT',
      body: { enabled: next },
    });
    on.value = next;
  } catch {
    /* on garde l'état visuel précédent */
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="section">
    <SectionHead :title="$t('torrents.detail.fedSwarm.title')" icon="ph:broadcast" />

    <div class="fed-swarm">
      <p class="fed-swarm__desc">{{ $t('torrents.detail.fedSwarm.desc') }}</p>
      <button type="button" class="btn btn-secondary" :disabled="busy" @click="toggle">
        <Icon :name="on ? 'ph:broadcast-bold' : 'ph:broadcast'" />
        {{ on ? $t('torrents.detail.fedSwarm.on') : $t('torrents.detail.fedSwarm.off') }}
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

/* Ces trois règles étaient des attributs `style` en ligne sur la page. Sorties
   ici, elles sont surchargeables et lisibles — et la taille de police repasse
   par une feuille, donc par `--ui-scale`. */
.fed-swarm {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
}
.fed-swarm__desc {
  max-width: 62ch;
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
}
</style>

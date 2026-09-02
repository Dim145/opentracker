<template>
  <!-- Tiny operator-facing chip that surfaces a category's canonical
       media type. Rendered next to the slug in the admin Categories
       tree so the operator can audit at a glance which rows opt into
       /movie vs /tv on the upload form. Hidden when the type is null
       (i.e. the heuristic decides). -->
  <span
    v-if="
      type === 'movie' ||
        type === 'tv' ||
        type === 'game' ||
        type === 'book'
    "
    class="type-badge"
    :class="`type-badge--${type}`"
  >
    <Icon
      :name="
        type === 'movie'
          ? 'ph:film-strip-fill'
          : type === 'tv'
            ? 'ph:television-fill'
            : type === 'game'
              ? 'ph:game-controller-fill'
              : 'ph:book-open-text-fill'
      "
      class="type-badge__icon"
    />
    {{ type }}
  </span>
</template>

<script setup lang="ts">
defineProps<{
  type?: 'movie' | 'tv' | 'game' | 'book' | null;
}>();
</script>

<style scoped>
.type-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.05rem 0.4rem;
  border-radius: var(--radius-xs);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  font-weight: 700;
  letter-spacing: calc(0.16em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  line-height: 1.45;
}
.type-badge__icon {
  font-size: 0.625rem;
}
/* Two distinct accents — gold for /movie, cyan for /tv — match the
   palette used in the admin KPI cards elsewhere in the app. */
  /* La teinte reste sur le fond et la bordure — donc l'identité média
     (IMDb, TMDb) et la distinction de catégorie survivent — mais le LIBELLÉ
     passe sur un jeton de premier plan. Une couleur de marque n'a pas de raison
     d'être lisible sur les deux thèmes : `#f5c518` sur blanc mesure 1,50:1.
     C'est exactement ce que `tagBadgeStyle()` fait déjà pour les tags, où la
     couleur est choisie par un opérateur et où le texte reste donc toujours
     lisible. */
.type-badge--movie {
  color: rgb(var(--fg-default));
  border-color: rgba(245, 197, 24, 0.4);
  background: rgba(245, 197, 24, 0.08);
}
.type-badge--tv {
  color: rgb(var(--info));  /* jeton sémantique : cette teinte était figée sur le thème sombre */
  border-color: rgba(52, 212, 216, 0.4);
  background: rgba(52, 212, 216, 0.08);
}
.type-badge--game {
  color: rgb(var(--fg-default));
  border-color: rgba(167, 139, 250, 0.4);
  background: rgba(167, 139, 250, 0.08);
}
.type-badge--book {
  color: rgb(var(--fg-default));
  border-color: rgba(217, 119, 6, 0.4);
  background: rgba(217, 119, 6, 0.08);
}
</style>

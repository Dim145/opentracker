<template>
  <div class="md:grid md:grid-cols-3 md:gap-6 py-4 border-b border-border/50 last:border-0">
    <div class="md:col-span-1 space-y-1">
      <!--
        Un `<label>` seulement quand il désigne quelque chose.

        C'était toujours un `<label>`, et jamais avec un `for` : le composant ne
        voit pas ce que l'appelant met dans son emplacement, donc il ne pouvait
        pas le désigner. Trente-cinq réglages d'administration s'annonçaient
        ainsi « liste » ou « saisie de texte » sans nom, et cliquer sur le
        libellé ne donnait pas le focus. L'appelant passe désormais
        l'identifiant du champ qu'il rend — voir `useFieldIds()` — et sans lui
        c'est un `<span>`, parce qu'un `<label>` qui ne désigne rien est un
        paragraphe stylé qui se fait passer pour un libellé.
      -->
      <component
        :is="controlId ? 'label' : 'span'"
        :for="controlId"
        class="text-[10px] font-bold uppercase tracking-widest text-text-muted block"
      >
        {{ label }}
      </component>
      <p v-if="description" class="text-xs text-text-muted leading-relaxed">
        {{ description }}
      </p>
    </div>
    <div class="mt-2 md:mt-0 md:col-span-2">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label: string;
  description?: string;
  /** L'`id` du champ que cet emplacement rend, quand il y en a exactement un
   *  et qu'il est natif. Laisser vide pour un groupe de contrôles ou pour un
   *  emplacement qui n'en contient aucun. */
  controlId?: string;
}>();
</script>

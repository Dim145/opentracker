<template>
  <FederationOff v-if="!federationEnabled" />
  <div v-else class="masks">
    <!-- Le titre vient de la bande de `mod.vue`, comme sur les huit autres
         pages de la console. Cette page portait le sien, si bien que la bande
         affichait « TABLEAU DE BORD » juste au-dessus de « Masques
         fédération ». -->
    <!-- Add a mask by hand (a moderator who knows the id / hash / DID). Most
         masks will come from resolving a report, but this is the direct lever. -->
    <form class="masks-add" @submit.prevent="add">
      <select v-model="form.scope" class="masks-input">
        <option value="record">{{ $t('mod.masks.scope.record') }}</option>
        <option value="infohash">{{ $t('mod.masks.scope.infohash') }}</option>
        <option value="author">{{ $t('mod.masks.scope.author') }}</option>
        <!-- Everything an instance signed, whoever hands it to us. Blocking a
             peer removes it from the trusted issuers, but a still-active
             partner that took its records first-hand can relay them, and those
             copies arrive under the RELAY's peer id with the blocked
             instance's DID as `issuer`. This is the read-path lever for that;
             `relay.ts` refuses them on the way in. -->
        <option value="issuer">{{ $t('mod.masks.scope.issuer') }}</option>
      </select>
      <input
        v-model="form.value"
        class="masks-input masks-input--grow"
        :placeholder="$t('mod.masks.valuePlaceholder')"
      />
      <input
        v-model="form.reason"
        class="masks-input masks-input--grow"
        :placeholder="$t('mod.masks.reasonPlaceholder')"
      />
      <button class="masks-btn" :disabled="busy || !form.value">
        <Icon name="ph:eye-slash-bold" /> {{ $t('mod.masks.hide') }}
      </button>
    </form>

    <p v-if="!masks.length" class="masks-empty">{{ $t('mod.masks.empty') }}</p>

    <ul v-else class="masks-list">
      <li v-for="m in masks" :key="m.id" class="masks-row">
        <!-- La portée, en toutes lettres. La pastille imprimait la valeur brute
             de l'énumération (`infohash`, `issuer`) alors que les libellés
             existaient déjà pour le formulaire juste au-dessus. -->
        <span class="masks-scope" :class="`masks-scope--${m.scope}`">
          {{ $t(`mod.masks.scopeShort.${m.scope}`) }}
        </span>
        <span class="masks-val">
          <span class="masks-name">{{ m.sampleName || $t('mod.masks.noSample') }}</span>
          <code class="masks-code">{{ m.value }}</code>
        </span>
        <span v-if="m.reason" class="masks-reason">{{ m.reason }}</span>
        <span class="masks-by">{{ m.createdByName || '—' }}</span>
        <button class="masks-lift" :disabled="lifting.has(m.id)" @click="lift(m.id)">
          <Icon name="ph:eye-bold" /> {{ $t('mod.masks.lift') }}
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  middleware: 'moderator' as any,
});
const { t } = useI18n();
const notifications = useNotificationStore();

/** Le message du serveur quand il en donne un, le nôtre sinon. */
function reason(err: unknown): string {
  const e = err as { data?: { message?: string }; message?: string };
  return e?.data?.message || e?.message || t('common.errors.generic');
}

const branding = await useBranding();
const federationEnabled = computed(() =>
  Boolean(branding.value?.federationEnabled),
);


interface Mask {
  id: string;
  scope: string;
  value: string;
  reason: string | null;
  createdByName: string | null;
  sampleName: string | null;
}

const { data, refresh } = await useFetch<{ masks: Mask[] }>(
  '/api/mod/federation/masks',
  // immediate: nothing is mirrored to mask when federation is off.
  { default: () => ({ masks: [] }), immediate: federationEnabled.value },
);
const masks = computed(() => data.value?.masks ?? []);

const form = reactive({ scope: 'infohash', value: '', reason: '' });
const busy = ref(false);
const lifting = ref(new Set<string>());

async function add(): Promise<void> {
  if (!form.value) return;
  busy.value = true;
  try {
    await $fetch('/api/mod/federation/masks', {
      method: 'POST',
      body: { scope: form.scope, value: form.value.trim(), reason: form.reason || null },
    });
    form.value = '';
    form.reason = '';
    await refresh();
  } catch (err) {
    // Le `catch` vide comptait sur « le formulaire reste en place » pour dire
    // l'échec. Un formulaire qui ne se vide pas ressemble exactement à un
    // formulaire qu'on vient de remplir : le modérateur repartait en croyant
    // avoir masqué la release.
    notifications.error(t('mod.masks.addFailed', { reason: reason(err) }));
  } finally {
    busy.value = false;
  }
}

async function lift(id: string): Promise<void> {
  lifting.value = new Set(lifting.value).add(id);
  try {
    await $fetch(`/api/mod/federation/masks/${id}`, { method: 'DELETE' });
    notifications.success(t('mod.masks.lifted'));
    await refresh();
  } catch (err) {
    // Idem : la ligne restait, ce qui est aussi ce qu'elle fait quand la levée
    // réussit et que le rafraîchissement n'a pas encore répondu.
    notifications.error(t('mod.masks.liftFailed', { reason: reason(err) }));
  } finally {
    const next = new Set(lifting.value);
    next.delete(id);
    lifting.value = next;
  }
}
</script>

<style scoped>
.masks { max-width: 900px; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
.masks-add { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.5rem; }
.masks-input { padding: 0.5rem 0.7rem; border: 1px solid rgb(var(--line-default)); border-radius: var(--radius-lg); background: rgb(var(--bg-inset) / 0.5); color: rgb(var(--fg-default)); font-size: 0.85rem; }
.masks-input--grow { flex: 1; min-width: 12ch; }
.masks-btn { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.5rem 0.9rem; border: 1px solid rgb(var(--accent) / 0.6); border-radius: var(--radius-lg); background: rgb(var(--accent) / 0.12); color: rgb(var(--accent)); cursor: pointer; font-weight: 600; font-size: 0.85rem; }
.masks-btn:disabled { opacity: 0.5; cursor: default; }
.masks-empty { color: rgb(var(--fg-muted)); text-align: center; padding: 2rem 0; }
.masks-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.masks-row { display: flex; align-items: center; gap: 0.7rem; padding: 0.6rem 0.8rem; border: 1px solid rgb(var(--line-default) / 0.7); border-radius: var(--radius-lg); background: rgb(var(--bg-inset) / 0.4); }
.masks-scope { text-transform: uppercase; font-size: 0.65rem; letter-spacing: calc(0.05em * var(--tracking-scale)); padding: 0.15rem 0.45rem; border-radius: var(--radius-sm); background: rgb(var(--line-default) / 0.6); color: rgb(var(--fg-muted)); flex: none; }
.masks-scope--author { background: rgb(var(--warning) / 0.2); color: rgb(var(--warning)); }
/* An issuer mask hides everything one instance signed, whoever serves it —
   the widest of the four, so it reads as the strongest. */
.masks-scope--issuer { background: rgb(var(--danger) / 0.2); color: rgb(var(--danger)); }
.masks-val { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.masks-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.masks-code { font-family: var(--font-mono); font-size: 0.7rem; color: rgb(var(--fg-subtle)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.masks-reason { color: rgb(var(--fg-muted)); font-size: 0.8rem; font-style: italic; }
.masks-by { color: rgb(var(--fg-subtle)); font-size: 0.8rem; flex: none; }
.masks-lift { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.3rem 0.6rem; border: 1px solid rgb(var(--line-default)); border-radius: var(--radius-md); background: transparent; color: rgb(var(--fg-muted)); cursor: pointer; font-size: 0.78rem; flex: none; }
.masks-lift:hover:not(:disabled) { color: rgb(var(--fg-default)); border-color: rgb(var(--accent) / 0.5); }
.masks-lift:disabled { opacity: 0.5; cursor: default; }
</style>

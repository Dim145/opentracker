<template>
  <Teleport to="body">
    <Transition name="modp-fade">
      <!-- Le voile n'existe QUE sous le point de rupture. Au-dessus, la file
           reste lisible et utilisable à côté du panneau : c'est un plan de
           travail maître-détail, pas une boîte de dialogue. -->
      <div
        v-if="open && narrow"
        class="modp-scrim"
        aria-hidden="true"
        @click="requestClose"
      />
    </Transition>

    <Transition name="modp-slide">
      <aside
        v-if="open && row"
        ref="panel"
        class="modp"
        :class="{ 'modp--narrow': narrow }"
        :role="narrow ? 'dialog' : 'complementary'"
        :aria-modal="narrow ? 'true' : undefined"
        :aria-labelledby="titleId"
        tabindex="-1"
        @keydown.esc.stop="requestClose"
      >
        <!-- ── En-tête ─────────────────────────────────────────────────── -->
        <header class="modp-head">
          <div class="modp-head-text">
            <p class="modp-eyebrow">
              {{ $t('mod.panel.eyebrow') }}
              <span v-if="position" class="modp-position">{{ position }}</span>
            </p>
            <h2 :id="titleId" class="modp-title" :title="row.name">{{ row.name }}</h2>
          </div>
          <button
            type="button"
            class="tool-btn modp-close"
            :aria-label="$t('common.close')"
            @click="requestClose"
          >
            <Icon name="ph:x-bold" />
          </button>
        </header>

        <div class="modp-body">
          <!-- ── Le bandeau de signaux ─────────────────────────────────────
               Quatre chiffres que la base connaissait déjà et ne disait pas.
               Ils renseignent, ils ne décident pas : aucun ne bloque une
               action, et le modérateur reste seul juge. -->
          <section v-if="row.signals" class="modp-signals" :aria-label="$t('mod.panel.signals.label')">
            <article class="modp-sig" :style="toneVar(uploaderTone)">
              <Icon :name="uploaderTone === 'ok' ? 'ph:user-check' : 'ph:user-focus'" class="modp-sig-icon" />
              <p class="modp-sig-label">{{ $t('mod.panel.signals.uploader') }}</p>
              <p class="modp-sig-value">
                <span class="modp-sig-fig">{{ row.signals.uploader.accepted }}</span>
                {{ $t('mod.panel.signals.accepted', row.signals.uploader.accepted) }}
              </p>
              <p class="modp-sig-note">
                {{
                  $t('mod.panel.signals.uploaderNote', {
                    rejected: row.signals.uploader.rejected,
                    changes: row.signals.uploader.changesRequested,
                  })
                }}
              </p>
            </article>

            <article class="modp-sig" :style="toneVar(row.signals.duplicate ? 'danger' : 'ok')">
              <Icon :name="row.signals.duplicate ? 'ph:copy-simple-fill' : 'ph:fingerprint'" class="modp-sig-icon" />
              <p class="modp-sig-label">{{ $t('mod.panel.signals.duplicate') }}</p>
              <p class="modp-sig-value">
                {{ row.signals.duplicate ? $t('mod.panel.signals.duplicateYes') : $t('mod.panel.signals.duplicateNo') }}
              </p>
              <NuxtLink
                v-if="row.signals.duplicate"
                :to="`/torrents/${row.signals.duplicate.infoHash}`"
                class="modp-sig-note modp-sig-link"
                :title="row.signals.duplicate.name"
              >
                {{ row.signals.duplicate.name }}
              </NuxtLink>
              <p v-else class="modp-sig-note">{{ $t('mod.panel.signals.duplicateNoNote') }}</p>
            </article>

            <article class="modp-sig" :style="toneVar(row.signals.rules.ok ? 'ok' : 'warning')">
              <Icon :name="row.signals.rules.ok ? 'ph:check-square-offset' : 'ph:warning-diamond'" class="modp-sig-icon" />
              <p class="modp-sig-label">{{ $t('mod.panel.signals.rules') }}</p>
              <p class="modp-sig-value">
                {{ row.signals.rules.ok ? $t('mod.panel.signals.rulesOk') : $t('mod.panel.signals.rulesFailed') }}
              </p>
              <p class="modp-sig-note">
                {{
                  row.signals.rules.ok
                    ? $t('mod.panel.signals.rulesOkNote')
                    : row.signals.rules.reason
                      ? $t(`mod.panel.ruleReason.${row.signals.rules.reason}`)
                      : $t('mod.panel.signals.rulesFailed')
                }}
              </p>
            </article>

            <article class="modp-sig" :style="toneVar(flagTone)">
              <Icon :name="flagTone === 'ok' ? 'ph:shield-check' : 'ph:shield-warning'" class="modp-sig-icon" />
              <p class="modp-sig-label">{{ $t('mod.panel.signals.standing') }}</p>
              <p class="modp-sig-value modp-sig-value--count">
                {{
                  $t('mod.panel.signals.flags', { n: row.signals.uploader.openFlags }, row.signals.uploader.openFlags)
                }}
              </p>
              <p class="modp-sig-note">
                {{
                  $t('mod.panel.signals.warnings', { n: row.signals.uploader.warnings }, row.signals.uploader.warnings)
                }}
              </p>
            </article>
          </section>

          <!-- ── Identité ──────────────────────────────────────────────── -->
          <dl class="modp-facts">
            <div>
              <dt>{{ $t('admin.pendingTorrents.meta.uploadedBy') }}</dt>
              <dd>
                <NuxtLink v-if="row.uploader" :to="`/users/${row.uploader.id}`" class="modp-link">
                  @{{ row.uploader.username }}
                </NuxtLink>
                <span v-else>—</span>
              </dd>
            </div>
            <div v-if="row.category">
              <dt>{{ $t('admin.pendingTorrents.meta.category') }}</dt>
              <dd>{{ row.category.name }}</dd>
            </div>
            <div>
              <dt>{{ $t('admin.pendingTorrents.meta.cast') }}</dt>
              <dd>{{ formatDate(row.createdAt) }}</dd>
            </div>
            <div>
              <dt>{{ $t('mod.panel.facts.hash') }}</dt>
              <dd class="modp-hash">{{ row.infoHash.slice(0, 16) }}…</dd>
            </div>
          </dl>

          <NuxtLink :to="`/torrents/${row.infoHash}`" class="modp-full">
            <Icon name="ph:arrow-square-out" />
            {{ $t('mod.panel.openFull') }}
          </NuxtLink>

          <!-- ── La décision ───────────────────────────────────────────── -->
          <section v-if="row.moderationStatus === 'pending'" class="modp-decide">
            <h3 class="modp-section">{{ $t('mod.panel.decide') }}</h3>

            <!-- `role="group"` et non `radiogroup` : un groupe de radios promet
                 la navigation aux flèches et un tabindex glissant, que nous
                 n'implémentons pas — et les trois boutons gagnent à rester
                 atteignables par Tab, ils ne sont que trois. `aria-pressed`
                 dit la vérité sans promettre ce qui n'existe pas. -->
            <div class="modp-verbs" role="group" :aria-label="$t('mod.panel.decide')">
              <button
                v-for="v in VERBS"
                :key="v.value"
                type="button"
                :aria-pressed="verb === v.value"
                class="modp-verb"
                :class="{ 'is-on': verb === v.value }"
                :style="toneVar(v.tone)"
                @click="pickVerb(v.value)"
              >
                <Icon :name="v.icon" />
                {{ $t(`mod.panel.verb.${v.value}`) }}
              </button>
            </div>

            <!-- Le motif typé. Il existe pour être COMPTÉ ; le message
                 ci-dessous existe pour être LU par le membre. -->
            <template v-if="verb && verb !== 'approve'">
              <label class="field-label modp-label" :for="reasonId">
                {{ $t('mod.panel.reasonLabel') }}
              </label>
              <select :id="reasonId" v-model="reasonCode" class="input modp-select" @change="applyTemplate">
                <option value="" disabled>{{ $t('mod.panel.reasonPlaceholder') }}</option>
                <option v-for="r in reasonChoices" :key="r.code" :value="r.code">
                  {{ $t(`mod.reasons.${r.i18n}.label`) }}
                </option>
              </select>

              <label class="field-label modp-label" :for="messageId">
                {{ $t('mod.panel.messageLabel') }}
              </label>
              <textarea
                :id="messageId"
                v-model="message"
                class="input modp-textarea"
                rows="4"
                :placeholder="$t('mod.panel.messagePlaceholder')"
              />
              <p class="field-help">{{ $t('mod.panel.messageHelp') }}</p>
            </template>

            <p v-if="error" class="modp-error" role="alert">{{ error }}</p>

            <div class="modp-actions">
              <button
                type="button"
                class="btn btn-primary modp-submit"
                :disabled="!canSubmit || busy"
                @click="submit"
              >
                <Icon v-if="busy" name="ph:circle-notch" class="animate-spin" />
                {{ $t('mod.panel.submit') }}
              </button>

              <div class="modp-secondary">
                <button
                  type="button"
                  class="tool-btn tool-btn--sm tool-btn--text"
                  :disabled="busy"
                  @click="snoozeOpen = !snoozeOpen"
                >
                  <Icon name="ph:alarm" />
                  {{ $t('mod.panel.snooze') }}
                </button>
                <button
                  type="button"
                  class="tool-btn tool-btn--sm tool-btn--text"
                  :disabled="busy"
                  @click="emit('warn', row)"
                >
                  <Icon name="ph:hand-palm" />
                  {{ $t('mod.panel.warn') }}
                </button>
              </div>

              <div v-if="snoozeOpen" class="modp-snooze">
                <button
                  v-for="d in SNOOZE"
                  :key="d"
                  type="button"
                  class="btn btn-secondary btn-xs"
                  :disabled="busy"
                  @click="doSnooze(d)"
                >
                  {{ $t(`mod.panel.snoozeFor.${d}`) }}
                </button>
              </div>
            </div>
          </section>

          <p v-else class="modp-settled">
            <Icon name="ph:seal-check" />
            {{ $t('mod.panel.settled') }}
          </p>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * Le plan de travail de la modération.
 *
 * Statuer sur un envoi coûtait trois pages : la file, la fiche publique du
 * torrent, le profil de l'uploadeur — et au retour, la file avait perdu le
 * fil. Douze envois faisaient douze allers-retours. C'est le changement de
 * contexte, pas la lenteur des clics, que la littérature désigne comme le
 * premier facteur de charge d'un modérateur.
 *
 * Ce panneau met la décision À CÔTÉ de la file :
 *
 *   · au-dessus de 1080 px, il se pose à droite sans voile — la liste reste
 *     lisible et cliquable, c'est un maître-détail, pas une boîte modale ;
 *   · en dessous, il devient une feuille par-dessus, avec voile.
 *
 * D'où l'absence de piège à focus : sur grand écran, enfermer le clavier dans
 * le panneau rendrait la file inatteignable, ce qui serait pire que le
 * problème résolu. On déplace le focus à l'ouverture, on le rend à la
 * fermeture, et Échap ferme. Le verrou de défilement ne s'applique que dans
 * le cas modal, où il a un sens.
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useModalChrome } from '~/composables/useModalChrome';
import { reasonsForScope, type ModerationScope } from '@trackarr/shared/moderation';

type Tone = 'ok' | 'warning' | 'danger' | 'info';

export interface PanelRow {
  id: string;
  infoHash: string;
  name: string;
  createdAt: string;
  moderationStatus: string;
  uploader: { id: string; username: string } | null;
  category: { id: string; name: string } | null;
  signals: {
    uploader: {
      accepted: number;
      rejected: number;
      changesRequested: number;
      warnings: number;
      openFlags: number;
    };
    duplicate: { infoHash: string; name: string } | null;
    rules: { ok: boolean; reason?: string };
  } | null;
}

const props = defineProps<{
  row: PanelRow | null;
  /** « 3 / 12 » — où l'on en est dans la file. */
  position?: string | null;
}>();

const emit = defineEmits<{
  close: [];
  /** Décidé : le parent recharge et avance au suivant. */
  decided: [id: string];
  snoozed: [id: string];
  warn: [row: PanelRow];
}>();

const { t } = useI18n();
const notifications = useNotificationStore();

const open = computed(() => !!props.row);
const panel = ref<HTMLElement | null>(null);
const titleId = useId();
const reasonId = useId();
const messageId = useId();

const VERBS = [
  { value: 'approve', icon: 'ph:check-circle-bold', tone: 'ok' as Tone },
  { value: 'changes', icon: 'ph:pencil-simple-line-bold', tone: 'info' as Tone },
  { value: 'reject', icon: 'ph:x-circle-bold', tone: 'danger' as Tone },
] as const;
const SNOOZE = ['1d', '3d', '7d'] as const;

const verb = ref<'approve' | 'changes' | 'reject' | null>(null);
const reasonCode = ref('');
const message = ref('');
const busy = ref(false);
const error = ref('');
const snoozeOpen = ref(false);

const reasonChoices = computed(() =>
  verb.value && verb.value !== 'approve'
    ? reasonsForScope(verb.value as ModerationScope)
    : []
);

const uploaderTone = computed<Tone>(() => {
  const u = props.row?.signals?.uploader;
  if (!u) return 'info';
  if (u.rejected > 0 && u.rejected >= u.accepted) return 'warning';
  if (u.accepted === 0) return 'info';
  return 'ok';
});

const flagTone = computed<Tone>(() => {
  const u = props.row?.signals?.uploader;
  if (!u) return 'info';
  if (u.openFlags > 0) return 'warning';
  if (u.warnings > 0) return 'warning';
  return 'ok';
});

const canSubmit = computed(() => {
  if (!verb.value) return false;
  if (verb.value === 'approve') return true;
  return !!reasonCode.value && message.value.trim().length > 0;
});

/** Le point de rupture au-dessus duquel le panneau se pose à côté plutôt que
 *  par-dessus. Lu une fois et suivi, pour que le rôle ARIA change avec lui. */
const narrow = ref(false);
let mq: MediaQueryList | null = null;
const syncNarrow = (e: MediaQueryList | MediaQueryListEvent) => {
  narrow.value = !e.matches;
};
if (import.meta.client) {
  mq = window.matchMedia('(min-width: 1080px)');
  syncNarrow(mq);
  mq.addEventListener('change', syncNarrow);
}
onBeforeUnmount(() => {
  mq?.removeEventListener('change', syncNarrow);
});

/*
 * En mode feuille, le panneau annonce `aria-modal="true"` — ce qui dit au
 * lecteur d'écran que le reste de la page est inerte. Sans piège à focus, la
 * tabulation en sortait quand même, vers une page devenue invisible pour
 * l'utilisateur, et le gestionnaire d'Échap posé sur l'aside cessait alors de
 * répondre : plus aucun moyen de revenir ni de sortir.
 *
 * `useModalChrome` fait exactement les trois choses qui manquaient — piège à
 * focus, Échap au niveau fenêtre, verrou de défilement compté — et ne
 * s'active QUE quand `isOpen` est vrai. On le branche donc sur « ouvert ET
 * étroit » : en mode docké il ne fait rien, ce qui est le but, puisque la
 * file doit rester atteignable au clavier.
 */
useModalChrome({
  isOpen: () => open.value && narrow.value,
  panel,
  onEscape: requestClose,
});

let restoreTo: HTMLElement | null = null;

// Le focus suit l'ÉLÉMENT, pas le point de rupture : keyer aussi sur `narrow`
// faisait qu'un simple redimensionnement volait le curseur au milieu d'un
// message et écrasait la cible de restitution.
watch(
  () => props.row?.id,
  (id) => {
    if (id) {
      restoreTo = (document.activeElement as HTMLElement) ?? null;
      nextTick(() => panel.value?.focus());
    } else {
      restoreTo?.focus?.();
      restoreTo = null;
    }
  }
);

// Changer d'élément remet le formulaire à zéro : sans cela, un motif choisi
// pour l'envoi précédent partirait avec le suivant.
watch(
  () => props.row?.id,
  () => {
    verb.value = null;
    reasonCode.value = '';
    message.value = '';
    error.value = '';
    snoozeOpen.value = false;
  }
);

function toneVar(tone: Tone) {
  const map: Record<Tone, string> = {
    ok: 'var(--online)',
    warning: 'var(--warning)',
    danger: 'var(--danger)',
    info: 'var(--info)',
  };
  return { '--tone': map[tone] };
}

function pickVerb(v: 'approve' | 'changes' | 'reject') {
  verb.value = v;
  reasonCode.value = '';
  message.value = '';
  error.value = '';
}

/** Le motif pré-remplit le message, qui reste modifiable : un texte type fait
 *  gagner la frappe, il ne doit pas empêcher de dire ce qui est particulier. */
function applyTemplate() {
  const r = reasonChoices.value.find((x) => x.code === reasonCode.value);
  if (!r) return;
  const body = t(`mod.reasons.${r.i18n}.body`);
  if (!message.value.trim() || message.value === lastTemplate) {
    message.value = body;
  }
  lastTemplate = body;
}
let lastTemplate = '';

function requestClose() {
  if (busy.value) return;
  emit('close');
}

async function submit() {
  if (!props.row || !canSubmit.value) return;
  busy.value = true;
  error.value = '';
  const path =
    verb.value === 'approve'
      ? 'approve'
      : verb.value === 'changes'
        ? 'request-changes'
        : 'reject';
  try {
    await $fetch(`/api/mod/torrents/${props.row.infoHash}/${path}`, {
      method: 'POST',
      body:
        verb.value === 'approve'
          ? {}
          : { message: message.value.trim(), reasonCode: reasonCode.value },
    });
    notifications.success(t(`mod.panel.done.${verb.value}`));
    emit('decided', props.row.id);
  } catch (e: unknown) {
    error.value =
      (e as { data?: { message?: string } })?.data?.message ??
      t('common.actionFailed');
  } finally {
    busy.value = false;
  }
}

async function doSnooze(duration: (typeof SNOOZE)[number]) {
  if (!props.row) return;
  busy.value = true;
  try {
    await $fetch(`/api/mod/torrents/${props.row.infoHash}/snooze`, {
      method: 'POST',
      body: { duration },
    });
    notifications.success(t('mod.panel.snoozed'));
    emit('snoozed', props.row.id);
  } catch {
    error.value = t('common.actionFailed');
  } finally {
    busy.value = false;
    snoozeOpen.value = false;
  }
}

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
/* Le voile n'apparaît qu'en mode feuille. */
.modp-scrim {
  position: fixed;
  inset: 0;
  /* L'échelle du projet : entêtes 30, listes déroulantes 40, modales 50.
     Le voile se glisse juste sous la feuille qu'il assombrit. */
  z-index: 49;
  background: rgb(var(--bg-base) / 0.72);
  backdrop-filter: blur(2px);
}

.modp {
  position: fixed;
  top: var(--header-total);
  right: 0;
  bottom: 0;
  /* Docké, le panneau n'est pas une modale : il se range au niveau des
     surfaces flottantes (40). En feuille, il en devient une (50). */
  z-index: 40;
  width: min(34rem, 100vw);
  display: flex;
  flex-direction: column;
  background: rgb(var(--bg-surface));
  border-left: 1px solid rgb(var(--line-strong));
  box-shadow: -18px 0 40px -28px rgb(var(--shadow-color) / 0.8);
  overflow: hidden;
}
.modp:focus-visible {
  outline: 2px solid rgb(var(--focus-ring));
  outline-offset: -2px;
}
.modp--narrow {
  width: 100vw;
  top: 0;
  z-index: 50;
}

.modp-head {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.9rem 1rem;
  border-bottom: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
}
.modp-head-text {
  min-width: 0;
  flex: 1;
}
.modp-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.16em * var(--tracking-scale));
  color: rgb(var(--fg-subtle));
}
.modp-position {
  padding: 0.05rem 0.35rem;
  border-radius: var(--radius-pill);
  background: rgb(var(--fg-default) / 0.1);
  color: rgb(var(--fg-muted));
  /* Remet à zéro l'espacement hérité de `.modp-eyebrow`. Passe quand même par
     le calc : c'est la règle du projet, sans exception. */
  letter-spacing: calc(0em * var(--tracking-scale));
}
.modp-title {
  margin: 0.3rem 0 0;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  font-weight: 700;
  line-height: 1.35;
  color: rgb(var(--fg-strong));
  /* On enveloppe plutôt que de tronquer : un nom de release coupé est
     exactement ce qu'un modérateur a besoin de lire en entier. */
  overflow-wrap: anywhere;
}
.modp-close {
  flex: none;
}

.modp-body {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

/* ── Signaux ──────────────────────────────────────────────────────────── */
.modp-signals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
  gap: 0.5rem;
}
.modp-sig {
  position: relative;
  padding: 0.6rem 0.7rem 0.65rem;
  border: 1px solid rgb(var(--tone) / 0.32);
  border-radius: var(--radius-lg);
  background: rgb(var(--tone) / 0.08);
}
.modp-sig-icon {
  position: absolute;
  top: 0.55rem;
  right: 0.6rem;
  font-size: 0.95rem;
  color: rgb(var(--tone));
  opacity: 0.75;
}
.modp-sig-label {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.5938rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.14em * var(--tracking-scale));
  /* `--fg-muted` et non `--fg-subtle` : mesuré à 4,03:1 sur la tuile teintée
     en thème sombre, donc sous le seuil de 4,5:1 exigé pour ce corps (9,5 px).
     `--fg-muted` remonte l'ensemble entre 6,24 et 6,70 dans les deux thèmes. */
  color: rgb(var(--fg-muted));
}
.modp-sig-value {
  margin: 0.28rem 0 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
.modp-sig-value--count {
  font-family: var(--font-mono);
  font-size: 1.05rem;
  font-weight: 700;
  color: rgb(var(--tone));
}
.modp-sig-fig {
  font-family: var(--font-mono);
  font-size: 1.05rem;
  font-weight: 700;
  color: rgb(var(--tone));
  margin-right: 0.15rem;
}
.modp-sig-note {
  margin: 0.2rem 0 0;
  font-size: 0.6875rem;
  line-height: 1.4;
  color: rgb(var(--fg-muted));
  overflow-wrap: anywhere;
}
.modp-sig-link {
  color: rgb(var(--tone));
  text-decoration: underline;
  text-underline-offset: 2px;
  display: block;
  /* Sans ce rembourrage la zone cliquable faisait 15 px de haut, sous le
     minimum de 24 px (WCAG 2.5.8). Même correctif que `.queue-link`. */
  padding-block: 0.35rem;
}

/* ── Identité ─────────────────────────────────────────────────────────── */
.modp-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: 0.65rem 0.9rem;
  margin: 0;
  padding: 0.75rem 0.85rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-lg);
  background: rgb(var(--bg-elevated));
}
.modp-facts dt {
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.16em * var(--tracking-scale));
  color: rgb(var(--fg-subtle));
}
.modp-facts dd {
  margin: 0.2rem 0 0;
  font-size: 0.75rem;
  color: rgb(var(--fg-default));
}
.modp-hash {
  font-family: var(--font-mono);
}
.modp-link {
  color: rgb(var(--accent-warm-text));
  text-decoration: underline;
  text-underline-offset: 2px;
}
.modp-full {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  align-self: flex-start;
  padding-block: 0.35rem;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
}
.modp-full:hover {
  color: rgb(var(--fg-strong));
}

/* ── Décision ─────────────────────────────────────────────────────────── */
.modp-section {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.16em * var(--tracking-scale));
  color: rgb(var(--fg-subtle));
}
.modp-decide {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding-top: 0.9rem;
  border-top: 1px solid rgb(var(--line-default));
}
.modp-verbs {
  display: grid;
  /* `minmax(0, 1fr)` et non `1fr` : le plancher implicite est `min-content`,
     donc un libellé long — « Demander une correction » — élargit sa colonne
     jusqu'à faire déborder le panneau horizontalement au lieu de se replier. */
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem;
}
.modp-verb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  /* 2.25rem clair pour la cible tactile de 24 px minimum (WCAG 2.5.8),
     avec de la marge. */
  min-height: 2.5rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid rgb(var(--line-field));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-muted));
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.25;
  overflow-wrap: anywhere;
  cursor: pointer;
  transition:
    background var(--dur-2) var(--ease-standard),
    border-color var(--dur-2) var(--ease-standard),
    color var(--dur-2) var(--ease-standard);
}
.modp-verb:hover {
  color: rgb(var(--tone));
  border-color: rgb(var(--tone) / 0.6);
}
.modp-verb.is-on {
  color: rgb(var(--tone));
  background: rgb(var(--tone) / 0.16);
  border-color: rgb(var(--tone));
}
.modp-label {
  margin-bottom: -0.25rem;
}
.modp-select,
.modp-textarea {
  width: 100%;
}
.modp-textarea {
  resize: vertical;
  min-height: 5rem;
  font-family: inherit;
  line-height: 1.5;
}
.modp-error {
  margin: 0;
  padding: 0.45rem 0.6rem;
  border: 1px solid rgb(var(--danger) / 0.55);
  border-radius: var(--radius-sm);
  background: rgb(var(--danger) / 0.12);
  /* Le rouge sur son propre fond teinté tombait à 4,47:1 en thème sombre,
     sous le seuil. Le texte passe en avant-plan par défaut ; le rouge reste
     porté par la bordure et le fond, donc le message garde sa couleur sans
     que sa lisibilité en dépende. */
  color: rgb(var(--fg-default));
  font-size: 0.75rem;
}
.modp-actions {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.modp-submit {
  width: 100%;
  min-height: 2.5rem;
}
.modp-secondary {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.modp-snooze {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
  padding: 0.45rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-inset));
}
.modp-settled {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  padding: 0.75rem 0.85rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-lg);
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-muted));
  font-size: 0.75rem;
}

/* ── Mouvement ────────────────────────────────────────────────────────── */
.modp-slide-enter-active,
.modp-slide-leave-active {
  transition: transform var(--dur-4) var(--ease-emphasis);
}
.modp-slide-enter-from,
.modp-slide-leave-to {
  transform: translateX(100%);
}
.modp-fade-enter-active,
.modp-fade-leave-active {
  transition: opacity var(--dur-3) var(--ease-standard);
}
.modp-fade-enter-from,
.modp-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .modp-slide-enter-active,
  .modp-slide-leave-active,
  .modp-fade-enter-active,
  .modp-fade-leave-active {
    transition: none;
  }
}
</style>

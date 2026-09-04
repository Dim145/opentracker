<script setup lang="ts">
/**
 * Les commentaires — une fonctionnalité entière qui existait de bout en bout,
 * sauf son interface.
 *
 * # Ce qui était déjà là
 *
 * - Le `GET /api/torrents/:hash` charge `comments` avec leurs auteurs, les plus
 *   récents d'abord, et le composable les expose.
 * - Le `POST /api/torrents/:hash/comments` existe, valide `{ content }` à
 *   5000 caractères par `torrentCommentSchema`, applique la politique d'âge de
 *   compte de l'uploadeur (`utils/commentPolicy.ts`) et renvoie la ligne créée.
 * - La notification `comment_on_my_upload` est câblée dans la cloche, les
 *   réglages, le push web et l'e-mail, et pointe vers `/torrents/{hash}`.
 *
 * Et **zéro appelant** du POST dans l'application web. La notification menait
 * donc à une page qui n'affichait pas le commentaire dont elle prévenait, et le
 * réglage « restreindre les commentaires » gardait une porte qui n'existait
 * pas. Il ne manquait que ce fichier.
 *
 * # L'ajout optimiste, et pourquoi il ne peut pas doubler
 *
 * Le commentaire posté s'affiche avant que la page ne se recharge — sinon la
 * zone de saisie se vide et rien ne bouge, ce qui se lit comme un échec. Mais
 * l'appelant rafraîchit ensuite le détail, et la même ligne arriverait par les
 * props : elle apparaîtrait deux fois.
 *
 * D'où le filtre par identifiant. La ligne locale est remplacée par celle du
 * serveur dès la réponse (donc elle porte le vrai `id`), et elle disparaît
 * d'elle-même à la seconde où les props la contiennent. Aucun doublon, aucun
 * clignotement, et pas de fenêtre pendant laquelle le commentaire n'est nulle
 * part.
 *
 * # Le contenu est du texte de membre
 *
 * Il passe par `DescriptionRender`, qui détecte le format et assainit via
 * DOMPurify — le même chemin que la description d'un torrent et que la liste de
 * commentaires de `/federated/[id]`. Pas de `v-html` roulé à la main ici.
 */
import { formatAge, formatDate } from '~/utils/format';
import type { TorrentComment } from '~/composables/useTorrentDetail';

/** Ce que `torrentCommentSchema` accepte. Le compteur et le serveur disent le même nombre. */
const MAX_LENGTH = 5000;

const props = withDefaults(
  defineProps<{
    /** L'infohash, pour la route de publication. */
    hash: string;
    /** Tels que le composable les expose : les plus récents d'abord. */
    comments: TorrentComment[];
    /** Pour distinguer l'auteur de la release dans son propre fil. */
    uploaderId?: string | null;
    /** Une page sous péage adulte n'affiche ni fil ni zone de saisie. */
    gated?: boolean;
  }>(),
  { uploaderId: null, gated: false },
);

const emit = defineEmits<{
  /** Publié. L'appelant rafraîchit le détail — la ligne est déjà à l'écran. */
  (e: 'posted', comment: TorrentComment): void;
}>();

const { t } = useI18n();
const { loggedIn } = useUserSession();
const fid = useFieldIds();

/* ── Le fil ───────────────────────────────────────────────────────────────── */

const posted = ref<TorrentComment[]>([]);

const rows = computed<TorrentComment[]>(() => {
  const known = new Set(props.comments.map((c) => c.id));
  return [...posted.value.filter((c) => !known.has(c.id)), ...props.comments];
});

/** L'initiale de l'avatar. Un compte effacé n'a plus de nom : la puce reste. */
function initial(c: TorrentComment): string {
  return (c.author?.username ?? '?').trim().charAt(0).toUpperCase() || '?';
}

function isUploader(c: TorrentComment): boolean {
  return !!props.uploaderId && c.author?.id === props.uploaderId;
}

/* ── La saisie ────────────────────────────────────────────────────────────── */

const draft = ref('');
const sending = ref(false);
const errorMessage = ref('');

const remaining = computed(() => MAX_LENGTH - draft.value.length);
const tooLong = computed(() => remaining.value < 0);
const canSend = computed(
  () => !sending.value && draft.value.trim().length > 0 && !tooLong.value,
);

async function send() {
  if (!canSend.value) return;
  const content = draft.value.trim();

  // La ligne locale, posée AVANT la requête. Son identifiant est temporaire et
  // ne peut pas collider avec un UUID du serveur.
  const tempId = `pending-${Date.now()}`;
  const optimistic: TorrentComment = {
    id: tempId,
    content,
    createdAt: new Date().toISOString(),
    author: null,
  };
  posted.value = [optimistic, ...posted.value];
  draft.value = '';
  errorMessage.value = '';
  sending.value = true;

  try {
    const created = await $fetch<TorrentComment>(
      `/api/torrents/${props.hash}/comments`,
      { method: 'POST', body: { content } },
    );
    // Remplacée par la ligne du serveur : elle porte le vrai `id`, donc le
    // filtre de `rows` saura la retirer quand les props l'apporteront.
    posted.value = posted.value.map((c) => (c.id === tempId ? created : c));
    emit('posted', created);
  } catch (err: unknown) {
    // Retirée. Un commentaire affiché que le serveur a refusé est un mensonge,
    // et le texte est rendu à la zone de saisie pour ne pas être perdu.
    posted.value = posted.value.filter((c) => c.id !== tempId);
    draft.value = content;
    errorMessage.value = messageFor(err);
  } finally {
    sending.value = false;
  }
}

/**
 * Le refus, dit en français plutôt qu'en code d'erreur.
 *
 * La politique d'âge de compte renvoie un 403 avec le nombre de jours restants
 * dans la charge utile — précisément pour que l'interface puisse dire combien
 * de temps attendre au lieu d'un « interdit » sec. Personne ne lisait ce champ.
 */
function messageFor(err: unknown): string {
  const e = err as {
    statusCode?: number;
    data?: { message?: string; data?: { daysRemaining?: number }; daysRemaining?: number };
  };
  const body = e?.data;
  if (body?.message === 'COMMENTS_RESTRICTED_ACCOUNT_AGE') {
    const days = body?.data?.daysRemaining ?? body?.daysRemaining ?? 0;
    return t('torrents.detail.comments.errors.restricted', { n: days });
  }
  if (e?.statusCode === 429) return t('torrents.detail.comments.errors.tooFast');
  if (e?.statusCode === 401) return t('torrents.detail.comments.errors.signIn');
  return t('torrents.detail.comments.errors.failed');
}
</script>

<template>
  <section v-if="!gated" class="cm">
    <SectionHead
      :title="$t('torrents.detail.comments.title')"
      :count="rows.length"
      icon="ph:chat-circle-dots-bold"
    />

    <!-- ── La zone de saisie ────────────────────────────────────────────── -->
    <form v-if="loggedIn" class="cm-composer" @submit.prevent="send">
      <!-- Un `<label for>` apparié et VISIBLE. Un `<label>` qui ne désigne
           rien n'est qu'un paragraphe stylé : le lecteur d'écran annonce
           « saisie de texte » sans nom, et `formControlNames.test.ts` fait
           échouer la construction. -->
      <label class="cm-label" :for="fid('comment')">
        {{ $t('torrents.detail.comments.composerLabel') }}
      </label>
      <textarea
        :id="fid('comment')"
        v-model="draft"
        class="input cm-textarea"
        rows="3"
        :maxlength="MAX_LENGTH"
        :placeholder="$t('torrents.detail.comments.placeholder')"
        :aria-describedby="fid('comment-counter')"
        :disabled="sending"
      />
      <div class="cm-composer-foot">
        <!-- Le compteur ne s'affiche qu'à l'approche de la limite : un compteur
             permanent sur un champ de 5000 caractères ne fait que du bruit. -->
        <span
          :id="fid('comment-counter')"
          class="cm-counter"
          :class="{ 'cm-counter--over': tooLong }"
        >
          <template v-if="remaining <= 500">
            {{ $t('torrents.detail.comments.remaining', { n: remaining }) }}
          </template>
        </span>
        <button type="submit" class="tool-btn tool-btn--text cm-send" :disabled="!canSend">
          <Icon :name="sending ? 'ph:circle-notch-bold' : 'ph:paper-plane-tilt-bold'" aria-hidden="true" />
          {{ sending ? $t('torrents.detail.comments.sending') : $t('torrents.detail.comments.send') }}
        </button>
      </div>
      <p v-if="errorMessage" class="cm-error" role="alert">
        <Icon name="ph:warning-circle-fill" aria-hidden="true" />
        {{ errorMessage }}
      </p>
    </form>
    <p v-else class="cm-signin">
      <Icon name="ph:sign-in-bold" aria-hidden="true" />
      {{ $t('torrents.detail.comments.signInToComment') }}
    </p>

    <!-- ── Le fil ───────────────────────────────────────────────────────── -->
    <ul v-if="rows.length" class="cm-list">
      <li
        v-for="c in rows"
        :key="c.id"
        class="cm-item"
        :data-uploader="isUploader(c) ? 'true' : 'false'"
      >
        <span class="cm-avatar" aria-hidden="true">{{ initial(c) }}</span>
        <div class="cm-body">
          <p class="cm-meta">
            <NuxtLink v-if="c.author" :to="`/u/${c.author.id}`" class="cm-who">
              {{ c.author.username }}
            </NuxtLink>
            <span v-else class="cm-who cm-who--gone">
              {{ $t('torrents.detail.comments.authorGone') }}
            </span>
            <span v-if="isUploader(c)" class="cm-badge">
              {{ $t('torrents.detail.comments.uploaderBadge') }}
            </span>
            <time :datetime="c.createdAt" :title="formatDate(c.createdAt)">
              {{ formatAge(c.createdAt) }}
            </time>
          </p>
          <!-- Assaini par le même chemin que partout ailleurs, et rendu au
               serveur : `isomorphic-dompurify` fonctionne sous Node.

               C'était un `<ClientOnly>` avec le contenu BRUT en repli. Le
               repli EST ce que le serveur rend — donc un commentaire écrit en
               BBCode partait sur le fil avec ses crochets visibles,
               `[quote=…]` compris, jusqu'à l'hydratation ; et le `<p>` du
               repli remplacé par le `<div>` du rendu réel comptait comme une
               non-concordance d'hydratation. -->
          <div class="cm-text">
            <DescriptionRender :source="c.content" />
          </div>
        </div>
      </li>
    </ul>

    <!-- L'état vide, sur le modèle de `/federated/[id]` : une icône, une
         phrase, et pas un cadre d'erreur — il n'y a rien d'anormal à un fil
         vide. -->
    <div v-else class="cm-empty">
      <span class="cm-empty-plate" aria-hidden="true">
        <Icon name="ph:chat-circle-dots" class="cm-empty-icon" />
      </span>
      <p>{{ $t('torrents.detail.comments.empty') }}</p>
    </div>
  </section>
</template>

<style scoped>
.cm {
  /* La famille « communauté » : ce que les MEMBRES ont produit — les
     commentaires, les autres versions. Une des quatre teintes de la page (or =
     la release, cyan = le contenu du fichier, violet = les membres, bleu =
     l'équipe), et la seule prise dans l'échelle catégorielle `--chart-*`, qui
     était entièrement inutilisée. Voir l'en-tête de `NfoPanel.vue`.
     `--chart-4` tient 3,71:1 en sombre et 3,82:1 en clair sur les surfaces de
     la fiche : au-dessus des 3:1 d'un élément non textuel, sous les 4,5:1 d'un
     texte — elle n'en peint donc aucun. */
  --section-tone: var(--chart-4);
  display: block;
}

/* ── Saisie ───────────────────────────────────────────────────────────────── */

.cm-composer {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 1rem;
}
.cm-label {
  font-family: var(--font-mono);
  font-size: var(--label-md, 0.625rem);
  font-weight: var(--label-weight, 700);
  letter-spacing: var(--label-tracking, calc(0.08em * var(--tracking-scale)));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.cm-textarea {
  min-height: 4.5rem;
  resize: vertical;
  font-size: 0.8125rem;
  line-height: 1.55;
}
.cm-composer-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.cm-counter {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}
.cm-counter--over { color: rgb(var(--danger)); font-weight: 700; }
.cm-send { flex: none; }

.cm-error {
  display: flex;
  align-items: flex-start;
  gap: 0.35rem;
  margin: 0;
  padding: 0.45rem 0.6rem;
  border: 1px solid rgb(var(--danger) / 0.4);
  border-radius: var(--radius-sm);
  background: rgb(var(--danger) / 0.08);
  font-size: 0.78125rem;
  line-height: 1.5;
  color: rgb(var(--fg-default));
}

.cm-signin {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 1rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-inset));
  font-size: 0.78125rem;
  color: rgb(var(--fg-muted));
}

/* ── Fil ──────────────────────────────────────────────────────────────────── */

.cm-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
/* Une carte de commentaire : voile de la teinte de famille à 6 %, filet à
   gauche, encre NEUTRE. Mesuré — `--fg-default` sur un voile de `--chart-4` à
   6 % donne 15,72:1 en sombre et 16,96:1 en clair, `--fg-muted` 6,35:1 et
   6,39:1. Le fil se lit donc comme une conversation et non comme une liste de
   lignes de journal, sans qu'une seule paire descende. */
.cm-item {
  display: grid;
  grid-template-columns: 1.75rem minmax(0, 1fr);
  gap: 0.6rem;
  padding: 0.6rem 0.8rem;
  background:
    linear-gradient(rgb(var(--chart-4) / 0.06), rgb(var(--chart-4) / 0.06)),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-left: 2px solid rgb(var(--chart-4) / 0.45);
  border-radius: var(--radius-md);
  transition: border-color var(--dur-3) var(--ease-standard);
}
/* Le commentaire de l'uploadeur prend l'or : c'est la voix de la release, pas
   une voix de la communauté. La carte le dit avant l'avatar. */
.cm-item[data-uploader='true'] {
  background:
    linear-gradient(rgb(var(--accent-warm) / 0.07), rgb(var(--accent-warm) / 0.07)),
    rgb(var(--bg-elevated));
  border-left-color: rgb(var(--accent-warm));
}

/* Une entrée en escalier de 40 ms par carte, plafonnée à six : un fil qui
   apparaît d'un bloc ne dit pas qu'il est ordonné, et au-delà de six
   l'attente devient perceptible. `--motion-scale: 0` la supprime par le
   `calc()`, comme toutes les autres. */
.cm-item {
  animation: cm-in calc(220ms * var(--motion-scale)) var(--ease-emphasis) both;
}
.cm-item:nth-child(1) { animation-delay: calc(0ms * var(--motion-scale)); }
.cm-item:nth-child(2) { animation-delay: calc(40ms * var(--motion-scale)); }
.cm-item:nth-child(3) { animation-delay: calc(80ms * var(--motion-scale)); }
.cm-item:nth-child(4) { animation-delay: calc(120ms * var(--motion-scale)); }
.cm-item:nth-child(5) { animation-delay: calc(160ms * var(--motion-scale)); }
.cm-item:nth-child(n + 6) { animation-delay: calc(200ms * var(--motion-scale)); }
@keyframes cm-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .cm-item {
    animation: none;
  }
}

.cm-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  font-size: 0.6875rem;
  font-weight: 800;
  background: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-muted));
}
/* La paire pleine `--accent-warm` / `--accent-warm-fg`, jamais
   `--accent-warm-text` sur un voile de `--accent-warm` : cette dernière est
   mesurée sous 4,5:1 en thème clair. */
.cm-item[data-uploader='true'] .cm-avatar {
  background: rgb(var(--accent-warm));
  border-color: rgb(var(--accent-warm));
  color: rgb(var(--accent-warm-fg));
}

.cm-body { min-width: 0; }

.cm-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.3rem 0.5rem;
  margin: 0;
  font-size: 0.6875rem;
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}
.cm-who {
  /* WCAG 2.5.8 : 24 px de cible au minimum. Mesuré à 19 px avant, à TOUTES
     les largeurs — ce n'est pas un défaut de mise en page, c'est un oubli. */
  display: inline-flex;
  align-items: center;
  min-height: 1.5rem;
  font-family: var(--font-sans);
  font-size: 0.78125rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  text-decoration: none;
}
.cm-who:hover { color: rgb(var(--accent)); }
.cm-who--gone { font-weight: 600; color: rgb(var(--fg-muted)); font-style: italic; }

.cm-badge {
  padding: 0.02rem 0.35rem;
  border-radius: var(--radius-sm);
  background: rgb(var(--accent-warm));
  border: 1px solid rgb(var(--accent-warm));
  color: rgb(var(--accent-warm-fg));
  font-family: var(--font-mono);
  font-size: var(--label-sm, 0.5625rem);
  font-weight: 800;
  letter-spacing: var(--label-tracking, calc(0.08em * var(--tracking-scale)));
  text-transform: uppercase;
}

.cm-text { margin-top: 0.2rem; }
/* `.cm-text-plain` est partie avec le repli `<ClientOnly>` qui l'utilisait :
   plus aucun gabarit ne pose cette classe. La typographie du corps vient de
   `DescriptionRender`, qui la porte pour toutes ses surfaces. */

/* L'état vide. Il était un cadre pointillé gris avec un glyphe gris dedans :
   correct, et parfaitement morne. Il porte maintenant la trame de fond du site
   — `--bg-pattern-image` existait et n'était utilisée qu'à un seul endroit de
   la page — plus un voile de la teinte de famille. Un vide texturé se lit
   comme « pas encore », un vide plat comme « cassé ». */
.cm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 2rem 1rem;
  background:
    var(--bg-pattern-image),
    linear-gradient(rgb(var(--chart-4) / 0.05), rgb(var(--chart-4) / 0.05)),
    rgb(var(--bg-inset));
  background-size: var(--bg-pattern-step) var(--bg-pattern-step), auto, auto;
  border: 1px dashed rgb(var(--chart-4) / 0.35);
  border-radius: var(--radius-lg);
  color: rgb(var(--fg-muted));
  text-align: center;
}
/* La plaque reste NEUTRE sous un glyphe teinté : une teinte sur un voile
   d'elle-même tombe à 3,32:1 en clair pour `--chart-4`, sous les 3:1 dès
   qu'on monte l'alpha. Fond neutre, glyphe teinté, la paire tient. */
.cm-empty-plate {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--chart-4) / 0.4);
  border-radius: var(--radius-pill);
}
.cm-empty-icon {
  font-size: 1.25rem;
  color: rgb(var(--chart-4));
}
.cm-empty p {
  margin: 0;
  max-width: 34ch;
  font-size: 0.8125rem;
  line-height: 1.55;
}
</style>

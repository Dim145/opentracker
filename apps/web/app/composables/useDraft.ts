/**
 * useDraft — garde ce qui est en train d'être écrit, jusqu'à l'envoi.
 *
 * Les quatre surfaces de rédaction longue du site — ouvrir un sujet, répondre à
 * un sujet, commenter une demande, écrire dans un ticket — n'avaient aucune
 * persistance. Une navigation, un rechargement, un onglet fermé par erreur, une
 * session expirée pendant la relecture : le texte disparaissait sans un mot.
 * Sur un forum où les messages font des paragraphes, c'est la perte de données
 * la plus banale et la plus évitable qui soit.
 *
 * `localStorage`, pas le serveur : un brouillon est personnel à un navigateur,
 * n'a pas besoin de survivre à un changement d'appareil, et l'écrire côté
 * serveur voudrait dire une route, une table et une politique de rétention pour
 * un texte que l'auteur n'a pas encore choisi de publier.
 *
 * Écriture différée d'une seconde : sans cela, chaque frappe touche le disque,
 * et `localStorage` est synchrone — sur un long message, cela se sent.
 *
 *   const draft = useDraft(`forum:reply:${id}`, replyContent);
 *   …
 *   await post();
 *   draft.clear();     // publié : le brouillon n'a plus de raison d'être
 *
 * Toutes les lectures et écritures sont gardées : un navigateur en navigation
 * privée, un stockage plein ou un réglage qui bloque les données de site font
 * lever l'accesseur lui-même, et un brouillon n'est jamais une raison de casser
 * une page.
 */
const PREFIX = 'trackarr.draft.';
const DEBOUNCE_MS = 1000;

/** Au-delà, ce n'est plus un brouillon : on ne remplit pas le stockage du
 *  navigateur avec un collage accidentel de plusieurs mégaoctets. */
const MAX_CHARS = 100_000;

/**
 * Nommée `DraftHandle` et non `Draft` : `useThemeAdmin.ts` exporte déjà un type
 * `Draft`, et Nuxt auto-importe les deux depuis `app/composables/` sans pouvoir
 * garder les deux — le troisième doublon de nom rencontré dans cette passe,
 * après `formatSize` et `ReleaseNameParts`.
 */
export interface DraftHandle {
  /** Efface le brouillon — à appeler après un envoi réussi. */
  clear: () => void;
  /** Vrai si quelque chose a été restauré à l'ouverture. */
  restored: Ref<boolean>;
}

export function useDraft(key: string, source: Ref<string>): DraftHandle {
  const restored = ref(false);
  const full = PREFIX + key;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function read(): string | null {
    try {
      return window.localStorage.getItem(full);
    } catch {
      return null;
    }
  }
  function write(value: string): void {
    try {
      if (value) window.localStorage.setItem(full, value);
      else window.localStorage.removeItem(full);
    } catch {
      /* stockage indisponible ou plein : le brouillon est un confort */
    }
  }

  function clear(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    write('');
    restored.value = false;
  }

  onMounted(() => {
    // La restauration n'écrase jamais une saisie déjà commencée : sur une page
    // qui pré-remplit son champ (une citation, une réponse amorcée), le
    // brouillon d'hier ne doit pas passer devant.
    const saved = read();
    if (saved && !source.value) {
      source.value = saved;
      restored.value = true;
    }

    watch(source, (next) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        write(next.length > MAX_CHARS ? next.slice(0, MAX_CHARS) : next);
      }, DEBOUNCE_MS);
    });
  });

  onBeforeUnmount(() => {
    // La dernière seconde de frappe, qui serait sinon perdue précisément au
    // moment où l'on quitte la page — c'est-à-dire dans le cas que ce
    // composable existe pour couvrir.
    if (timer) {
      clearTimeout(timer);
      timer = null;
      if (typeof window !== 'undefined') write(source.value);
    }
  });

  return { clear, restored };
}

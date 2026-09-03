/**
 * Ce qu'une boîte de dialogue doit faire en plus de s'afficher.
 *
 * Trois mécanismes, tous invisibles tant qu'on n'utilise pas le clavier :
 * le piège à focus, le verrou de défilement et la restitution du focus. Ils
 * vivaient dans `Modal.vue` uniquement, et `ReportModal.vue` — qui ne peut pas
 * réutiliser ce composant, son habillage de bordereau à bord dentelé étant
 * entièrement à lui — n'en avait aucun : `role="dialog"` et
 * `aria-modal="true"` annonçaient une modale, mais la tabulation partait droit
 * dans la page derrière l'ombrage. Les sortir ici évite qu'une troisième
 * modale sur mesure reparte de zéro et les oublie à nouveau.
 *
 * Le verrou de défilement est un compteur porté par `document.body`, partagé
 * par tous les appelants : une modale ouverte au-dessus d'une autre rendait le
 * défilement à la fermeture de la première alors que la seconde était toujours
 * à l'écran.
 */
import type { Ref } from 'vue';

/**
 * Ce qui est atteignable au clavier, dans l'ordre du document.
 *
 * `offsetParent` écarte ce qui est masqué (`display: none`), donc les onglets
 * repliés d'une modale à onglets ne piègent pas le focus dans le vide.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export interface ModalChromeOptions {
  /** L'état ouvert/fermé, en getter pour rester réactif. */
  isOpen: () => boolean;
  /** Le panneau lui-même : la racine du piège à focus. */
  panel: Ref<HTMLElement | null>;
  /** Ce que « fermer » veut dire pour l'appelant. */
  onEscape: () => void;
  /** Faux pour une modale persistante : Échap ne ferme pas. Le piège à focus
   *  et le verrou de défilement restent actifs — ils ne dépendent pas d'elle. */
  escapable?: () => boolean;
}

export function useModalChrome(opts: ModalChromeOptions) {
  const escapable = opts.escapable ?? (() => true);

  function focusables(): HTMLElement[] {
    const root = opts.panel.value;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
  }

  function onKeydown(e: KeyboardEvent) {
    // Un gestionnaire porté par le panneau ne se déclenche que si le focus est
    // déjà dedans. On écoute sur `window` pour qu'un utilisateur au clavier
    // sorti de la modale puisse encore appuyer sur Échap.
    if (e.key === 'Escape' && escapable()) {
      e.preventDefault();
      opts.onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    // Le piège à focus.
    //
    // `aria-modal="true"` dit au lecteur d'écran que le reste de la page est
    // inerte ; il ne dit rien au navigateur, dont l'ordre de tabulation
    // continuait droit dans la page derrière l'ombrage. Un utilisateur au
    // clavier sortait de la modale dès la dernière tabulation et se retrouvait
    // à parcourir une page qu'il ne voyait plus, sans savoir comment revenir.
    const items = focusables();
    if (!items.length) {
      e.preventDefault();
      opts.panel.value?.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    const inside = opts.panel.value?.contains(active) ?? false;
    if (!inside) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /** L'élément qui avait le focus avant l'ouverture, pour le lui rendre. */
  let restoreTo: HTMLElement | null = null;
  let lockedByThis = false;

  function lockScroll() {
    if (lockedByThis) return;
    lockedByThis = true;
    const n = Number(document.body.dataset.modalLocks || '0') + 1;
    document.body.dataset.modalLocks = String(n);
    if (n === 1) document.body.style.overflow = 'hidden';
  }

  function unlockScroll() {
    if (!lockedByThis) return;
    lockedByThis = false;
    const n = Math.max(0, Number(document.body.dataset.modalLocks || '1') - 1);
    document.body.dataset.modalLocks = String(n);
    if (n === 0) document.body.style.overflow = '';
  }

  watch(
    opts.isOpen,
    (open) => {
      if (typeof window === 'undefined') return;
      if (open) {
        restoreTo = document.activeElement as HTMLElement | null;
        window.addEventListener('keydown', onKeydown);
        lockScroll();
        // Un tick pour laisser le téléport se monter avant de prendre le focus.
        nextTick(() => opts.panel.value?.focus());
      } else {
        window.removeEventListener('keydown', onKeydown);
        unlockScroll();
        // Rendre le focus au bouton qui a ouvert la modale. Sans cela il
        // retombe sur `<body>` et la tabulation suivante repart du haut de la
        // page.
        restoreTo?.focus?.();
        restoreTo = null;
      }
    },
    // `immediate` pour le cas d'une modale montée DÉJÀ ouverte : sans cela le
    // premier changement d'état ne serait jamais observé et la modale
    // s'afficherait sans verrou de défilement, sans piège à focus et sans
    // gestionnaire Échap. La branche « fermée » est inoffensive : le verrou
    // n'est pas pris, et la restitution de focus porte sur `null`.
    { immediate: true },
  );

  onBeforeUnmount(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKeydown);
      unlockScroll();
    }
  });
}

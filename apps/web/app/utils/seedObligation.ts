/**
 * Ce que le membre doit encore à un torrent, réduit à ce qui s'affiche.
 *
 * La règle tient en cinq champs sur le fil — `downloaded`, `seedTime`,
 * `requiredSeedTime`, `isHnr`, `isExempt` — et en aucune façon en un état :
 * « exempté », « en défaut », « rempli » et « pas encore pris » sont quatre
 * réponses différentes à la même question, et les déduire dans le gabarit
 * revient à écrire quatre `v-if` imbriqués dont l'ordre porte la logique.
 *
 * Une fonction pure, donc, plutôt qu'un calcul recopié dans la carte et dans
 * la barre basse — les deux annoncent le même chiffre au même instant, et un
 * arrondi divergent entre les deux serait le genre d'écart que personne ne
 * remarque avant de le lire dans un rapport de bug.
 *
 * L'ordre des tests EST la spécification :
 *
 *  1. `isExempt` d'abord. Un membre exempté ne doit rien, qu'il ait pris la
 *     release ou non — le tester après `downloaded` aurait annoncé un
 *     engagement de 72 h à quelqu'un qui n'en a aucun.
 *  2. `!downloaded` ensuite : rien n'est dû, mais quelque chose SERA dû. La
 *     page s'en sert pour répondre à « est-ce que je peux la tenir ? » avant
 *     le clic, pas après.
 *  3. `isHnr` avant le compte : le serveur a tranché, et un défaut constaté
 *     ne se rattrape pas par un pourcentage qui vient de passer à 100.
 */

/**
 * La forme structurelle qu'attend `obligationView`.
 *
 * Volontairement pas un import de `SeedObligation` : un `utils/` qui dépend
 * d'un `composables/` inverse la seule dépendance qui doit rester à sens
 * unique. Le typage structurel de TypeScript fait que l'objet du composable
 * passe ici sans conversion.
 */
export interface SeedObligationLike {
  /** Le membre a-t-il déjà pris cette release ? */
  downloaded: boolean;
  /** Secondes de partage accomplies. */
  seedTime: number;
  /** Secondes de partage exigées. */
  requiredSeedTime: number;
  isHnr: boolean;
  isExempt: boolean;
}

export type ObligationState = 'exempt' | 'pending' | 'hnr' | 'met' | 'running';

export interface ObligationView {
  state: ObligationState;
  /** 0 à 100, borné — la largeur de la jauge. */
  percent: number;
  /** Secondes restantes avant libération ; 0 dès que l'obligation est levée. */
  remaining: number;
  /** Secondes accomplies, assainies. */
  seedTime: number;
  /** Secondes exigées, assainies. */
  requiredSeedTime: number;
  /** L'obligation est-elle derrière le membre — d'une façon ou d'une autre ? */
  settled: boolean;
}

export function obligationView(
  o: SeedObligationLike | null | undefined,
): ObligationView | null {
  if (!o) return null;

  const requiredSeedTime = Math.max(0, o.requiredSeedTime || 0);
  const seedTime = Math.max(0, o.seedTime || 0);
  const remaining = Math.max(0, requiredSeedTime - seedTime);

  // Une exigence à zéro est REMPLIE, pas indéterminée. La division brute
  // donnait `NaN`, qui traverse `Math.min` sans broncher et arrivait dans un
  // `width:NaN%` — une jauge vide sur une obligation qui n'existait pas.
  const percent =
    requiredSeedTime <= 0
      ? 100
      : Math.min(100, Math.round((seedTime / requiredSeedTime) * 100));

  const state: ObligationState = o.isExempt
    ? 'exempt'
    : !o.downloaded
      ? 'pending'
      : o.isHnr
        ? 'hnr'
        : remaining === 0
          ? 'met'
          : 'running';

  return {
    state,
    percent,
    remaining,
    seedTime,
    requiredSeedTime,
    settled: state === 'exempt' || state === 'met',
  };
}

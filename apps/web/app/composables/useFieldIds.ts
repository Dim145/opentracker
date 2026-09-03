/**
 * Des identifiants de champ stables, un seul appel par composant.
 *
 * Ce qui manquait à une bonne partie des formulaires, c'est le `for` : le motif
 * dominant était `<label class="…">Texte</label>` suivi d'un `<input>`, sans
 * `for` ni imbrication. Un `<label>` qui ne désigne rien n'est qu'un paragraphe
 * stylé — le lecteur d'écran annonce « saisie de texte » sans nom, et un clic
 * sur le libellé ne donne pas le focus au champ.
 *
 * La raison pour laquelle personne ne l'ajoutait est le coût : un formulaire de
 * vingt champs demandait vingt `useId()` et vingt constantes. Ici, un seul
 * appel donne un préfixe, et chaque champ se nomme par son sens.
 *
 * `useId()` et non un compteur ou `Math.random()` : les formulaires sont rendus
 * côté serveur, et deux valeurs différentes casseraient le lien `for` / `id`
 * pendant l'hydratation — le défaut corrigé dans `Modal.vue`.
 *
 * ```vue
 * const fid = useFieldIds();
 * <label :for="fid('title')">…</label>
 * <input :id="fid('title')">
 * ```
 */
export function useFieldIds(): (name: string) => string {
  const base = useId();
  return (name: string) => `${base}-${name}`;
}

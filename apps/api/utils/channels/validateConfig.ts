/**
 * Shape validation for a channel's config blob, driven by the field
 * declarations the adapter already publishes.
 *
 * Les deux routes d'écriture (`/api/me/notification-channels/:type` et
 * `/api/admin/notification-channels/:type`) recevaient le même genre de blob
 * et le traitaient différemment : la route membre plafonnait le nombre de
 * clés, leur longueur et leur type primitif, la route admin n'imposait rien
 * du tout. Et ni l'une ni l'autre ne regardait le `type` que l'adaptateur
 * déclare pour chaque champ — un champ annoncé `email` acceptait donc
 * n'importe quelle chaîne de 4 ko, y compris une liste de destinataires
 * séparés par des virgules que nodemailer aurait dépliée.
 *
 * D'où ce module : une seule fonction, appelée par les deux routes, qui
 * applique les règles de la route membre PLUS la vérification du type
 * déclaré. On valide le blob entrant, jamais le blob fusionné : les secrets
 * repris de la ligne existante ont déjà passé ce contrôle à leur écriture,
 * et les refaire passer bloquerait une sauvegarde à cause d'une valeur que
 * l'appelant n'a même pas envoyée.
 */
// `createError` est auto-importé dans les routes, mais pas quand vitest charge
// ce module isolément. On l'importe donc explicitement, comme le font déjà
// `utils/federation/discoverable.ts` et `utils/federation/inbound.ts`.
import { createError } from 'h3';
import type { ChannelField } from './types';

/** Plafond par valeur. La colonne est chiffrée puis stockée en texte : sans
 *  borne, un membre peut la gonfler autant qu'il veut. */
export const MAX_VALUE_LEN = 4096;

/**
 * Adresse e-mail, vue comme une structure plutôt que comme une grammaire.
 *
 * On ne cherche pas à réimplémenter la RFC 5322 — elle autorise des formes
 * (commentaires entre parenthèses, guillemets, listes) dont les analyseurs
 * divergent, et c'est précisément cette divergence qui a produit
 * GHSA-cc9r-2j5m-2m83. On exige donc la forme dont tout le monde s'accorde
 * sur le sens : une partie locale, une arobase, un domaine à points.
 *
 * L'Unicode reste admis dans le domaine — une bonne part des membres est
 * francophone et `prénom@exemple.fr` doit passer. Ce qui est refusé, ce sont
 * les caractères qui permettent à deux analyseurs de lire deux adresses
 * différentes dans la même chaîne : espaces, virgules, points-virgules,
 * parenthèses, chevrons, crochets, guillemets, contre-obliques, contrôles.
 */
const EMAIL_FORBIDDEN = /[\s,;()<>[\]\\"\u0000-\u001f\u007f]/;
const EMAIL_DOMAIN = /^[^.@-][^@]*\.[^.@]{2,}$/;

function looksLikeEmail(value: string): boolean {
  if (value.length > 254 || EMAIL_FORBIDDEN.test(value)) return false;
  const at = value.indexOf('@');
  // Une seule arobase, ni en tête ni en queue.
  if (at <= 0 || at !== value.lastIndexOf('@') || at === value.length - 1) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > 64) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  return EMAIL_DOMAIN.test(domain) && !domain.includes('..');
}

/**
 * URL de service. On vérifie la forme et le schéma, rien de plus : l'hôte
 * reste libre parce qu'une instance auto-hébergée pointe légitimement son
 * gotify ou son ntfy sur un nom interne. La politique d'accessibilité (pas
 * de bouclage, pas de plage privée sur une instance publique) appartient à
 * `safeFetch`, que tous les adaptateurs à URL traversent déjà.
 */
function looksLikeHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function isIntegerValue(value: string | number): boolean {
  if (typeof value === 'number') return Number.isInteger(value);
  return /^-?\d+$/.test(value);
}

/**
 * Valide un blob de configuration contre les champs déclarés par
 * l'adaptateur. Lève une `createError` 400 / 413 au premier écart ; ne
 * renvoie rien et ne modifie pas l'objet.
 *
 * `fields` est `adapter.userFields` côté membre, `adapter.serverFields`
 * côté admin.
 */
export function validateChannelConfig(
  fields: ChannelField[],
  config: Record<string, unknown>
): void {
  const declared = new Map(fields.map((f) => [f.key, f]));
  const entries = Object.entries(config);

  if (entries.length > declared.size) {
    throw createError({ statusCode: 400, statusMessage: 'Too many config fields' });
  }

  for (const [key, value] of entries) {
    const field = declared.get(key);
    if (!field) {
      throw createError({
        statusCode: 400,
        statusMessage: `Unknown config field: ${key}`,
      });
    }

    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: `Config field "${key}" has an unsupported type`,
      });
    }

    if (typeof value === 'string' && value.length > MAX_VALUE_LEN) {
      throw createError({
        statusCode: 413,
        statusMessage: `Config field "${key}" exceeds ${MAX_VALUE_LEN} characters`,
      });
    }

    // Vider un champ facultatif se fait en envoyant la chaîne vide ou null.
    // Ce n'est pas une valeur à typer — on laisse passer, et c'est le test
    // de l'adaptateur qui dira que le canal n'est plus utilisable.
    if (value === null || value === '') continue;

    const reject = (why: string): never => {
      throw createError({
        statusCode: 400,
        statusMessage: `Config field "${key}" ${why}`,
      });
    };

    switch (field.type) {
      case 'email':
        if (typeof value !== 'string' || !looksLikeEmail(value)) {
          reject('is not a single email address');
        }
        break;
      case 'url':
        if (typeof value !== 'string' || !looksLikeHttpUrl(value)) {
          reject('is not an http(s) URL');
        }
        break;
      case 'int':
        // Pas de borne : les priorités gotify/ntfy/pushover sont
        // légitimement nulles ou négatives, et un port se valide en se
        // connectant, pas en comptant.
        if (typeof value === 'boolean' || !isIntegerValue(value)) {
          reject('is not an integer');
        }
        break;
      case 'bool':
        if (typeof value !== 'boolean') reject('is not a boolean');
        break;
      case 'select':
        if (!field.options?.some((o) => String(o.value) === String(value))) {
          reject('is not one of the allowed options');
        }
        break;
      // 'string' et 'password' : le plafond de longueur suffit.
    }
  }
}

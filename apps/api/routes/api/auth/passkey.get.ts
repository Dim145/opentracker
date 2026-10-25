import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { users } from '@trackarr/db/schema';

/**
 * GET /api/auth/passkey
 * Returns the current user's passkey (private, only accessible to the user themselves)
 */
/*
 * `requireAuthSession`, pas `requireUserSession` : le bannissement compte ici.
 *
 * Le middleware saute la porte de bannissement pour tout `/api/auth/**` — il
 * le doit, la connexion et l'inscription sont anonymes — mais le saut couvre
 * aussi les routes de compte qui vivent sous ce préfixe. Or
 * `requireUserSession` ne lit pas le statut, contrairement à
 * `requireAuthSession`. Un membre banni gardait donc de quoi faire tourner son
 * passkey et changer son mot de passe : la porte d'entrée était fermée, la
 * porte de service ouverte.
 *
 * Corrigé par route plutôt qu'en resserrant le saut du middleware : le saut
 * est juste pour ce qu'il vise, et le lister route par route ferait dépendre
 * une garde d'autorisation d'une liste à tenir à jour.
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);

  // Read from the account, not from the session: the cookie keeps the passkey
  // of the moment the member signed in, and after a rotation on another device
  // that copy no longer announces.
  const [row] = await db
    .select({ passkey: users.passkey })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  return {
    passkey: row?.passkey ?? user.passkey,
  };
});

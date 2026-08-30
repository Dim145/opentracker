import { reconcileStaffRoles } from '~~/utils/adminAuth';
import { getMessagingDmScope, scopeAdmits } from '~~/utils/settings';

/**
 * The one place a messaging route decides whether it exists for this
 * viewer.
 *
 * It throws **404, not 403**, and that is deliberate: a 403 says "this
 * feature is here and you may not use it", which is precisely what an
 * instance running with messaging off would rather not disclose. From the
 * outside, an instance with the scope at `off` looks like a build that
 * never had the feature.
 */
export async function requireDmAccess(user: {
  id: string;
  isAdmin?: boolean;
  isModerator?: boolean;
  isOwner?: boolean;
}) {
  // Against the live roles, not the seven-day cookie. Every DM route
  // passes through here, and several of them branch on staff flags —
  // skipping the first-contact queue, deleting somebody else's message,
  // minting a relay token that carries the room. See
  // `reconcileStaffRoles`.
  await reconcileStaffRoles(user);
  const scope = await getMessagingDmScope();
  if (!scopeAdmits(scope, user)) {
    throw createError({ statusCode: 404, message: 'Not found' });
  }
  return scope;
}

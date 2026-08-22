/**
 * GET /api/federation/actor — public.
 *
 * Who this instance is, and which key its records are signed with. The entry
 * point for somebody who has not shaken hands with us and never will: records
 * prove themselves, so a stranger holding one needs nothing from us to check
 * it — but they do need somewhere to find one, and something that turns a
 * `did:key:z6Mk…` into a name.
 *
 * Deliberately advertises no inbox. This instance accepts no ActivityPub
 * activities; federation is the signed server-to-server surface, between peers
 * that agreed to know each other. Advertising an inbox we do not serve would
 * invite deliveries we would only drop.
 */
import { actorDocument, AS2_CONTENT_TYPE } from '~~/utils/federation/activityStreams';
import { requireDiscoverable } from '~~/utils/federation/discoverable';

export default defineEventHandler(async (event) => {
  const config = await requireDiscoverable(event);
  setHeader(event, 'content-type', AS2_CONTENT_TYPE);
  return actorDocument(config);
});

/**
 * GET /.well-known/trackarr — public.
 *
 * How a stranger finds the front door. Everything else about this instance is
 * discoverable *from* the actor document; this exists so the actor itself can
 * be found from the hostname alone, which is the one thing that cannot be
 * looked up in the thing it points at.
 *
 * A well-known path rather than WebFinger: WebFinger answers "who is
 * user@host", and there is no user here. The question being answered is "does
 * this host publish a catalogue, and where", which is an instance-level fact.
 */
import { AS2_CONTENT_TYPE } from '~~/utils/federation/activityStreams';
import { requireDiscoverable } from '~~/utils/federation/discoverable';

export default defineEventHandler(async (event) => {
  const config = await requireDiscoverable(event);
  const base = (config.publicUrl ?? '').replace(/\/$/, '');
  setHeader(event, 'content-type', AS2_CONTENT_TYPE);
  return {
    actor: `${base}/api/federation/actor`,
    outbox: `${base}/api/federation/outbox`,
    vocabulary: `${base}/api/federation/context`,
  };
});

/**
 * GET /api/federation/context — public.
 *
 * The `trackarr:` vocabulary, as a JSON-LD context document.
 *
 * Records do NOT point at this, and that is deliberate: a record is addressed
 * by its content, so adding a term to its `@context` would rename every record
 * in the catalogue and republish all of them. FEP-d8c8 provides for exactly
 * this case — non-FEP terms are preserved in non-expanded form — so the
 * interoperable core travels regardless, and this document exists so the rest
 * of the vocabulary is written down somewhere resolvable rather than only in
 * our source.
 */
import { AS2_CONTENT_TYPE, contextDocument } from '~~/utils/federation/activityStreams';
import { requireDiscoverable } from '~~/utils/federation/discoverable';

export default defineEventHandler(async (event) => {
  const config = await requireDiscoverable(event);
  setHeader(event, 'content-type', AS2_CONTENT_TYPE);
  return contextDocument(config);
});

/**
 * GET /api/irc/autobrr.yml
 *
 * The autobrr indexer definition for this instance, generated from the announce
 * template in force. See `utils/irc/autobrr.ts` for why it is generated rather
 * than shipped.
 *
 * Members only, like the Prowlarr definition: the categories are not secret but
 * the file names the instance, its address and its IRC network, and an
 * invite-only tracker publishes none of those.
 *
 * 404 when announcing is off — an empty definition would be worse than no
 * definition, because a member would configure it and then wait for lines that
 * are never coming.
 */
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { getSiteName } from '~~/utils/server';
import { autobrrDefinition } from '~~/utils/irc/autobrr';
import { getIrcConfig, getIrcEnabled, ircConfigReady } from '~~/utils/irc/settings';

export default defineEventHandler(async (event) => {
  await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);

  const [enabled, config] = await Promise.all([getIrcEnabled(), getIrcConfig()]);
  if (!enabled || !ircConfigReady(config)) {
    throw createError({
      statusCode: 404,
      message: 'This instance does not announce to an IRC channel.',
    });
  }

  const siteName = await getSiteName();
  const yaml = autobrrDefinition({
    siteName,
    // The host the member reached, for the same reason the Cardigann route uses
    // it: an env var set when the container was built is not where the member is.
    baseUrl: getRequestURL(event).origin,
    irc: {
      host: config.host,
      port: config.port,
      tls: config.tls,
      channel: config.channel,
      announcer: config.nick,
      keyed: !!config.channelKey,
      invited: config.perform.length > 0,
    },
    template: config.template,
  });

  setHeader(event, 'Content-Type', 'application/yaml; charset=utf-8');
  setHeader(
    event,
    'Content-Disposition',
    `attachment; filename="${siteName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.yaml"`
  );
  return yaml;
});

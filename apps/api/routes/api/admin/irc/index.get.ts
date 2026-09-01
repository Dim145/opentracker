/**
 * GET /api/admin/irc
 *
 * The announce bot's configuration and what it is currently doing.
 *
 * The secrets come back blank with a `has…` flag beside each, the same contract
 * the notification channels use: an admin needs to know a password is set
 * without the console being a place to read it back.
 *
 * `status.leader` is worth surfacing rather than hiding. In a multi-instance
 * deployment exactly one API process holds the connection, so an operator
 * looking at a console served by another one would otherwise see `idle` and
 * conclude the bot is down.
 */
import { requireAdminSession } from '~~/utils/adminAuth';
import { ircStatus } from '~~/utils/irc/announcer';
import { ANNOUNCE_TOKENS, DEFAULT_ANNOUNCE_TEMPLATE, announcePattern } from '~~/utils/irc/format';
import { getIrcConfig, getIrcEnabled, redactIrcConfig } from '~~/utils/irc/settings';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const [enabled, config] = await Promise.all([getIrcEnabled(), getIrcConfig()]);

  return {
    enabled,
    config: redactIrcConfig(config),
    status: ircStatus(),
    /** So the form can explain the template rather than link to a doc page. */
    tokens: Object.entries(ANNOUNCE_TOKENS).map(([name, def]) => ({
      name,
      variable: def.variable,
      describes: def.describes,
    })),
    defaultTemplate: DEFAULT_ANNOUNCE_TEMPLATE,
    /** The regex members' clients will use — shown so an operator editing the
     *  template can see what it does to the definition they are handing out. */
    pattern: announcePattern(config.template).pattern,
  };
});

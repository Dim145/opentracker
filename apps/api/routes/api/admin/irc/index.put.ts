/**
 * PUT /api/admin/irc
 *
 * Save the announce configuration, then reconcile the connection so the change
 * is visible before the admin's page has finished reloading — rather than at
 * the next plugin tick, which would make a correct setting look broken for
 * thirty seconds.
 *
 * ## A blank secret means "keep the stored one"
 *
 * The GET blanks the three credentials, so a form that round-tripped what it
 * received would erase them on every save. Blank therefore means unchanged, and
 * clearing one is an explicit `null` — the same contract the notification
 * channels use, and the reason it is a contract at all is that the alternative
 * silently disconnects a working bot the first time an admin edits the channel
 * name.
 *
 * ## The template is validated by being used
 *
 * An operator can write anything in it. What is checked is the thing that
 * matters: that the pattern derived from it reads back the line rendered from
 * it. A template that fails that would produce a definition every member's
 * autobrr silently ignores, so it is refused here with the sample line in the
 * message.
 */
import { z } from 'zod/v4';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { reconcile } from '~~/utils/irc/announcer';
import { SAMPLE_FIELDS } from '~~/utils/irc/autobrr';
import {
  announcePattern,
  renderAnnounce,
  templateTokens,
  toJsRegExp,
} from '~~/utils/irc/format';
import {
  getIrcConfig,
  redactIrcConfig,
  setIrcConfig,
  setIrcEnabled,
  type IrcAnnounceConfig,
} from '~~/utils/irc/settings';

/** `null` clears a secret, an absent/empty string keeps it. */
const secret = z.union([z.string(), z.null()]).optional();

const bodySchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(253),
  port: z.coerce.number().int().min(1).max(65535),
  tls: z.boolean(),
  nick: z
    .string()
    .trim()
    .max(30)
    // RFC 2812's nick grammar, minus the leading-digit case no network accepts.
    // Pipes and brackets are in it, which matters here: `name|autodl` is the
    // convention announce channels require.
    .regex(/^[A-Za-z\[\]\\`_^{|}][A-Za-z0-9\[\]\\`_^{|}-]*$/, 'Not a valid IRC nick'),
  realname: z.string().trim().max(60),
  serverPassword: secret,
  saslUser: z.string().trim().max(60),
  saslPassword: secret,
  perform: z.array(z.string().trim().max(400)).max(8),
  channel: z.string().trim().max(60).regex(/^[#&][^\s,]+$/, 'Not a valid channel'),
  channelKey: secret,
  template: z.string().trim().min(1).max(500),
  siteUrl: z.string().trim().max(300),
  announceAdult: z.boolean(),
});

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const body = await validateBody(event, bodySchema);
  const stored = await getIrcConfig();

  // Round-trip the template before anything is written: a stored template that
  // its own regex cannot read is a broken definition handed to every member.
  const sample = renderAnnounce(body.template, SAMPLE_FIELDS);
  const { pattern } = announcePattern(body.template);
  const match = toJsRegExp(pattern).exec(sample);
  if (!match) {
    throw createError({
      statusCode: 400,
      message: `That template does not parse back. Rendered: ${sample}`,
    });
  }
  // A template that mentions no fields would announce a constant line, which
  // parses perfectly and tells a client nothing.
  if (!templateTokens(body.template).includes('name')) {
    throw createError({
      statusCode: 400,
      message: 'The template has to include {name} — a client cannot filter on a line with no release in it.',
    });
  }

  const keep = (next: string | null | undefined, current: string): string =>
    next === null ? '' : next ? next : current;

  const config: IrcAnnounceConfig = {
    host: body.host,
    port: body.port,
    tls: body.tls,
    nick: body.nick,
    realname: body.realname,
    serverPassword: keep(body.serverPassword, stored.serverPassword),
    saslUser: body.saslUser,
    saslPassword: keep(body.saslPassword, stored.saslPassword),
    perform: body.perform.filter((line) => line.length > 0),
    channel: body.channel,
    channelKey: keep(body.channelKey, stored.channelKey),
    template: body.template,
    siteUrl: body.siteUrl.replace(/\/+$/, ''),
    announceAdult: body.announceAdult,
  };

  await setIrcConfig(config);
  await setIrcEnabled(body.enabled);
  // Fire-and-forget: a server that will not answer must not hang the save that
  // an operator needs to correct it.
  void reconcile();

  return { config: redactIrcConfig(config), enabled: body.enabled, sample };
});

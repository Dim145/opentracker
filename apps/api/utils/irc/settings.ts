/**
 * The operator's IRC configuration, and why it is one encrypted blob.
 *
 * Three of these fields are credentials — the server password, the SASL
 * password, the channel key — and `settings` is a plaintext table. The
 * notification channels solved the same problem already: one JSON value,
 * AES-GCM at rest, key derived from the session secret or from a dedicated
 * `CHANNEL_ENCRYPTION_KEY`. Reusing that is both less code and one fewer
 * decision about where secrets live.
 *
 * The trade is that the whole config is read and written as a unit, which suits
 * a connection you have to restart to reconfigure anyway.
 */
import { getSetting, setSetting } from '~~/utils/server';
import { decryptJson, encryptJson } from '~~/utils/channelSecrets';
import { DEFAULT_ANNOUNCE_TEMPLATE } from './format';

export const IRC_SETTINGS = {
  /** Encrypted JSON: everything below except `enabled`. */
  CONFIG: 'irc_announce_config',
  /** Plain, because the plugin reads it on every tick and it is not a secret. */
  ENABLED: 'irc_announce_enabled',
} as const;

export interface IrcAnnounceConfig {
  host: string;
  port: number;
  tls: boolean;
  nick: string;
  realname: string;
  serverPassword: string;
  saslUser: string;
  saslPassword: string;
  /** One raw IRC line per entry, sent after registration and before JOIN. */
  perform: string[];
  channel: string;
  channelKey: string;
  template: string;
  /**
   * The public address the announce line links to, e.g. `https://tracker.example.com`.
   *
   * The bot has no request to derive an origin from — unlike every other place
   * in this codebase that builds an absolute URL — so it has to be told.
   * Falling back to the federation identity's `public_url` covers the instances
   * that already declared one; with neither, the line carries a path and says
   * so in the admin console rather than inventing a hostname.
   */
  siteUrl: string;
  /**
   * Whether the adult tree is announced.
   *
   * Off by default, and this is the one default here that is a judgement rather
   * than a convenience. A channel is a single stream with no per-member
   * preferences in it: everyone who joins sees every line. The site lets a
   * member decide whether adult releases exist for them, and an announce
   * channel cannot honour that decision — so the operator makes it once, for
   * the channel, and the safe direction is the one that does not put titles
   * nobody asked for in front of people who turned them off.
   */
  announceAdult: boolean;
}

export const IRC_DEFAULTS: IrcAnnounceConfig = {
  host: '',
  port: 6697,
  tls: true,
  nick: 'trackarr',
  realname: 'Trackarr announce',
  serverPassword: '',
  saslUser: '',
  saslPassword: '',
  perform: [],
  channel: '#announce',
  channelKey: '',
  template: DEFAULT_ANNOUNCE_TEMPLATE,
  siteUrl: '',
  announceAdult: false,
};

export async function getIrcEnabled(): Promise<boolean> {
  // Off unless asked for: a tracker that started announcing to a channel
  // because it was upgraded would be announcing without anyone deciding to.
  return (await getSetting(IRC_SETTINGS.ENABLED)) === 'true';
}

export async function setIrcEnabled(enabled: boolean): Promise<void> {
  await setSetting(IRC_SETTINGS.ENABLED, enabled ? 'true' : 'false');
}

export async function getIrcConfig(): Promise<IrcAnnounceConfig> {
  const raw = await getSetting(IRC_SETTINGS.CONFIG);
  if (!raw) return { ...IRC_DEFAULTS };
  try {
    const stored = decryptJson<Partial<IrcAnnounceConfig>>(raw);
    if (!stored) return { ...IRC_DEFAULTS };
    return { ...IRC_DEFAULTS, ...stored, perform: stored.perform ?? [] };
  } catch (err) {
    // A blob that will not decrypt means the key changed — an operator rotating
    // `CHANNEL_ENCRYPTION_KEY`, or a restore from a backup taken under another
    // one. Returning defaults would silently disconnect the bot and lose the
    // settings on the next save, so this is loud and the announcer stays down.
    console.error(
      '[IRC] Could not decrypt the announce config; leaving the bot off:',
      (err as Error).message
    );
    throw err;
  }
}

export async function setIrcConfig(
  config: IrcAnnounceConfig
): Promise<void> {
  await setSetting(IRC_SETTINGS.CONFIG, encryptJson(config));
}

/** What the admin console may see: the same config with the secrets blanked. */
export function redactIrcConfig(
  config: IrcAnnounceConfig
): IrcAnnounceConfig & {
  hasServerPassword: boolean;
  hasSaslPassword: boolean;
  hasChannelKey: boolean;
} {
  return {
    ...config,
    serverPassword: '',
    saslPassword: '',
    channelKey: '',
    hasServerPassword: !!config.serverPassword,
    hasSaslPassword: !!config.saslPassword,
    hasChannelKey: !!config.channelKey,
  };
}

/**
 * Whether a config is complete enough to try.
 *
 * Deliberately not a Zod schema on the whole shape: the admin form sends
 * partials (a secret left blank means "keep the stored one"), and the useful
 * question at connect time is narrower than "is this valid".
 */
export function ircConfigReady(config: IrcAnnounceConfig): boolean {
  return (
    !!config.host &&
    config.port > 0 &&
    config.port <= 65535 &&
    !!config.nick &&
    /^[#&]/.test(config.channel)
  );
}

/**
 * A minimal IRC client — enough to say one line in one channel, forever.
 *
 * ## Why not a library
 *
 * Because the job is registration, PING, JOIN and PRIVMSG, and every library
 * that does those also does DCC, CTCP, channel modes and user tracking. The
 * whole protocol surface here is under two hundred lines, and the alternative
 * is a dependency on the network boundary of a private tracker — a place where
 * "what does this parse and what does it do with it" should be readable in one
 * sitting.
 *
 * ## What it deliberately does not do
 *
 * It never reads a command FROM the channel. Nothing an operator or a member
 * says to the bot makes it do anything: the only inputs are PING (answered) and
 * the numerics it needs to know it is connected. A bot that took commands from a
 * channel would be a remote control for the tracker, gated on IRC's idea of
 * identity — and IRC does not have one.
 *
 * It also never joins more than one channel, and never speaks to a user. An
 * announce bot with a private-message surface is an invitation to social
 * engineering with no upside.
 *
 * ## Flood
 *
 * Servers kill clients that talk too fast, and the penalty is a disconnect
 * mid-burst — which on a tracker means the ten releases a moderator just
 * accepted are the ten nobody hears about. So writes go through a queue with a
 * minimum interval, and the queue is bounded: past its cap the OLDEST lines are
 * dropped, because on an announce channel a stale release is worth less than a
 * fresh one.
 */
import net from 'node:net';
import tls from 'node:tls';

export interface IrcConfig {
  host: string;
  port: number;
  tls: boolean;
  /** Sent as-is before registration when set (server password, not NickServ). */
  serverPassword?: string;
  nick: string;
  /** Some networks require a suffix on a bot's nick to let it into #announce. */
  realname?: string;
  /** SASL PLAIN. Preferred over NickServ when the network offers it. */
  saslUser?: string;
  saslPassword?: string;
  /** Raw lines sent once, after registration, before JOIN. NickServ identify,
   *  an invite request to a channel bot, whatever the network needs. */
  perform?: string[];
  channel: string;
  channelKey?: string;
}

export type IrcState =
  | 'idle'
  | 'connecting'
  | 'registering'
  | 'joining'
  | 'ready'
  | 'error';

export interface IrcStatus {
  state: IrcState;
  /** The nick actually in use — a collision may have changed it. */
  nick: string;
  since: number | null;
  lastError: string | null;
  queued: number;
  sent: number;
  dropped: number;
}

const WRITE_INTERVAL_MS = 1_500;
/** No byte in either direction for this long means the peer is gone. */
const IDLE_TIMEOUT_MS = 300_000;
/** Our own keepalive, comfortably inside the deadline above. */
const PING_EVERY_MS = 120_000;
const QUEUE_CAP = 200;
const CONNECT_TIMEOUT_MS = 20_000;
/** A registration that never completes is indistinguishable from a hung socket
 *  at the protocol level, so it gets its own deadline. */
const REGISTER_TIMEOUT_MS = 45_000;

export interface IrcClientEvents {
  onState?: (status: IrcStatus) => void;
  onLog?: (line: string) => void;
}

export class IrcClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer = '';
  private state: IrcState = 'idle';
  private nick: string;
  private since: number | null = null;
  private lastError: string | null = null;
  private queue: string[] = [];
  private sentCount = 0;
  private droppedCount = 0;
  private timer: NodeJS.Timeout | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private registerTimer: NodeJS.Timeout | null = null;
  private pinger: NodeJS.Timeout | null = null;
  /** When the last PRIVMSG actually went out, for the pacing above. */
  private lastSentAt = 0;
  private nickAttempt = 0;
  private closed = false;

  constructor(
    private readonly config: IrcConfig,
    private readonly events: IrcClientEvents = {}
  ) {
    this.nick = config.nick;
  }

  status(): IrcStatus {
    return {
      state: this.state,
      nick: this.nick,
      since: this.since,
      lastError: this.lastError,
      queued: this.queue.length,
      sent: this.sentCount,
      dropped: this.droppedCount,
    };
  }

  /** Queue a message for the channel. Never throws, never blocks a caller. */
  say(message: string): void {
    if (this.closed) return;
    if (this.queue.length >= QUEUE_CAP) {
      // Oldest first: on an announce channel the fresh release is the one worth
      // saying, and a queue that drops the NEW line would hide exactly what the
      // members are waiting for.
      this.queue.shift();
      this.droppedCount++;
    }
    this.queue.push(message);
    this.pump();
  }

  connect(): void {
    if (this.socket || this.closed) return;
    this.setState('connecting');
    this.buffer = '';
    this.nickAttempt = 0;
    this.nick = this.config.nick;

    const onReady = () => {
      this.clearConnectTimer();
      this.setState('registering');
      this.armRegisterDeadline();
      // SASL has to be negotiated before registration completes, so the CAP
      // request goes first or not at all.
      if (this.config.saslUser && this.config.saslPassword) {
        this.raw('CAP REQ :sasl');
      }
      if (this.config.serverPassword) this.raw(`PASS ${this.config.serverPassword}`);
      this.raw(`NICK ${this.nick}`);
      this.raw(
        `USER ${this.nick} 0 * :${this.config.realname || 'Trackarr announce'}`
      );
    };

    try {
      if (this.config.tls) {
        const socket = tls.connect(
          {
            host: this.config.host,
            port: this.config.port,
            servername: this.config.host,
          },
          onReady
        );
        this.socket = socket;
      } else {
        const socket = net.connect(
          { host: this.config.host, port: this.config.port },
          onReady
        );
        this.socket = socket;
      }
    } catch (err) {
      this.fail((err as Error).message);
      return;
    }

    this.connectTimer = setTimeout(() => {
      this.fail(`no connection within ${CONNECT_TIMEOUT_MS / 1000}s`);
    }, CONNECT_TIMEOUT_MS);
    this.connectTimer.unref?.();

    this.socket.setEncoding('utf8');
    /**
     * A dead peer that never sends a FIN — a kernel panic, a partition, a
     * middlebox dropping the flow — leaves this socket open and the state
     * `ready` forever. The reconciler then sees a healthy client, keeps renewing
     * the lease, and every release is announced into nothing while the console
     * says the bot is in the channel. So: a traffic deadline, plus our own PING
     * on a shorter cadence so a merely quiet channel is not torn down.
     */
    this.socket.setTimeout(IDLE_TIMEOUT_MS, () => this.fail('no traffic'));
    this.pinger = setInterval(() => {
      if (this.state === 'ready') this.raw(`PING :${Date.now()}`);
    }, PING_EVERY_MS);
    this.pinger.unref?.();
    this.socket.on('data', (chunk: string) => this.onData(chunk));
    this.socket.on('error', (err: Error) => this.fail(err.message));
    this.socket.on('close', () => {
      if (!this.closed && this.state !== 'error') this.fail('connection closed');
    });
  }

  /** Close for good. A client that has been shut down never reconnects. */
  close(reason = 'shutting down'): void {
    this.closed = true;
    this.stopTimers();
    if (this.socket) {
      try {
        this.raw(`QUIT :${reason}`);
        this.socket.end();
      } catch {
        // The socket was already gone; nothing to say about it.
      }
      this.socket.destroy();
      this.socket = null;
    }
    this.setState('idle');
  }

  // ── protocol ──────────────────────────────────────────────────────────────

  private onData(chunk: string): void {
    this.buffer += chunk;
    // IRC frames on CRLF, but plenty of servers and bouncers send a bare LF.
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line) this.handleLine(line);
    }
    // A peer that never sends a newline would otherwise grow this without
    // bound. 8 KiB is sixteen times the longest legal frame.
    if (this.buffer.length > 8192) this.buffer = '';
  }

  private handleLine(line: string): void {
    this.events.onLog?.(line);

    if (line.startsWith('PING ')) {
      this.raw(`PONG ${line.slice(5)}`);
      return;
    }

    // :prefix COMMAND params… — the prefix is not needed for anything here.
    const parts = line.startsWith(':') ? line.slice(1).split(' ').slice(1) : line.split(' ');
    const command = parts[0]?.toUpperCase();

    switch (command) {
      case 'AUTHENTICATE': {
        if (parts[1] === '+' && this.config.saslUser && this.config.saslPassword) {
          const payload = Buffer.from(
            `${this.config.saslUser}\0${this.config.saslUser}\0${this.config.saslPassword}`,
            'utf8'
          ).toString('base64');
          // IRCv3 requires the payload in 400-byte chunks, and a bare `+` when
          // the length is an exact multiple — otherwise a long credential rides
          // past the 512-byte frame and authentication fails with no
          // diagnostic at all.
          for (let i = 0; i < payload.length; i += 400) {
            this.raw(`AUTHENTICATE ${payload.slice(i, i + 400)}`);
          }
          if (payload.length % 400 === 0) this.raw('AUTHENTICATE +');
        }
        return;
      }
      case 'CAP': {
        // ACK on the sasl cap is the go-ahead; anything else means the server
        // will not do SASL, and registration continues without it.
        if (parts[2]?.toUpperCase() === 'ACK') this.raw('AUTHENTICATE PLAIN');
        else if (parts[2]?.toUpperCase() === 'NAK') this.raw('CAP END');
        return;
      }
      case '903': // SASL succeeded
        this.raw('CAP END');
        return;
      case '904': // SASL failed
      case '905':
      case '906':
        // Not fatal on its own: a network may still let an unauthenticated bot
        // into a keyed channel, and failing here would hide that. The error is
        // recorded so the operator sees why the channel refused them.
        this.lastError = 'SASL authentication refused';
        this.raw('CAP END');
        return;
      case '001': {
        // Registered. Perform lines first — an invite request has to land
        // before the JOIN it enables.
        for (const raw of this.config.perform ?? []) {
          if (raw.trim()) this.raw(raw.trim());
        }
        this.setState('joining');
        this.raw(
          this.config.channelKey
            ? `JOIN ${this.config.channel} ${this.config.channelKey}`
            : `JOIN ${this.config.channel}`
        );
        return;
      }
      case '366': {
        // End of NAMES for the channel we asked for: we are in.
        if (parts[2]?.toLowerCase() === this.config.channel.toLowerCase()) {
          this.since = Date.now();
          this.setState('ready');
          this.pump();
        }
        return;
      }
      case '433':
      case '436': {
        // Nick taken. Bots reconnect faster than servers time out ghosts, so a
        // collision with our own previous session is the common case rather
        // than the interesting one.
        this.nickAttempt++;
        if (this.nickAttempt > 3) {
          this.fail('nick unavailable after three attempts');
          return;
        }
        this.nick = `${this.config.nick}${this.nickAttempt}`;
        this.raw(`NICK ${this.nick}`);
        return;
      }
      case '473': // +i, invite only
      case '475': // wrong key
      case '474': // banned
      case '471': // full
        this.fail(`channel refused the bot (${command})`);
        return;
      case 'KILL':
        this.fail('killed by the server');
        return;
      case 'ERROR':
        this.fail(line.slice(0, 200));
        return;
      default:
        return;
    }
  }

  private raw(line: string): void {
    if (!this.socket) return;
    // One frame, one line — a caller that managed to smuggle a newline in here
    // would be writing a second command.
    const safe = line.replace(/[\r\n]/g, ' ');
    try {
      this.socket.write(`${safe}\r\n`);
    } catch (err) {
      this.fail((err as Error).message);
    }
  }

  /**
   * Drain the queue, one line per `WRITE_INTERVAL_MS`.
   *
   * The interval is measured from the LAST line actually sent, not from the
   * start of a drain. The first version armed its timer only when the queue was
   * still non-empty after a shift, so every `say()` that arrived to an empty
   * queue wrote immediately — which is every announce, since each one drains the
   * queue. Ten uploads accepted in the same second went out inside a
   * millisecond of each other, and an ircd answers that with a kill for excess
   * flood: the queue existed and paced nothing.
   */
  private pump(): void {
    if (this.timer || this.state !== 'ready' || this.queue.length === 0) return;

    const wait = Math.max(0, WRITE_INTERVAL_MS - (Date.now() - this.lastSentAt));
    const send = () => {
      this.timer = null;
      if (this.state !== 'ready') return;
      const next = this.queue.shift();
      if (next === undefined) return;
      this.raw(`PRIVMSG ${this.config.channel} :${next}`);
      this.lastSentAt = Date.now();
      this.sentCount++;
      if (this.queue.length > 0) {
        this.timer = setTimeout(send, WRITE_INTERVAL_MS);
        this.timer.unref?.();
      }
    };

    if (wait === 0) {
      send();
      return;
    }
    this.timer = setTimeout(send, wait);
    this.timer.unref?.();
  }

  private armRegisterDeadline(): void {
    // Kept in a field rather than discarded: without the handle a closed client
    // — and the config object holding its credentials — stayed reachable for the
    // length of the deadline after `close()`.
    this.registerTimer = setTimeout(() => {
      this.registerTimer = null;
      if (this.state === 'registering' || this.state === 'joining') {
        this.fail('registration did not complete');
      }
    }, REGISTER_TIMEOUT_MS);
    this.registerTimer.unref?.();
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private stopTimers(): void {
    this.clearConnectTimer();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.registerTimer) {
      clearTimeout(this.registerTimer);
      this.registerTimer = null;
    }
    if (this.pinger) {
      clearInterval(this.pinger);
      this.pinger = null;
    }
  }

  private fail(message: string): void {
    this.lastError = message;
    this.stopTimers();
    this.since = null;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.setState('error');
  }

  private setState(state: IrcState): void {
    if (this.state === state) return;
    this.state = state;
    this.events.onState?.(this.status());
  }
}

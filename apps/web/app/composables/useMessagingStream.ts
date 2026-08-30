/**
 * Live delivery for the messaging pages.
 *
 * Two things here are not the obvious implementation, and both exist
 * because of what happens when a relay node dies rather than what happens
 * when everything is fine.
 *
 * **The reconnection is ours, not `EventSource`'s.** The built-in one
 * retries after a fixed delay, so every client a dead node was holding
 * comes back at the same instant — each asking the API for a token and a
 * catch-up. The failure of one node becomes a correlated spike on the two
 * components it was meant to protect. Spreading a thousand reconnections
 * over a few seconds costs a few seconds; not spreading them costs the
 * next node.
 *
 * **The catch-up is not optional.** Valkey pub/sub keeps nothing, so a
 * three-second gap is a silent hole in the thread. It never shows in
 * development, where the connection does not drop. It is also what lets
 * the relay close a slow reader rather than feed it: the cut is
 * repairable.
 */

export interface StreamedMessage {
  id: string;
  conversationId: string;
  authorId: string | null;
  body: string | null;
  cipher: string | null;
  iv: string | null;
  createdAt: string;
}

interface TokenGrant {
  url: string;
  token: string;
  expiresAt: number;
}

export interface StreamHandlers {
  /** Private messages, already catch-up-merged. */
  onMessages?: (messages: StreamedMessage[]) => void;
  /**
   * Every frame, untouched. The room uses this: its events are not
   * conversation messages and do not belong in the catch-up window, which
   * is keyed on private-message timestamps.
   */
  onFrame?: (frame: Record<string, any>) => void;
}

export function useMessagingStream(handlers: StreamHandlers) {
  const connected = ref(false);
  /** Set when the gap was too wide to patch and the caller must refetch. */
  const needsReload = ref(false);

  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let stopped = false;
  /** The high-water mark the catch-up asks from. */
  let lastSeen = new Date().toISOString();

  async function catchUp() {
    // Only private messages have a gap worth repairing.
    if (!handlers.onMessages) return;
    try {
      const data = await $fetch<{
        messages: StreamedMessage[];
        truncated: boolean;
      }>('/api/messaging/catch-up', { query: { since: lastSeen } });

      if (data.truncated) {
        // Deliberately not "fetch more". Past the cap the whole view is
        // cheaper to rebuild than to patch, and every client of a dead
        // node is asking at the same moment.
        needsReload.value = true;
        return;
      }
      if (data.messages.length) accept(data.messages);
    } catch {
      // A failed catch-up is not fatal: the next reconnection tries again,
      // and the thread still reads correctly on a page load.
    }
  }

  function accept(messages: StreamedMessage[]) {
    for (const m of messages) {
      if (m.createdAt > lastSeen) lastSeen = m.createdAt;
    }
    handlers.onMessages?.(messages);
  }

  async function connect() {
    if (stopped) return;
    // Never two. `start()` is public and `onMounted` calls it, so a caller
    // that also calls it by hand would otherwise leave the first stream
    // open with nothing holding it.
    source?.close();
    source = null;
    let grant: TokenGrant;
    try {
      grant = await $fetch<TokenGrant>('/api/messaging/token');
    } catch (err) {
      /*
       * Only a 404 is a final answer.
       *
       * The route answers 404 when messaging is off or no relay is
       * configured — live delivery does not exist on this instance, and
       * giving up is right: the pages work by reloading.
       *
       * Everything else is transient and used to be treated the same way,
       * which meant giving up FOR THE LIFE OF THE PAGE. The route is
       * rate-limited at twelve a minute keyed on the caller's IP, and a
       * token is minted on every page load of both messaging surfaces —
       * so a member moving between them quickly, or sharing an exit with
       * anyone else, gets a 429 on arrival and the page then sits on
       * "offline" for ever with an idle relay one request away. A 401
       * from a session that expired mid-visit, or a 502 while the API
       * restarts, did the same.
       */
      const status = (err as { statusCode?: number })?.statusCode;
      if (status !== 404) scheduleReconnect();
      return;
    }

    await catchUp();
    if (stopped) return;

    const url = `${grant.url.replace(/\/$/, '')}/events?token=${encodeURIComponent(grant.token)}`;
    source = new EventSource(url);

    source.onopen = () => {
      connected.value = true;
      attempt = 0;
    };

    source.onmessage = (event) => {
      try {
        // Always an array, even for one message: the relay coalesces a
        // burst into a single frame, so the client has one shape to parse.
        const batch = JSON.parse(event.data) as Array<Record<string, any>>;

        // Every frame reaches whoever asked for raw frames…
        if (handlers.onFrame) for (const frame of batch) handlers.onFrame(frame);

        // …while private messages also move the catch-up high-water mark.
        // Room frames deliberately do not: the room has its own retention
        // and no gap to repair, and letting them advance the mark would
        // make a busy room hide a missed private message.
        const messages = batch
          .filter((f) => f.type === 'message')
          .map((f) => ({ ...f.message, conversationId: f.conversationId }));
        if (messages.length) accept(messages);
      } catch {
        // A frame we cannot parse is dropped rather than allowed to kill
        // the stream — the catch-up will bring it back.
      }
    };

    source.onerror = () => {
      connected.value = false;
      source?.close();
      source = null;
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (stopped) return;
    const delay = backoffDelay(attempt);
    attempt += 1;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void connect(), delay);
  }

  function start() {
    if (!import.meta.client) return;
    stopped = false;
    void connect();
  }

  function stop() {
    stopped = true;
    clearTimeout(retryTimer);
    source?.close();
    source = null;
    connected.value = false;
  }

  /*
   * Started here, not by the caller.
   *
   * It teardown itself on unmount and always has; the other end was left
   * to whoever used it, and the room forgot. `chat.vue` destructured
   * `connected` alone and never called `start()`, so the room has never
   * had live delivery in a browser — the relay ran, the token was minted,
   * the CORS and the CSP were right, and nothing ever opened the stream.
   * Only `/messages` called it, which is why only the room said "offline".
   *
   * `start` and `stop` stay exported for a caller that wants to suspend a
   * stream and bring it back; `connect()` closes any open source first, so
   * calling `start()` again is safe rather than a second connection.
   */
  onMounted(start);
  onBeforeUnmount(stop);

  return { connected, needsReload, start, stop };
}

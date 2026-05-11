/**
 * Client-side notifications store + SSE manager.
 *
 * Exposes a singleton (`useNotifications()`) that:
 *   - Holds the in-memory list of recent rows + the unread count.
 *   - Maintains exactly one `EventSource` connection to
 *     `/api/me/notifications/stream` while the user is signed in.
 *     Reconnects automatically when the browser drops the socket.
 *   - Offers helpers (`markRead`, `markAllRead`, `fetchInitial`,
 *     `loadMore`) that every consumer — the navbar bell and the
 *     dedicated `/notifications` page — shares.
 *
 * Why a composable, not a Pinia store: the data is read by exactly
 * two surfaces, the lifecycle is tied to the user session (we want
 * to close the SSE on sign-out), and we'd otherwise carry the
 * Pinia overhead for a single piece of state.
 */
import { useUserSession } from '#imports';

export interface NotificationRow {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsState {
  /** Reverse-chronological list. Bounded at MAX_IN_MEMORY by the
   *  composable so a long-running tab doesn't accumulate hundreds
   *  of rows in memory — the /notifications page paginates over
   *  the API for older entries. */
  items: NotificationRow[];
  /** Live unread count. Drives the navbar badge. */
  unreadCount: number;
  /** Whether the very first fetch has completed; the bell shows a
   *  skeleton until this flips true. */
  initialised: boolean;
  /** SSE connection status. `connecting` is a brief transitional
   *  state; the UI shows it as "live" once `connected` is true. */
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';
}

const MAX_IN_MEMORY = 50;
// Module-level singletons so every component sees the same state.
let store: NotificationsState | null = null;
let storeRef: Ref<NotificationsState> | null = null;
let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pollFallback: ReturnType<typeof setInterval> | null = null;
let pageVisibilityListener: (() => void) | null = null;

function makeStore(): NotificationsState {
  return {
    items: [],
    unreadCount: 0,
    initialised: false,
    status: 'idle',
  };
}

export function useNotifications() {
  if (!storeRef) {
    store = makeStore();
    storeRef = ref(store);
  }
  const state = storeRef;
  const { loggedIn } = useUserSession();

  /** Pull the initial page. Called on first mount and after every
   *  reconnect so the SSE stream's "what did I miss?" gap closes. */
  async function fetchInitial() {
    try {
      const res = await $fetch<{
        items: NotificationRow[];
        unreadCount: number;
      }>('/api/me/notifications', {
        query: { limit: MAX_IN_MEMORY },
      });
      state.value.items = res.items;
      state.value.unreadCount = res.unreadCount;
      state.value.initialised = true;
    } catch {
      // Auth gate, transient network, etc. — leave the state
      // initialised flag false so the bell stays in skeleton.
    }
  }

  /** Paginate older rows for the /notifications page. */
  async function loadMore(cursor: string) {
    return await $fetch<{
      items: NotificationRow[];
      hasMore: boolean;
      nextCursor: string | null;
      unreadCount: number;
    }>('/api/me/notifications', {
      query: { cursor, limit: MAX_IN_MEMORY },
    });
  }

  async function markRead(id: string) {
    const target = state.value.items.find((n) => n.id === id);
    if (!target || target.readAt) return;
    // Optimistic update — server returns the same status either way.
    target.readAt = new Date().toISOString();
    state.value.unreadCount = Math.max(0, state.value.unreadCount - 1);
    try {
      await $fetch(`/api/me/notifications/${id}/read`, { method: 'POST' });
    } catch {
      // Roll back if the network failed so a re-read won't double-dec.
      target.readAt = null;
      state.value.unreadCount = state.value.unreadCount + 1;
    }
  }

  async function markAllRead() {
    const had = state.value.unreadCount;
    state.value.unreadCount = 0;
    for (const r of state.value.items) {
      if (!r.readAt) r.readAt = new Date().toISOString();
    }
    try {
      await $fetch('/api/me/notifications/read-all', { method: 'POST' });
    } catch {
      state.value.unreadCount = had;
    }
  }

  /** Insert a fresh row at the top of the list, capped at MAX_IN_MEMORY.
   *  De-duplicates by id so an out-of-order replay doesn't re-insert. */
  function ingest(row: NotificationRow) {
    if (state.value.items.some((r) => r.id === row.id)) return;
    state.value.items.unshift(row);
    if (state.value.items.length > MAX_IN_MEMORY) {
      state.value.items.length = MAX_IN_MEMORY;
    }
    if (!row.readAt) state.value.unreadCount++;
  }

  /** Open the SSE stream + wire reconnect. Idempotent — calling
   *  again while connected is a no-op. */
  function connectSSE() {
    if (typeof window === 'undefined') return;
    if (eventSource) return;
    state.value.status = 'connecting';
    try {
      eventSource = new EventSource('/api/me/notifications/stream', {
        withCredentials: true,
      });
    } catch (err) {
      // CSP or sandbox issues — fall through to poll-only mode.
      state.value.status = 'offline';
      startPollFallback();
      return;
    }

    eventSource.onopen = () => {
      state.value.status = 'connected';
      stopPollFallback();
      // The stream may have missed events while disconnected — a
      // catch-up fetch closes the gap. Cheap: one indexed query.
      void fetchInitial();
    };

    eventSource.onmessage = (ev) => {
      try {
        const row = JSON.parse(ev.data) as NotificationRow;
        ingest(row);
      } catch {
        // Heartbeat or malformed frame — ignore.
      }
    };

    eventSource.onerror = () => {
      // EventSource auto-reconnects on its own; we close + retry
      // explicitly with a short delay to avoid the "every 50ms"
      // tight loop some browsers fall into when the server is
      // unreachable.
      state.value.status = 'reconnecting';
      disconnectSSE();
      startPollFallback();
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (loggedIn.value) connectSSE();
        }, 5000);
      }
    };
  }

  function disconnectSSE() {
    if (eventSource) {
      try {
        eventSource.close();
      } catch {
        // already closed
      }
      eventSource = null;
    }
  }

  /** Poll fallback when SSE is unavailable (proxy stripping events,
   *  user behind a corporate firewall, etc). 60s cadence is
   *  generous; users actively interacting will refresh by clicking
   *  the bell anyway. */
  function startPollFallback() {
    if (pollFallback) return;
    pollFallback = setInterval(() => {
      void fetchInitial();
    }, 60_000);
  }
  function stopPollFallback() {
    if (pollFallback) {
      clearInterval(pollFallback);
      pollFallback = null;
    }
  }

  /** Boot the live channel. Safe to call multiple times — guards
   *  inside each helper short-circuit when already running. */
  function start() {
    if (!loggedIn.value) return;
    void fetchInitial();
    connectSSE();
    // Re-open the SSE when the tab becomes visible again — some
    // browsers freeze EventSource in background tabs and the
    // server's heartbeat times out the socket without us noticing.
    if (typeof document !== 'undefined' && !pageVisibilityListener) {
      pageVisibilityListener = () => {
        if (document.visibilityState === 'visible' && !eventSource) {
          connectSSE();
        }
      };
      document.addEventListener('visibilitychange', pageVisibilityListener);
    }
  }

  function stop() {
    disconnectSSE();
    stopPollFallback();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pageVisibilityListener && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', pageVisibilityListener);
      pageVisibilityListener = null;
    }
    state.value = makeStore();
  }

  // React to sign-in / sign-out automatically so consumers don't
  // have to thread the lifecycle themselves.
  watch(
    loggedIn,
    (v) => {
      if (v) start();
      else stop();
    },
    { immediate: true },
  );

  return {
    state: readonly(state),
    fetchInitial,
    loadMore,
    markRead,
    markAllRead,
  };
}

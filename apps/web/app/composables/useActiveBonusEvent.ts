/**
 * useActiveBonusEvent
 *
 * Singleton composable that polls `/api/bonus/active` (default every
 * 60 s) so any component can read whether a Freeleech / Silverleech /
 * custom bonus event is currently in flight.
 *
 * Backed by `useState` so multiple call sites (the navbar icon, the
 * details modal) share the same cache instead of each running their
 * own poll loop. The poll is started once on first registration and
 * stops when no consumer is left mounted.
 *
 * The composable is SSR-aware: on the server side we don't fetch
 * (the user-facing icon shouldn't block the initial paint) and the
 * client kicks off the first request after hydration.
 */
import { onMounted, onScopeDispose } from 'vue';

export interface ActiveBonusEvent {
  id: string;
  title: string;
  description: string | null;
  longDescription: string | null;
  /** basis points × 100 — divide by 100 for the human ×N value. */
  downloadMultiplier: number;
  uploadMultiplier: number;
  startsAt: string; // ISO 8601
  endsAt: string;
}

const POLL_INTERVAL_MS = 60_000;

export function useActiveBonusEvent() {
  const event = useState<ActiveBonusEvent | null>(
    'bonus-event-active',
    () => null
  );
  // Refcount of active consumers; the poll is only running while at
  // least one component is mounted that cares.
  const subscribers = useState<number>('bonus-event-subscribers', () => 0);
  // We stash the timer outside `useState` because functions don't
  // SSR-serialise; `null` until we boot the loop on the client.
  const timer = useState<ReturnType<typeof setInterval> | null>(
    'bonus-event-timer',
    () => null
  );

  async function refresh() {
    try {
      const res = await $fetch<{ event: ActiveBonusEvent | null }>(
        '/api/bonus/active'
      );
      event.value = res.event;
    } catch (err) {
      // Don't blow up the navbar over a transient API hiccup. Stale
      // state is fine — the next poll will recover.
      console.warn('[bonus] failed to refresh active event:', err);
    }
  }

  function start() {
    if (timer.value) return;
    refresh();
    timer.value = setInterval(refresh, POLL_INTERVAL_MS);
  }

  function stop() {
    if (timer.value) {
      clearInterval(timer.value);
      timer.value = null;
    }
  }

  onMounted(() => {
    if (import.meta.server) return;
    subscribers.value++;
    start();
  });

  onScopeDispose(() => {
    if (import.meta.server) return;
    subscribers.value = Math.max(0, subscribers.value - 1);
    if (subscribers.value === 0) stop();
  });

  return {
    event,
    refresh,
  };
}

// ── Display helpers (shared by navbar + modal) ──────────────

/** basis points × 100 → human "0.5", "1", "2.5" */
export function formatBonusMultiplier(bp: number): string {
  const x = bp / 100;
  return Number.isInteger(x)
    ? String(x)
    : x.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** Best-guess preset label for badge / icon decoration. */
export function bonusPresetLabel(
  downloadMultiplier: number,
  uploadMultiplier: number
): 'Freeleech' | 'Silverleech' | 'Bonus' {
  if (downloadMultiplier === 0 && uploadMultiplier === 100) return 'Freeleech';
  if (downloadMultiplier === 50 && uploadMultiplier === 100)
    return 'Silverleech';
  return 'Bonus';
}

/** Human countdown like "10j 10h" / "2h 3m" / "45s". */
export function bonusCountdown(endsAt: string, now: Date = new Date()): string {
  const ms = new Date(endsAt).getTime() - now.getTime();
  if (ms <= 0) return 'ended';
  const totalS = Math.floor(ms / 1000);
  const days = Math.floor(totalS / 86_400);
  const hours = Math.floor((totalS % 86_400) / 3_600);
  const minutes = Math.floor((totalS % 3_600) / 60);
  const seconds = totalS % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

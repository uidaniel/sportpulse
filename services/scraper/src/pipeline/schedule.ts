import { DateTime } from "luxon";

export interface ActiveWindow {
  timezone: string;
  start: string; // "HH:MM" or "HH:MM:SS"
  end: string;
}

/**
 * Delay (ms) before delivering a post to a user with an active posting window.
 *   0  -> deliver now (we're inside the window, or the window is invalid)
 *   >0 -> ms until the window next opens (the post is held until then)
 * Handles normal daytime windows (start < end) and overnight ones (start > end).
 */
export function sendDelayMs(w: ActiveWindow): number {
  const now = DateTime.now().setZone(w.timezone);
  if (!now.isValid) return 0; // bad timezone -> don't hold the post

  const [sh, sm] = w.start.split(":").map(Number);
  const [eh, em] = w.end.split(":").map(Number);
  const startToday = now.set({ hour: sh || 0, minute: sm || 0, second: 0, millisecond: 0 });
  const endToday = now.set({ hour: eh || 0, minute: em || 0, second: 59, millisecond: 0 });

  const sameDay = startToday <= endToday;
  const inWindow = sameDay
    ? now >= startToday && now <= endToday
    : now >= startToday || now <= endToday; // window wraps midnight

  if (inWindow) return 0;

  const nextOpen = now >= startToday ? startToday.plus({ days: 1 }) : startToday;
  return Math.max(0, Math.round(nextOpen.toMillis() - now.toMillis()));
}

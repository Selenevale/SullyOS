/**
 * Private SullyOS baseline: the startup auto-updater is deliberately disabled.
 *
 * Opening the app must never instruct a remotely hosted Worker to fetch code
 * from a third-party source or to redeploy itself. Deploy reviewed versions
 * manually in Cloudflare. Preserve the exports used by older UI/tests, but
 * every action picker and startup entrypoint is inert.
 */

import type { AmsgWorkerVersionProbe } from './activeMsgClient';

export const STARTUP_UPDATE_CHECK_MIN_INTERVAL_MS = 6 * 60 * 60_000;
export const STARTUP_UPDATE_CHECK_STORAGE_KEY = 'amsg_worker_update_check';

export interface StartupUpdateCheckMarker {
  buildLabel: string;
  atMs: number;
}

/** Kept for compatibility with previous startup-check bookkeeping. */
export const shouldRequestStartupUpdateCheck = (
  marker: StartupUpdateCheckMarker | null,
  buildLabel: string,
  nowMs: number,
): boolean => {
  if (!marker) return true;
  if (marker.buildLabel !== buildLabel) return true;
  return nowMs - marker.atMs >= STARTUP_UPDATE_CHECK_MIN_INTERVAL_MS;
};

export const readStartupUpdateCheckMarker = (): StartupUpdateCheckMarker | null => {
  try {
    const raw = localStorage.getItem(STARTUP_UPDATE_CHECK_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StartupUpdateCheckMarker> | null;
    if (!value || typeof value.buildLabel !== 'string' || typeof value.atMs !== 'number') return null;
    return { buildLabel: value.buildLabel, atMs: value.atMs };
  } catch {
    return null;
  }
};

/** Outdated/current worker status can never authorize code self-updates. */
export const pickStartupUpdateAction = (
  _probe: Pick<AmsgWorkerVersionProbe, 'state' | 'autoUpdate'>,
): 'none' => 'none';

/** No remote update request, version fetch, or local bookkeeping occurs. */
export const requestStartupUpdateCheck = async (
  _nowMs = Date.now(),
  _buildLabel?: string,
): Promise<'skipped'> => 'skipped';

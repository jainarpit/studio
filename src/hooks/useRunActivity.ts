import { useSyncExternalStore } from "react";
import { activeRuns, runNotices, subscribeRunActivity, type ActiveRun, type RunNotice } from "../lib/runActivity";

/** Collection runs in progress, for the status bar on any page. */
export function useActiveRuns(): ActiveRun[] {
  return useSyncExternalStore(subscribeRunActivity, activeRuns);
}

/** Notices for runs that just finished. */
export function useRunNotices(): RunNotice[] {
  return useSyncExternalStore(subscribeRunActivity, runNotices);
}

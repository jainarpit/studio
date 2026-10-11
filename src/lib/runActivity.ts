import type { StepResult } from "./collectionRun";

/**
 * Collection runs in progress, and the notices for runs that just finished.
 * Kept outside React, like the console, so the status bar on any page can show
 * a run going on elsewhere, whether the developer or an agent started it.
 */

export interface ActiveRun {
  collectionId: string;
  runId: string;
  name: string;
  /** Steps in the collection. */
  total: number;
  /** Steps finished so far. */
  done: number;
  /** The agent that started it, when one did. */
  startedBy?: string;
}

export interface RunNotice {
  collectionId: string;
  runId: string;
  name: string;
  passed: boolean;
  /** One line, such as "5 steps passed · 1.2 s" or "failed at step 3 (Pay order): …". */
  text: string;
  startedBy?: string;
}

/** How long a notice for a run that passed stays up. One that failed stays until dismissed. */
export const PASSED_NOTICE_MS = 8000;
const MAX_NOTICES = 3;

let active: ActiveRun[] = [];
let notices: RunNotice[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function changed(): void {
  for (const listener of listeners) listener();
}

export function subscribeRunActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Runs in progress, oldest first. A new array only when something changed. */
export function activeRuns(): ActiveRun[] {
  return active;
}

/** Notices for finished runs, newest first. */
export function runNotices(): RunNotice[] {
  return notices;
}

export function runStarted(run: Omit<ActiveRun, "done">): void {
  active = [...active.filter((r) => r.collectionId !== run.collectionId), { ...run, done: 0 }];
  changed();
}

export function runProgressed(collectionId: string, runId: string, done: number): void {
  const current = active.find((r) => r.collectionId === collectionId && r.runId === runId);
  if (!current || current.done === done) return;
  active = active.map((r) => (r === current ? { ...r, done } : r));
  changed();
}

export function runFinished(notice: RunNotice): void {
  active = active.filter((r) => !(r.collectionId === notice.collectionId && r.runId === notice.runId));
  notices = [notice, ...notices.filter((n) => n.collectionId !== notice.collectionId)].slice(0, MAX_NOTICES);
  const key = noticeKey(notice);
  clearTimeout(timers.get(key));
  if (notice.passed) {
    timers.set(
      key,
      setTimeout(() => dismissRunNotice(notice.runId), PASSED_NOTICE_MS),
    );
  }
  changed();
}

export function dismissRunNotice(runId: string): void {
  const next = notices.filter((n) => n.runId !== runId);
  if (next.length === notices.length) return;
  for (const notice of notices) if (notice.runId === runId) clearTimeout(timers.get(noticeKey(notice)));
  notices = next;
  changed();
}

function noticeKey(notice: RunNotice): string {
  return `${notice.collectionId}:${notice.runId}`;
}

/** For tests: forget every run and notice. */
export function resetRunActivity(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  active = [];
  notices = [];
  changed();
}

// Wording

/** "Running Orders lifecycle · step 2 of 5", for the status bar. */
export function describeActive(run: ActiveRun): string {
  const step = Math.min(run.done + 1, run.total);
  return `Running ${run.name} · step ${step} of ${run.total}`;
}

/**
 * The one line a finished run gets: how many steps passed and how long it took,
 * or which step failed first and why.
 */
export function describeFinished(
  results: readonly StepResult[],
  stepNames: readonly string[],
): { passed: boolean; text: string } {
  const failedAt = results.findIndex((r) => r.verdict === "fail");
  if (failedAt >= 0) {
    // The first line only: a reason can carry a longer explanation after it.
    const reason = results[failedAt].reason?.split("\n")[0].trim().replace(/\.$/, "");
    const name = stepNames[failedAt] ?? results[failedAt].key;
    return {
      passed: false,
      text: `failed at step ${failedAt + 1} (${name})${reason ? `: ${reason}` : ""}`,
    };
  }
  const notRun = results.filter((r) => r.verdict === "not_run").length;
  const ms = results.reduce((sum, r) => sum + (r.ms ?? 0), 0);
  const ran = results.length - notRun;
  const steps = `${ran} step${ran === 1 ? "" : "s"}`;
  if (notRun) {
    return { passed: false, text: `stopped · ${steps} passed, ${notRun} not run` };
  }
  return { passed: true, text: `passed · ${steps} · ${formatMs(ms)}` };
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

// Opening a run from anywhere

type OpenRun = (collectionId: string, runId?: string) => void;
let openRunHandler: OpenRun | null = null;

/** The app says how to show a collection's runs; the status bar and notices ask for it. */
export function setOpenRunHandler(handler: OpenRun | null): void {
  openRunHandler = handler;
}

export function openRun(collectionId: string, runId?: string): void {
  openRunHandler?.(collectionId, runId);
}

/**
 * Whether to take the developer to a run's log when it finishes: only when
 * they started it themselves and are still looking at that collection. A run
 * an agent started, or one that ends while they're elsewhere, gets a notice.
 */
export function showLogWhenFinished(
  notice: Pick<RunNotice, "collectionId" | "startedBy">,
  here: { route: string; collectionId: string | null },
): boolean {
  return !notice.startedBy && here.route === "collections" && here.collectionId === notice.collectionId;
}

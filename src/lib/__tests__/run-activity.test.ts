/**
 * Runs in progress and the notices for finished ones, which the status bar and
 * every page show, plus the agent chat's width when it's docked next to a page.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StepResult } from "../collectionRun";
import {
  PASSED_NOTICE_MS,
  activeRuns,
  describeActive,
  describeFinished,
  dismissRunNotice,
  openRun,
  resetRunActivity,
  runFinished,
  runNotices,
  runProgressed,
  runStarted,
  setOpenRunHandler,
  showLogWhenFinished,
  subscribeRunActivity,
} from "../runActivity";
import { CHAT_WIDTH, chatWidthAfterKey, clampChatWidth } from "../agentChatPanel";

afterEach(() => {
  resetRunActivity();
  setOpenRunHandler(null);
  vi.useRealTimers();
});

const pass = (key: string, ms = 100): StepResult => ({ key, verdict: "pass", status: 200, ms });

describe("describing a run", () => {
  it("says which step is running, the same way the collection's page does", () => {
    const run = { collectionId: "c1", runId: "r1", name: "Orders lifecycle", total: 5, done: 1 };
    expect(describeActive(run)).toBe("Running Orders lifecycle · step 2 of 5");
    expect(describeActive({ ...run, done: 5 })).toBe("Running Orders lifecycle · step 5 of 5");
  });

  it("says how many steps passed and how long they took", () => {
    expect(describeFinished([pass("a", 400), pass("b", 800)], ["Create order", "Get order"])).toEqual({
      passed: true,
      text: "passed · 2 steps · 1.2 s",
    });
    expect(describeFinished([pass("a", 40)], ["Create order"]).text).toBe("passed · 1 step · 40 ms");
  });

  it("names the first step that failed, and why", () => {
    const results: StepResult[] = [
      pass("create"),
      pass("get"),
      { key: "pay", verdict: "fail", status: 409, reason: "Expected 201, got 409." },
      { key: "ship", verdict: "not_run", reason: "Not run: an earlier step failed." },
    ];
    expect(describeFinished(results, ["Create order", "Get order", "Pay order", "Ship order"])).toEqual({
      passed: false,
      text: "failed at step 3 (Pay order): Expected 201, got 409",
    });
  });

  it("keeps only the first line of a long reason", () => {
    const results: StepResult[] = [{ key: "a", verdict: "fail", reason: "Failed to fetch\n\n(Browser preview: probably CORS.)" }];
    expect(describeFinished(results, ["Get order"]).text).toBe("failed at step 1 (Get order): Failed to fetch");
  });

  it("calls a run that was stopped before the end stopped, not passed", () => {
    const results: StepResult[] = [pass("a"), { key: "b", verdict: "not_run", reason: "Stopped." }];
    expect(describeFinished(results, ["A", "B"])).toEqual({ passed: false, text: "stopped · 1 step passed, 1 not run" });
  });
});

describe("runs in progress and notices", () => {
  it("follows a run from start to finish, and tells listeners", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRunActivity(listener);
    runStarted({ collectionId: "c1", runId: "r1", name: "Orders", total: 3, startedBy: "Codex" });
    expect(activeRuns()).toEqual([{ collectionId: "c1", runId: "r1", name: "Orders", total: 3, done: 0, startedBy: "Codex" }]);

    runProgressed("c1", "r1", 2);
    expect(activeRuns()[0].done).toBe(2);
    // A progress report for a run that isn't going on changes nothing.
    runProgressed("c1", "old-run", 3);
    expect(activeRuns()[0].done).toBe(2);

    runFinished({ collectionId: "c1", runId: "r1", name: "Orders", passed: true, text: "passed · 3 steps · 1.0 s" });
    expect(activeRuns()).toEqual([]);
    expect(runNotices()[0]).toMatchObject({ runId: "r1", passed: true });
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("keeps several runs going at once", () => {
    runStarted({ collectionId: "c1", runId: "r1", name: "Orders", total: 3 });
    runStarted({ collectionId: "c2", runId: "r2", name: "Payments", total: 2 });
    expect(activeRuns().map((r) => r.name)).toEqual(["Orders", "Payments"]);
    runFinished({ collectionId: "c1", runId: "r1", name: "Orders", passed: true, text: "passed" });
    expect(activeRuns().map((r) => r.name)).toEqual(["Payments"]);
  });

  it("takes a notice for a run that passed down by itself, and keeps one for a failure", () => {
    vi.useFakeTimers();
    runFinished({ collectionId: "c1", runId: "r1", name: "Orders", passed: true, text: "passed" });
    runFinished({ collectionId: "c2", runId: "r2", name: "Payments", passed: false, text: "failed at step 1 (Pay)" });
    expect(runNotices().map((n) => n.runId)).toEqual(["r2", "r1"]);
    vi.advanceTimersByTime(PASSED_NOTICE_MS + 1);
    expect(runNotices().map((n) => n.runId)).toEqual(["r2"]);
    dismissRunNotice("r2");
    expect(runNotices()).toEqual([]);
  });

  it("shows one notice per collection, the latest, and at most three", () => {
    runFinished({ collectionId: "c1", runId: "r1", name: "A", passed: false, text: "failed" });
    runFinished({ collectionId: "c1", runId: "r2", name: "A", passed: false, text: "failed again" });
    expect(runNotices().map((n) => n.runId)).toEqual(["r2"]);
    for (const id of ["c2", "c3", "c4"]) {
      runFinished({ collectionId: id, runId: `run-${id}`, name: id, passed: false, text: "failed" });
    }
    expect(runNotices()).toHaveLength(3);
    expect(runNotices()[0].collectionId).toBe("c4");
  });

  it("opens a run through whatever the app set up, and does nothing before that", () => {
    expect(() => openRun("c1", "r1")).not.toThrow();
    const handler = vi.fn();
    setOpenRunHandler(handler);
    openRun("c1", "r1");
    expect(handler).toHaveBeenCalledWith("c1", "r1");
  });
});

describe("after a run", () => {
  const notice = { collectionId: "c1" };
  it("shows the log of a run the developer started from that collection", () => {
    expect(showLogWhenFinished(notice, { route: "collections", collectionId: "c1" })).toBe(true);
  });
  it("leaves the developer where they are otherwise", () => {
    expect(showLogWhenFinished({ ...notice, startedBy: "Codex" }, { route: "collections", collectionId: "c1" })).toBe(false);
    expect(showLogWhenFinished(notice, { route: "collections", collectionId: "c2" })).toBe(false);
    expect(showLogWhenFinished(notice, { route: "api", collectionId: "c1" })).toBe(false);
  });
});

describe("the agent chat's width", () => {
  it("stays within its limits and leaves the page room", () => {
    expect(clampChatWidth(100, 1600)).toBe(CHAT_WIDTH.min);
    expect(clampChatWidth(5000, 1600)).toBe(CHAT_WIDTH.max);
    expect(clampChatWidth(500, 1600)).toBe(500);
    // In a 1000 px window the page keeps 580 px, so the chat can be at most 420.
    expect(clampChatWidth(700, 1000)).toBe(1000 - CHAT_WIDTH.page);
    // Too narrow for both: the chat gets its minimum.
    expect(clampChatWidth(500, 600)).toBe(CHAT_WIDTH.min);
    expect(clampChatWidth(Number.NaN, 1600)).toBe(CHAT_WIDTH.initial);
  });

  it("can be resized from the keyboard", () => {
    expect(chatWidthAfterKey("ArrowLeft", 400, 1600)).toBe(424);
    expect(chatWidthAfterKey("ArrowRight", 400, 1600)).toBe(376);
    expect(chatWidthAfterKey("Home", 400, 1600)).toBe(CHAT_WIDTH.max);
    expect(chatWidthAfterKey("End", 400, 1600)).toBe(CHAT_WIDTH.min);
    expect(chatWidthAfterKey("Enter", 400, 1600)).toBeNull();
  });
});

import type { ReactNode } from "react";
import { MessageSquare, SquareTerminal } from "lucide-react";
import { toggleConsole } from "../lib/appConsole";
import { isMac } from "../lib/platform";
import { inTauri } from "../lib/request";
import { consoleShortcutLabel } from "../lib/shortcuts";
import { agentChatShortcutLabel, toggleAgentChatPanel } from "../lib/agentChatPanel";
import { useAgentChatPanelOpen } from "../hooks/useAgentChatPanelOpen";
import { useAppConsole } from "../hooks/useAppConsole";
import { useActiveRuns } from "../hooks/useRunActivity";
import { describeActive, openRun, type ActiveRun } from "../lib/runActivity";

interface Props {
  /** The leading text: what is on screen. */
  summary: ReactNode;
  envName?: string | null;
  /** The spec0 org, when signed in and the view shows it. */
  orgName?: string | null;
  /** The last response, for its status and time. */
  result: { status: number; ms: number } | null;
}

/** The bottom bar: what is open, the environment, how requests are sent, and the last result. */
export function StatusBar({ summary, envName, orgName, result }: Props) {
  const { open, unseenErrors } = useAppConsole();
  const chatOpen = useAgentChatPanelOpen();
  const running = useActiveRuns();
  return (
    <div className="statusbar">
      <span className="statusbar-summary">{summary}</span>
      {running.length > 0 && <RunIndicator runs={running} />}
      {envName != null && <span>env: {envName}</span>}
      {orgName != null && <span>spec0: {orgName}</span>}
      <span className="statusbar-transport">
        {inTauri ? "requests via Rust · no CORS" : "browser preview · CORS applies"}
      </span>
      {result && (
        <span>
          {result.status} · {result.ms}ms
        </span>
      )}
      <button
        type="button"
        className={`statusbar-console${open ? " on" : ""}`}
        aria-pressed={open}
        aria-label={`Console${unseenErrors ? `, ${unseenErrors} new error${unseenErrors === 1 ? "" : "s"}` : ""}`}
        title={`Console: requests, runs, local mock, MCP and chat activity (${consoleShortcutLabel(isMac)})`}
        onClick={toggleConsole}
      >
        <SquareTerminal size={12} aria-hidden /> Console
        {unseenErrors > 0 && <span className="statusbar-badge">{unseenErrors > 99 ? "99+" : unseenErrors}</span>}
      </button>
      {inTauri && (
        <button
          type="button"
          className={`statusbar-console${chatOpen ? " on" : ""}`}
          aria-pressed={chatOpen}
          title={`Chat with your coding agent (${agentChatShortcutLabel(isMac)})`}
          onClick={toggleAgentChatPanel}
        >
          <MessageSquare size={12} aria-hidden /> Agent
        </button>
      )}
    </div>
  );
}

/**
 * A collection running anywhere in Studio, started here or by an agent: its
 * name, the step it's on and a progress bar. Clicking it opens its runs.
 */
function RunIndicator({ runs }: { runs: ActiveRun[] }) {
  const run = runs[runs.length - 1];
  const others = runs.length - 1;
  const by = run.startedBy ? ` (started by ${run.startedBy})` : "";
  return (
    <button
      type="button"
      className="statusbar-run"
      title={runs.map((r) => describeActive(r) + (r.startedBy ? ` · ${r.startedBy}` : "")).join("\n")}
      onClick={() => openRun(run.collectionId, run.runId)}
    >
      <span className="statusbar-run-text">
        {describeActive(run)}
        {by}
        {others > 0 ? ` · ${others} more running` : ""}
      </span>
      <progress className="statusbar-run-bar" max={Math.max(run.total, 1)} value={run.done} aria-hidden />
    </button>
  );
}

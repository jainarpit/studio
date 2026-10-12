import { useEffect, useState } from "react";
import { Check, CheckCircle2, Copy, Loader2, RefreshCw } from "lucide-react";
import type { useAgentChatSettings } from "../../hooks/useAgentChatSettings";
import { testAgent } from "../../lib/agentChatTest";
import {
  AGENT_CHAT_DOCS_URL,
  codeSpans,
  initialStep,
  setupRows,
  stepAfterTest,
  type SetupAgentId,
  type SetupRow,
  type SetupStep,
} from "../../lib/agentSetup";
import { openInBrowser } from "../../lib/store";
import { AnthropicKeyField } from "./AnthropicKeyField";

interface Props {
  settings: ReturnType<typeof useAgentChatSettings>;
  onOpenSettings: () => void;
  /** Setup is finished: show the chat. */
  onDone: () => void;
}

/** Text with `code` spans shown in the mono font. */
function Spans({ text }: { text: string }) {
  return (
    <>
      {codeSpans(text).map((part, index) =>
        part.code ? (
          <code key={index} className="mono">
            {part.text}
          </code>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** A command with a button that copies it. */
function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="setup-command">
      <code className="mono">{command}</code>
      <button
        className="icon-btn tight"
        aria-label={`Copy ${command}`}
        title="Copy"
        onClick={() =>
          void navigator.clipboard
            ?.writeText(command)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => undefined)
        }
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}

/**
 * "Set up your agent": shown in the chat panel until an agent is chosen and
 * connects. Lists the agents on this computer and how each signs in, tests the
 * one picked, and says what to do when that fails. Settings → Agent chat has
 * the same choices and more; both use the same saved prefs.
 */
export function AgentSetup({ settings, onOpenSettings, onDone }: Props) {
  const { agents, searching, findAgents, prefs, setPrefs } = settings;
  const [keySaved, setKeySaved] = useState(false);
  const [tested, setTested] = useState<SetupStep | null>(null);

  useEffect(() => {
    if (agents === null && !searching) void findAgents();
  }, [agents, searching, findAgents]);

  const step = tested ?? initialStep(agents, searching);
  const rows = setupRows(agents ?? [], keySaved);

  const pick = async (agent: SetupAgentId) => {
    await setPrefs({ agent });
    setTested({ kind: "testing", agent });
    const result = await testAgent(agent, prefs.workspace);
    setTested(stepAfterTest(agent, result));
  };

  const nameOf = (id: SetupAgentId) => rows.found.find((row) => row.id === id)?.name ?? id;
  const busy = step.kind === "testing";

  return (
    <div className="agent-setup">
      <h2 className="agent-setup-title">Set up your agent</h2>
      <p>
        Chat with a coding agent you already use. Studio starts it on this computer, signed in with your own account,
        and gives it Studio&apos;s tools for calling, testing and mocking your APIs.
      </p>

      {step.kind === "searching" && (
        <p className="field-meta" role="status">
          <Loader2 size={12} className="spin" /> Looking for agents on this computer…
        </p>
      )}

      {step.kind === "testing" && (
        <div className="agent-setup-result" role="status">
          <Loader2 size={13} className="spin" /> Starting {nameOf(step.agent)} to check that it connects…
        </div>
      )}

      {step.kind === "failed" && (
        <div className="error-box agent-setup-result" role="alert">
          <strong>{nameOf(step.agent)} didn&apos;t connect.</strong>
          <div className="agent-test-fail">{step.text}</div>
          <div className="settings-actions">
            <button className="btn" onClick={() => void pick(step.agent)}>
              <RefreshCw size={12} /> Test again
            </button>
            <button className="btn ghost" onClick={() => setTested({ kind: "choose" })}>
              Choose another agent
            </button>
          </div>
        </div>
      )}

      {step.kind === "ready" && (
        <div className="agent-test agent-setup-result" role="status">
          <strong>
            <CheckCircle2 size={13} aria-hidden /> {nameOf(step.agent)} is ready.
          </strong>{" "}
          {step.text}
          <div className="settings-actions">
            <button className="btn primary" onClick={onDone}>
              Start chatting
            </button>
          </div>
        </div>
      )}

      {step.kind === "none-found" && (
        <p className="field-meta">
          No agent was found on this computer. Install one of these, then look again.
        </p>
      )}

      {step.kind !== "searching" && step.kind !== "ready" && rows.found.length > 0 && (
        <section aria-label="Agents on this computer" className="agent-setup-list">
          <h3>On this computer</h3>
          {rows.found.map((row) => (
            <AgentRow
              key={row.id}
              row={row}
              chosen={prefs.agent === row.id}
              busy={busy}
              onPick={() => void pick(row.id)}
              onKeySaved={setKeySaved}
            />
          ))}
        </section>
      )}

      {step.kind !== "searching" && step.kind !== "ready" && rows.missing.length > 0 && (
        <section aria-label="Agents not found" className="agent-setup-list">
          <h3>Not found</h3>
          {rows.missing.map((row) => (
            <div key={row.id} className="agent-setup-row missing">
              <strong>{row.name}</strong>
              {row.install && (
                <p className="field-meta">
                  <Spans text={row.install.text} />
                </p>
              )}
              {row.install?.command && <CopyCommand command={row.install.command} />}
            </div>
          ))}
          <button className="btn ghost" onClick={() => void findAgents()} disabled={searching}>
            <RefreshCw size={12} className={searching ? "spin" : undefined} /> Look again
          </button>
        </section>
      )}

      <p className="field-meta">
        What you send goes to the agent you choose and its model provider. Secret values from your environments are
        replaced by their <span className="mono">{"{{name}}"}</span> first.
      </p>
      <div className="agent-setup-links">
        <button className="btn ghost" onClick={onOpenSettings}>
          More in Settings
        </button>
        <button className="btn ghost" onClick={() => void openInBrowser(AGENT_CHAT_DOCS_URL)}>
          Read the guide
        </button>
      </div>
    </div>
  );
}

function AgentRow({
  row,
  chosen,
  busy,
  onPick,
  onKeySaved,
}: {
  row: SetupRow;
  chosen: boolean;
  busy: boolean;
  onPick: () => void;
  onKeySaved: (saved: boolean) => void;
}) {
  const needsKey = row.state === "needs-key";
  return (
    <div className={`agent-setup-row${chosen ? " chosen" : ""}`}>
      <div className="agent-setup-row-head">
        <strong>{row.name}</strong>
        <span className="spacer" />
        <button
          className="btn primary"
          onClick={onPick}
          disabled={busy}
          title={needsKey ? "Save an Anthropic API key below first" : `Use ${row.name} and test the connection`}
        >
          Use {row.name}
        </button>
      </div>
      <p className="field-meta">
        <Spans text={row.signIn} />
      </p>
      {row.state === "needs-cli" && row.install && (
        <>
          <p className="field-meta warn">
            <Spans text={row.install.text} />
          </p>
          {row.install.command && <CopyCommand command={row.install.command} />}
        </>
      )}
      {row.id === "claude" && <AnthropicKeyField onSaved={onKeySaved} />}
    </div>
  );
}

import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleDashed,
  Info,
  Loader2,
  ShieldQuestion,
  Wrench,
  X,
} from "lucide-react";
import type { ChatItem } from "../../lib/acpClient";
import { studioLinkFor, type StudioLink } from "../../lib/agentChat";
import { Markdown } from "./Markdown";

interface Props {
  item: ChatItem;
  /** Answer a permission question. Absent for a conversation that's only being read. */
  onAnswer?: (id: string, optionId: string) => void;
  /** Show what a Studio tool made or ran. Absent where there's nowhere to go. */
  onOpenInStudio?: (link: StudioLink) => void;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "waiting",
  in_progress: "running",
  completed: "done",
  failed: "failed",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <Check size={12} aria-hidden />;
  if (status === "failed") return <X size={12} aria-hidden />;
  if (status === "in_progress") return <Loader2 size={12} className="spin" aria-hidden />;
  return <CircleDashed size={12} aria-hidden />;
}

/** One entry in the conversation. */
export function ChatItemView({ item, onAnswer, onOpenInStudio }: Props) {
  switch (item.kind) {
    case "user":
      return (
        <div className="chat-user">
          <div className="chat-user-text">{item.text}</div>
          {(item.mentions.length > 0 || item.context) && (
            <div className="chat-chips" aria-label="Attached">
              {item.context && (
                <details className="chat-context">
                  <summary className="chat-chip static" title="What this message told the agent about Studio">
                    <Info size={10} aria-hidden /> Studio context
                  </summary>
                  <div className="chat-context-text">{item.context}</div>
                </details>
              )}
              {item.mentions.map((label) => (
                <span key={label} className="chat-chip static">
                  @{label}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    case "agent":
      return (
        <div className="chat-agent">
          <Markdown text={item.text} />
        </div>
      );
    case "thought":
      return (
        <details className="chat-thought">
          <summary>
            <ChevronRight size={12} className="chat-caret" aria-hidden /> Thinking
          </summary>
          <div className="chat-thought-text">{item.text}</div>
        </details>
      );
    case "tool": {
      const link = onOpenInStudio ? studioLinkFor(item) : null;
      return (
        <details className={`chat-tool ${item.status}`}>
          <summary>
            <Wrench size={12} aria-hidden />
            <span className="chat-tool-title">{item.title}</span>
            {link && (
              <button
                className="btn ghost chat-tool-open"
                onClick={(event) => {
                  // A button inside <summary> would also open and close the card.
                  event.preventDefault();
                  onOpenInStudio?.(link);
                }}
                title={link.tool === "run_collection" ? "Show this run in Studio" : "Show this collection in Studio"}
              >
                Open in Studio <ArrowUpRight size={11} aria-hidden />
              </button>
            )}
            <span className={`chat-tool-status ${item.status}`}>
              <StatusIcon status={item.status} /> {STATUS_LABEL[item.status] ?? item.status}
            </span>
          </summary>
          {item.locations?.length ? <div className="chat-tool-where mono">{item.locations.join(", ")}</div> : null}
          {item.input && (
            <>
              <div className="chat-tool-label">Input</div>
              <pre className="chat-pre">{item.input}</pre>
            </>
          )}
          {item.output && (
            <>
              <div className="chat-tool-label">Output</div>
              <pre className="chat-pre">{item.output}</pre>
            </>
          )}
          {!item.input && !item.output && <div className="chat-tool-label">No details.</div>}
        </details>
      );
    }
    case "plan":
      return (
        <div className="chat-plan">
          <div className="chat-tool-label">Plan</div>
          <ol>
            {item.entries.map((entry, index) => (
              <li key={index} className={entry.status}>
                <StatusIcon status={entry.status} /> {entry.content}
              </li>
            ))}
          </ol>
        </div>
      );
    case "permission":
      return (
        <div className={`chat-permission ${item.state}`} role={item.state === "pending" ? "alertdialog" : undefined}>
          <div className="chat-permission-head">
            <ShieldQuestion size={14} aria-hidden />
            <span>
              {item.state === "pending" ? "The agent asks to: " : "The agent asked to: "}
              <strong>{item.title}</strong>
            </span>
          </div>
          {item.state === "pending" && onAnswer ? (
            <div className="chat-permission-actions">
              {item.options.map((option) => (
                <button
                  key={option.optionId}
                  className={`btn${option.kind.startsWith("allow") ? " primary" : ""}`}
                  onClick={() => onAnswer(item.id, option.optionId)}
                >
                  {option.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="chat-permission-answer">
              {item.state === "answered"
                ? `You chose: ${item.options.find((option) => option.optionId === item.chosen)?.name ?? item.chosen}`
                : "Not answered."}
            </div>
          )}
        </div>
      );
    case "notice":
      return (
        <div className={`chat-notice ${item.level}`} role={item.level === "error" ? "alert" : "status"}>
          {item.level === "error" && <AlertTriangle size={13} aria-hidden />}
          <Markdown text={item.text} />
        </div>
      );
  }
}

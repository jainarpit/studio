import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, AtSign, History, MessageSquarePlus, RefreshCw, Settings, Square, Trash2, X } from "lucide-react";
import { AGENT_NAMES, useAgentChat } from "../../hooks/useAgentChat";
import { useAgentChatSettings } from "../../hooks/useAgentChatSettings";
import { useAgentChatPanelOpen } from "../../hooks/useAgentChatPanelOpen";
import {
  agentChatShortcutLabel,
  isAgentChatShortcut,
  setAgentChatPanelOpen,
  toggleAgentChatPanel,
  chatWidthAfterKey,
  clampChatWidth,
  CHAT_WIDTH,
  saveChatWidth,
  savedChatWidth,
} from "../../lib/agentChatPanel";
import {
  chatSuggestions,
  filterChoices,
  type Mention,
  type MentionChoice,
  type SavedChat,
  type StudioContext,
  type StudioLink,
} from "../../lib/agentChat";
import { MCP_TOOLS } from "../../lib/mcp";
import { isMac } from "../../lib/platform";
import { inTauri } from "../../lib/request";
import { ChatItemView } from "./ChatItemView";

interface Props {
  /** What the @ menu can attach right now: operations, responses, steps, runs. */
  mentionChoices: () => MentionChoice[];
  /** What's open in Studio right now, for the note a chat starts with and the suggestions. */
  studioContext: () => StudioContext;
  /** Show a collection, or one of its runs, that the agent made through Studio's tools. */
  onOpenInStudio: (link: StudioLink) => void;
  onOpenSettings: () => void;
}

/** The names of Studio's tools, for the line that says they're connected. */
const TOOL_NAMES = MCP_TOOLS.map((tool) => tool.name);

const KIND_LABEL: Record<MentionChoice["kind"], string> = {
  operation: "Operation",
  response: "Response",
  step: "Step",
  run: "Run log",
};

const STATUS_TEXT = {
  idle: "",
  starting: "Starting the agent…",
  ready: "",
  working: "Working…",
  ended: "Chat ended",
} as const;

/**
 * The chat panel: a conversation with the coding agent the user picked in
 * Settings, on the right of the window. Always mounted, so a conversation
 * survives closing the panel; the agent process lives as long as the chat does.
 */
export function AgentChatPanel({ mentionChoices, studioContext, onOpenInStudio, onOpenSettings }: Props) {
  const open = useAgentChatPanelOpen();
  const chat = useAgentChat();
  const settings = useAgentChatSettings();
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [menu, setMenu] = useState<{ query: string; at: number | null } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [reading, setReading] = useState<SavedChat | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);
  const [width, setWidth] = useState(() => clampChatWidth(savedChatWidth(), window.innerWidth));
  const dragging = useRef<{ startX: number; startWidth: number } | null>(null);

  // Keep the chat inside the window when the window gets narrower.
  useEffect(() => {
    const onResize = () => setWidth((current) => clampChatWidth(current, window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The console spans the page, so it stops where the chat starts.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--agent-chat-space", open ? `${width}px` : "0px");
    return () => root.style.setProperty("--agent-chat-space", "0px");
  }, [open, width]);

  const resizeTo = (next: number) => {
    setWidth(next);
    saveChatWidth(next);
  };

  // ⌘⇧J / Ctrl+Shift+J, from anywhere in the window.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isAgentChatShortcut(event, { mac: isMac })) {
        event.preventDefault();
        toggleAgentChatPanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  // Without a chosen agent, the panel offers the ones it finds.
  const { prefs, loaded, agents, findAgents } = settings;
  useEffect(() => {
    if (open && loaded && !prefs.agent && agents === null) void findAgents();
  }, [open, loaded, prefs.agent, agents, findAgents]);

  // Follow the conversation while it's scrolled to the bottom.
  useEffect(() => {
    const el = list.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [chat.items, open]);

  const choices = useMemo(
    () => (menu ? filterChoices(mentionChoices(), menu.query).filter((c) => !mentions.some((m) => m.id === c.id)).slice(0, 40) : []),
    [menu, mentionChoices, mentions],
  );
  useEffect(() => setHighlight(0), [menu?.query]);

  if (!open) return null;

  const busy = chat.status === "starting" || chat.status === "working";
  const agentLabel =
    chat.agentName ??
    settings.agents?.find((agent) => agent.id === prefs.agent)?.name ??
    (prefs.agent ? AGENT_NAMES[prefs.agent] : null);

  const pick = (choice: MentionChoice) => {
    setMentions((current) => [...current, choice.build()]);
    if (menu?.at !== null && menu?.at !== undefined) {
      // Take the typed "@query" out of the message.
      const start = menu.at;
      const end = start + 1 + menu.query.length;
      setDraft((text) => text.slice(0, start) + text.slice(end));
    }
    setMenu(null);
    requestAnimationFrame(() => input.current?.focus());
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const attached = mentions;
    setDraft("");
    setMentions([]);
    setMenu(null);
    pinned.current = true;
    await chat.send(text, attached, studioContext());
  };

  const suggest = (text: string) => {
    if (busy) return;
    pinned.current = true;
    void chat.send(text, [], studioContext());
  };

  const onDraftChange = (value: string, caret: number) => {
    setDraft(value);
    // An "@" at the start of a word opens the menu; what follows filters it.
    const before = value.slice(0, caret);
    const match = /(^|\s)@([^\s@]{0,40})$/.exec(before);
    if (match) setMenu({ query: match[2], at: caret - match[2].length - 1 });
    else if (menu?.at !== null) setMenu(null);
  };

  return (
    <aside className="agent-chat" aria-label="Agent chat" style={{ width }}>
      <div
        className="agent-chat-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the agent chat"
        aria-valuemin={CHAT_WIDTH.min}
        aria-valuemax={CHAT_WIDTH.max}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = { startX: event.clientX, startWidth: width };
        }}
        onPointerMove={(event) => {
          const drag = dragging.current;
          if (!drag) return;
          setWidth(clampChatWidth(drag.startWidth + (drag.startX - event.clientX), window.innerWidth));
        }}
        onPointerUp={(event) => {
          if (!dragging.current) return;
          dragging.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          saveChatWidth(width);
        }}
        onKeyDown={(event) => {
          const next = chatWidthAfterKey(event.key, width, window.innerWidth);
          if (next === null) return;
          event.preventDefault();
          resizeTo(next);
        }}
      />
      <header className="agent-chat-head">
        <strong>Agent chat</strong>
        {agentLabel && <span className="agent-chat-agent">{agentLabel}</span>}
        {chat.running && <span className="mcp-dot on" title="The agent is running" aria-label="Running" />}
        <span className="spacer" />
        <button
          className={`icon-btn${showHistory ? " on" : ""}`}
          onClick={() => {
            setShowHistory((shown) => !shown);
            setReading(null);
          }}
          aria-pressed={showHistory}
          aria-label="Past chats"
          title="Past chats"
        >
          <History size={14} />
        </button>
        <button
          className="icon-btn"
          onClick={() => {
            setShowHistory(false);
            setReading(null);
            void chat.newChat();
          }}
          aria-label="New chat"
          title="New chat (ends the current one)"
          disabled={chat.status === "starting"}
        >
          <MessageSquarePlus size={14} />
        </button>
        <button className="icon-btn" onClick={onOpenSettings} aria-label="Chat settings" title="Chat settings">
          <Settings size={14} />
        </button>
        <button
          className="icon-btn"
          onClick={() => setAgentChatPanelOpen(false)}
          aria-label="Close"
          title={`Close (${agentChatShortcutLabel(isMac)}). The chat keeps running.`}
        >
          <X size={14} />
        </button>
      </header>

      {showHistory ? (
        <div className="agent-chat-body">
          {reading ? (
            <>
              <div className="agent-chat-reading">
                <button className="btn ghost" onClick={() => setReading(null)}>
                  ← Past chats
                </button>
                <span className="field-meta">
                  {reading.agentName} · {new Date(reading.startedAt).toLocaleString()}
                </span>
              </div>
              <div className="agent-chat-items">
                {reading.items.map((item) => (
                  <ChatItemView key={item.id} item={item} onOpenInStudio={onOpenInStudio} />
                ))}
              </div>
            </>
          ) : chat.saved.length === 0 ? (
            <p className="agent-chat-empty">No past chats yet. They&apos;re kept on this computer only.</p>
          ) : (
            <ul className="agent-chat-history">
              {chat.saved.map((saved) => (
                <li key={saved.id}>
                  <button className="agent-chat-history-open" onClick={() => setReading(saved)}>
                    <span className="agent-chat-history-title">{saved.title}</span>
                    <span className="field-meta">
                      {saved.agentName} · {new Date(saved.updatedAt).toLocaleString()}
                    </span>
                  </button>
                  <button
                    className="icon-btn tight danger"
                    onClick={() => void chat.deleteSaved(saved.id)}
                    aria-label={`Delete "${saved.title}"`}
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div
          className="agent-chat-body"
          ref={list}
          onScroll={(event) => {
            const el = event.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {!inTauri ? (
            <p className="agent-chat-empty">The chat panel needs the desktop app.</p>
          ) : loaded && !prefs.agent ? (
            <AgentPicker settings={settings} onOpenSettings={onOpenSettings} />
          ) : chat.items.length === 0 ? (
            <div className="agent-chat-empty">
              <p>
                Ask {agentLabel ?? "the agent"} to call, test or mock the APIs in Studio. Type <kbd>@</kbd> to attach
                an operation, a response, a collection step or a run log.
              </p>
              <div className="agent-chat-suggestions" aria-label="Suggestions">
                {chatSuggestions(studioContext()).map((text) => (
                  <button key={text} className="agent-chat-suggestion" onClick={() => suggest(text)} disabled={busy}>
                    {text}
                  </button>
                ))}
              </div>
              <p className="field-meta">
                {prefs.studioTools
                  ? "The agent starts when you send the first message, with Studio's tools connected. "
                  : "The agent starts when you send the first message. Studio's tools are turned off in Settings. "}
                What you send goes to the agent and its model provider; secret values from your environments are
                replaced by their names first.
              </p>
            </div>
          ) : (
            <div className="agent-chat-items">
              <ToolsLine chat={chat} />
              {chat.items.map((item) => (
                <ChatItemView key={item.id} item={item} onAnswer={chat.answer} onOpenInStudio={onOpenInStudio} />
              ))}
            </div>
          )}
        </div>
      )}

      {!showHistory && inTauri && prefs.agent && (
        <footer className="agent-chat-compose">
          {menu && (
            <div className="agent-chat-menu" role="listbox" aria-label="Attach">
              {choices.length === 0 ? (
                <div className="agent-chat-menu-empty">
                  Nothing to attach{menu.query ? ` matching "${menu.query}"` : ""}. Open an API, send a request or
                  run a collection first.
                </div>
              ) : (
                choices.map((choice, index) => (
                  <button
                    key={choice.id}
                    role="option"
                    aria-selected={index === highlight}
                    className="agent-chat-menu-item"
                    onMouseEnter={() => setHighlight(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(choice)}
                  >
                    <span className="agent-chat-menu-kind">{KIND_LABEL[choice.kind]}</span>
                    <span className="agent-chat-menu-label mono">{choice.label}</span>
                    {choice.detail && <span className="field-meta">{choice.detail}</span>}
                  </button>
                ))
              )}
            </div>
          )}
          {mentions.length > 0 && (
            <div className="chat-chips">
              {mentions.map((mention) => (
                <span key={mention.id} className="chat-chip" title={mention.detail}>
                  @{mention.label}
                  <button
                    className="icon-btn tight"
                    aria-label={`Remove ${mention.label}`}
                    onClick={() => setMentions((current) => current.filter((m) => m.id !== mention.id))}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={input}
            value={draft}
            rows={3}
            placeholder={`Message ${agentLabel ?? "the agent"}. @ to attach. Enter to send.`}
            aria-label="Message"
            onChange={(event) => onDraftChange(event.target.value, event.target.selectionStart)}
            onKeyDown={(event) => {
              if (menu && choices.length) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setHighlight((h) => Math.min(h + 1, choices.length - 1));
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setHighlight((h) => Math.max(h - 1, 0));
                  return;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  pick(choices[highlight] ?? choices[0]);
                  return;
                }
              }
              if (event.key === "Escape" && menu) {
                event.preventDefault();
                setMenu(null);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="agent-chat-compose-row">
            <button
              className="icon-btn"
              aria-label="Attach"
              title="Attach an operation, a response, a step or a run log"
              onClick={() => setMenu(menu ? null : { query: "", at: null })}
            >
              <AtSign size={14} />
            </button>
            <span className="field-meta agent-chat-status" role="status">
              {STATUS_TEXT[chat.status]}
            </span>
            <span className="spacer" />
            {chat.running && chat.status !== "working" && (
              <button className="btn ghost" onClick={() => void chat.end()} title="Stop the agent; the chat is kept">
                End chat
              </button>
            )}
            {chat.status === "working" ? (
              <button className="btn" onClick={() => void chat.stop()}>
                <Square size={12} /> Stop
              </button>
            ) : (
              <button className="btn primary" onClick={() => void submit()} disabled={!draft.trim() || busy}>
                <ArrowUp size={13} /> Send
              </button>
            )}
          </div>
        </footer>
      )}
    </aside>
  );
}

/** One line at the top of a chat: whether the agent has Studio's tools, and what to do if not. */
function ToolsLine({ chat }: { chat: ReturnType<typeof useAgentChat> }) {
  const busy = chat.status === "starting" || chat.status === "working";
  switch (chat.mcp) {
    case "connected":
      return (
        <details className="chat-tools">
          <summary>
            <span className="mcp-dot on" aria-hidden /> Studio&apos;s tools are connected
          </summary>
          <ul className="chat-tools-list mono">
            {TOOL_NAMES.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </details>
      );
    case "lost":
      return (
        <div className="chat-notice info" role="status">
          Studio&apos;s MCP server stopped or restarted, so the agent no longer has Studio&apos;s tools.{" "}
          <button className="btn ghost" onClick={() => void chat.reconnect()} disabled={busy}>
            <RefreshCw size={12} /> Reconnect
          </button>
        </div>
      );
    case "server-off":
      return (
        <div className="chat-notice info" role="status">
          The agent doesn&apos;t have Studio&apos;s tools in this chat, because Studio&apos;s MCP server isn&apos;t
          running.{" "}
          <button className="btn ghost" onClick={() => void chat.startStudioMcp()} disabled={busy}>
            Start it and reconnect
          </button>
        </div>
      );
    case "disabled":
      return (
        <div className="chat-notice info" role="status">
          Studio&apos;s tools are turned off for chats, in Settings → Agent chat.
        </div>
      );
    case "unsupported":
      return (
        <div className="chat-notice info" role="status">
          This agent can&apos;t connect to an MCP server over HTTP, so it can&apos;t use Studio&apos;s tools.
        </div>
      );
    default:
      return null;
  }
}

/** Shown until an agent is chosen: the ones found, to pick one here or in Settings. */
function AgentPicker({
  settings,
  onOpenSettings,
}: {
  settings: ReturnType<typeof useAgentChatSettings>;
  onOpenSettings: () => void;
}) {
  const usable = settings.agents?.filter((agent) => agent.how !== "missing") ?? [];
  return (
    <div className="agent-chat-empty">
      <p>
        Chat with a coding agent you already use, such as Claude, Codex or Gemini CLI. Studio starts it on this
        computer, signed in with your own account, and gives it Studio&apos;s tools.
      </p>
      {settings.searching && <p className="field-meta">Looking for agents…</p>}
      {settings.agents && usable.length === 0 && !settings.searching && (
        <p className="field-meta">No agent was found on this computer. Settings lists what to install.</p>
      )}
      <div className="agent-chat-picks">
        {usable.map((agent) => (
          <button key={agent.id} className="btn" onClick={() => void settings.setPrefs({ agent: agent.id })}>
            Use {agent.name}
          </button>
        ))}
        <button className="btn ghost" onClick={onOpenSettings}>
          Settings…
        </button>
      </div>
      <p className="field-meta">
        What you send goes to that agent and its model provider. Nothing starts until you send a message.
      </p>
    </div>
  );
}

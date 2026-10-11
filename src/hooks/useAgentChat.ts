import { useCallback, useEffect, useRef, useState } from "react";
import type { RequestPermissionRequest, RequestPermissionResponse, StopReason } from "@agentclientprotocol/sdk";
import {
  applyUpdate,
  errorText,
  isAuthRequired,
  itemId,
  openChat,
  type AgentChat,
  type ChatItem,
  type McpLink,
} from "../lib/acpClient";
import { startAgent, type AgentId, type AgentProcess } from "../lib/acpProcess";
import {
  EMPTY_SAVED_CHATS,
  forgetChat,
  keepChat,
  loadAgentChatPrefs,
  loadSavedChats,
  promptBlocks,
  saveSavedChats,
  studioContextNote,
  type Mention,
  type SavedChat,
  type SavedChats,
  type StudioContext,
} from "../lib/agentChat";
import { logAgentSession } from "../lib/appConsole";
import { currentVersion } from "../lib/appUpdates";
import { ensureMcpRunning, loadMcpPrefs, MCP_STATE_EVENT, startMcp } from "../lib/mcpServer";
import { redact } from "../lib/redact";

/**
 * The chat panel's conversation with an agent: starting the agent, sending what
 * the user writes, folding what comes back into the conversation, asking the
 * user when the agent wants permission, and ending it all.
 *
 * One agent process per conversation. It starts with the first message and
 * stops when the conversation ends, a new one starts, or Studio quits.
 */

export type ChatStatus = "idle" | "starting" | "ready" | "working" | "ended";

/** How to sign in to each agent before the first chat. */
export const SIGN_IN: Record<AgentId, string> = {
  claude:
    "Claude Agent needs an Anthropic API key. Add one in Settings, under Agent chat, then start a new chat. Anthropic asks apps built on its Agent SDK to use an API key rather than a claude.ai sign-in.",
  codex: "Run `codex login` in a terminal, then start a new chat.",
  gemini: "Run `gemini` in a terminal and choose how to sign in, then start a new chat.",
  custom: "Sign in to the agent the way its documentation describes, then start a new chat.",
};

export const AGENT_NAMES: Record<AgentId, string> = {
  claude: "Claude Agent",
  codex: "Codex",
  gemini: "Gemini CLI",
  custom: "Agent",
};

interface Live {
  process: AgentProcess;
  chat: AgentChat | null;
  /** The conversation this process belongs to; a new chat makes it stale. */
  chatId: string;
  /** The MCP server this session was given, while it's still the one running. */
  mcpAt: { port: number; token: string } | null;
  /** Whether this session's first message, with the note about Studio, has gone. */
  contextSent: boolean;
}

function newChatId(): string {
  return `chat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The last lines of what an agent wrote to standard error, redacted. */
function stderrTail(text: string): string {
  const lines = redact(text).trim().split("\n").slice(-12).join("\n");
  return lines.length > 1500 ? lines.slice(-1500) : lines;
}

export function useAgentChat() {
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [mcp, setMcpState] = useState<McpLink | null>(null);
  const mcpRef = useRef<McpLink | null>(null);
  const setMcp = useCallback((link: McpLink | null) => {
    mcpRef.current = link;
    setMcpState(link);
  }, []);
  const [saved, setSaved] = useState<SavedChats>(EMPTY_SAVED_CHATS);

  const live = useRef<Live | null>(null);
  const chatId = useRef(newChatId());
  const startedAt = useRef(new Date().toISOString());
  const itemsRef = useRef<ChatItem[]>([]);
  const savedRef = useRef<SavedChats>(EMPTY_SAVED_CHATS);
  const permissions = useRef(new Map<string, (response: RequestPermissionResponse) => void>());
  const agentRef = useRef<AgentId | null>(null);

  const setConversation = useCallback((update: (items: ChatItem[]) => ChatItem[]) => {
    itemsRef.current = update(itemsRef.current);
    setItems(itemsRef.current);
  }, []);

  const notice = useCallback(
    (text: string, level: "info" | "error" = "info") =>
      setConversation((current) => [...current, { kind: "notice", id: itemId(), level, text }]),
    [setConversation],
  );

  useEffect(() => {
    void loadSavedChats().then((stored) => {
      savedRef.current = stored;
      setSaved(stored);
    });
  }, []);

  /** Keep the conversation on disk, once it has something in it. */
  const persist = useCallback(async () => {
    const current = itemsRef.current;
    const agent = agentRef.current;
    if (!agent || !current.some((item) => item.kind === "user")) return;
    const chat: SavedChat = {
      id: chatId.current,
      agent,
      agentName: agentName ?? AGENT_NAMES[agent],
      title: "",
      startedAt: startedAt.current,
      updatedAt: new Date().toISOString(),
      items: current,
    };
    savedRef.current = keepChat(savedRef.current, chat);
    setSaved(savedRef.current);
    await saveSavedChats(savedRef.current);
  }, [agentName]);

  /** Answer every open permission question with "cancelled". */
  const cancelPermissions = useCallback(() => {
    for (const resolve of permissions.current.values()) resolve({ outcome: { outcome: "cancelled" } });
    permissions.current.clear();
    setConversation((current) =>
      current.map((item) => (item.kind === "permission" && item.state === "pending" ? { ...item, state: "cancelled" } : item)),
    );
  }, [setConversation]);

  /** Stop the agent process. The conversation stays on screen. */
  const shutdown = useCallback(
    async (reason: string | null) => {
      const current = live.current;
      live.current = null;
      cancelPermissions();
      if (!current) return;
      current.chat?.close();
      await current.process.stop().catch(() => undefined);
      if (reason) logAgentSession(agentName ?? "Agent", reason);
    },
    [agentName, cancelPermissions],
  );

  const onPermission = useCallback(
    (request: RequestPermissionRequest): Promise<RequestPermissionResponse> =>
      new Promise((resolve) => {
        const id = itemId();
        permissions.current.set(id, resolve);
        setConversation((current) => [
          ...current,
          {
            kind: "permission",
            id,
            title: request.toolCall.title || "The agent wants to use a tool",
            options: request.options,
            state: "pending",
          },
        ]);
      }),
    [setConversation],
  );

  /** The user's answer to a permission question. */
  const answer = useCallback(
    (id: string, optionId: string) => {
      const resolve = permissions.current.get(id);
      if (!resolve) return;
      permissions.current.delete(id);
      resolve({ outcome: { outcome: "selected", optionId } });
      setConversation((current) =>
        current.map((item) => (item.id === id && item.kind === "permission" ? { ...item, state: "answered", chosen: optionId } : item)),
      );
    },
    [setConversation],
  );

  /** Start the chosen agent and open a session with it. */
  const connect = useCallback(async (): Promise<Live | null> => {
    // Read now rather than remembered: Settings may have changed them.
    const prefs = await loadAgentChatPrefs();
    const agent = prefs.agent;
    if (!agent) {
      notice("Choose an agent in Settings → Agent chat first.", "error");
      return null;
    }
    agentRef.current = agent;
    setStatus("starting");

    // Studio's tools: the local MCP server, started now if it isn't running.
    let studioMcp: Awaited<ReturnType<typeof ensureMcpRunning>> | null = null;
    if (prefs.studioTools) {
      try {
        studioMcp = await ensureMcpRunning();
        if (studioMcp.started) logAgentSession(AGENT_NAMES[agent], "started Studio's MCP server for the chat");
      } catch (error) {
        notice(
          `Couldn't start Studio's MCP server, so the agent doesn't have Studio's tools in this chat: ${errorText(error)}`,
          "error",
        );
      }
    }

    let process: AgentProcess;
    try {
      process = await startAgent(agent, prefs.workspace);
    } catch (error) {
      setStatus("idle");
      notice(errorText(error), "error");
      logAgentSession(AGENT_NAMES[agent], `didn't start: ${errorText(error)}`, "error");
      return null;
    }
    const owner = chatId.current;
    const entry: Live = { process, chat: null, chatId: owner, mcpAt: null, contextSent: false };
    live.current = entry;

    void process.exited.then((exit) => {
      if (live.current !== entry) return;
      live.current = null;
      cancelPermissions();
      setStatus("ended");
      const tail = stderrTail(exit.stderr);
      notice(
        `The agent stopped${exit.code !== null ? ` (exit code ${exit.code})` : ""}.${tail ? `\n\n${tail}` : ""}`,
        "error",
      );
      logAgentSession(agentName ?? AGENT_NAMES[agent], `stopped unexpectedly (exit code ${exit.code ?? "unknown"})`, "error");
      void persist();
    });

    const version = await currentVersion();
    try {
      const chat = await openChat(
        process.stream,
        {
          onUpdate: (update) => {
            if (live.current === entry) setConversation((current) => applyUpdate(current, update));
          },
          onPermission,
        },
        {
          cwd: process.started.cwd,
          mcp: studioMcp ? { url: studioMcp.url, token: studioMcp.token } : null,
          studioVersion: version ?? "0.0.0",
        },
      );
      if (live.current !== entry) {
        chat.close();
        return null;
      }
      entry.chat = chat;
      entry.mcpAt = studioMcp && chat.mcp === "connected" ? { port: studioMcp.port, token: studioMcp.token } : null;
      // A conversation that already has messages gets a fresh agent session: say so.
      if (itemsRef.current.some((item) => item.kind === "agent")) {
        notice("New session with the agent. It doesn't see the messages above.");
      }
      setAgentName(chat.agent.title);
      setMcp(prefs.studioTools ? chat.mcp : "disabled");
      setStatus("ready");
      logAgentSession(chat.agent.title, `session started (${process.started.command})`);
      return entry;
    } catch (error) {
      const stderr = stderrTail(await process.stderr().catch(() => ""));
      if (live.current === entry) await shutdown(null);
      setStatus("idle");
      if (isAuthRequired(error)) {
        notice(`${AGENT_NAMES[agent]} needs you to sign in first. ${SIGN_IN[agent]}`, "error");
      } else {
        notice(`Couldn't start a chat: ${errorText(error)}${stderr ? `\n\n${stderr}` : ""}`, "error");
      }
      logAgentSession(AGENT_NAMES[agent], `didn't start: ${errorText(error)}`, "error");
      return null;
    }
  }, [notice, cancelPermissions, persist, agentName, setConversation, onPermission, shutdown, setMcp]);

  /**
   * Send a message. The first message of each agent session also carries a
   * short note about Studio: where the agent is, its tools, and what's open.
   */
  const send = useCallback(
    async (text: string, mentions: Mention[], context?: StudioContext): Promise<boolean> => {
      if (!text.trim() || status === "starting" || status === "working") return false;
      const userId = itemId();
      setConversation((current) => [
        ...current,
        { kind: "user", id: userId, text: redact(text), mentions: mentions.map((mention) => mention.label) },
      ]);
      const entry = live.current?.chat ? live.current : await connect();
      if (!entry?.chat) return true;
      let note: string | undefined;
      if (!entry.contextSent && context) {
        note = studioContextNote(context, mcpRef.current === "connected");
        entry.contextSent = true;
        const shown = note;
        setConversation((current) =>
          current.map((item) => (item.id === userId && item.kind === "user" ? { ...item, context: shown } : item)),
        );
      }
      setStatus("working");
      let stop: StopReason | null = null;
      try {
        stop = await entry.chat.prompt(promptBlocks(text, mentions, entry.chat.embeddedContext, note));
      } catch (error) {
        if (live.current === entry) notice(`The agent reported an error: ${errorText(error)}`, "error");
      }
      if (live.current !== entry) return true;
      setStatus("ready");
      if (stop === "cancelled") notice("Stopped.");
      else if (stop === "refusal") notice("The agent declined to continue.", "error");
      else if (stop === "max_tokens" || stop === "max_turn_requests") notice("The agent reached its limit for this turn.");
      void persist();
      return true;
    },
    [status, connect, notice, persist, setConversation],
  );

  /** Ask the agent to stop the current turn. */
  const stop = useCallback(async () => {
    const chat = live.current?.chat;
    cancelPermissions();
    if (chat) await chat.cancel().catch(() => undefined);
  }, [cancelPermissions]);

  /** End the conversation and its agent process; keep it in the list. */
  const end = useCallback(async () => {
    await persist();
    await shutdown("session ended");
    setStatus("ended");
  }, [persist, shutdown]);

  /** Start over with an empty conversation. The agent starts with the next message. */
  const newChat = useCallback(async () => {
    await persist();
    await shutdown("session ended");
    chatId.current = newChatId();
    startedAt.current = new Date().toISOString();
    itemsRef.current = [];
    setItems([]);
    setMcp(null);
    setStatus("idle");
  }, [persist, shutdown, setMcp]);

  const deleteSaved = useCallback(async (id: string) => {
    savedRef.current = forgetChat(savedRef.current, id);
    setSaved(savedRef.current);
    await saveSavedChats(savedRef.current);
  }, []);

  /**
   * Start a new agent session in the same conversation, connected to Studio's
   * tools as they are now. The agent doesn't see the earlier messages, and the
   * conversation says so.
   */
  const reconnect = useCallback(async () => {
    if (status === "starting" || status === "working") return;
    await shutdown("reconnecting to Studio's tools");
    setMcp(null);
    setStatus("idle");
    await connect();
  }, [status, shutdown, setMcp, connect]);

  /** Start Studio's MCP server, then reconnect an open chat so the agent gets its tools. */
  const startStudioMcp = useCallback(async () => {
    try {
      await startMcp(await loadMcpPrefs());
    } catch (error) {
      notice(`Couldn't start Studio's MCP server: ${errorText(error)}`, "error");
      return;
    }
    if (live.current) await reconnect();
    else notice("Studio's MCP server is running. The agent gets its tools when the chat starts.");
  }, [notice, reconnect]);

  // A session keeps the server it was given. If that server stops or restarts
  // (Stop agents, a new token, a new port), the agent's connection to it is gone.
  useEffect(() => {
    const onState = () => {
      const current = live.current;
      if (!current?.chat || !current.mcpAt) return;
      current.mcpAt = null;
      setMcp("lost");
    };
    window.addEventListener(MCP_STATE_EVENT, onState);
    return () => window.removeEventListener(MCP_STATE_EVENT, onState);
  }, [setMcp]);

  // The agent goes when the panel's owner does.
  useEffect(
    () => () => {
      const current = live.current;
      live.current = null;
      if (current) {
        current.chat?.close();
        void current.process.stop();
      }
    },
    [],
  );

  return {
    status,
    items,
    /** The agent's own name for itself, once a session has started. */
    agentName,
    mcp,
    saved: saved.chats,
    send,
    stop,
    end,
    newChat,
    answer,
    deleteSaved,
    startStudioMcp,
    reconnect,
    running: Boolean(live.current),
  };
}

export type AgentChatState = ReturnType<typeof useAgentChat>;

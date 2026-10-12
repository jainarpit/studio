import { useSyncExternalStore } from "react";
import {
  agentChatActivity,
  agentChatPanelOpen,
  subscribeAgentChatActivity,
  subscribeAgentChatPanel,
  type ChatActivity,
} from "../lib/agentChatPanel";

/** Whether the chat panel is open, for the panel and the top bar button. */
export function useAgentChatPanelOpen(): boolean {
  return useSyncExternalStore(subscribeAgentChatPanel, agentChatPanelOpen);
}

/** What the chat is doing, for the dot on the top bar button. */
export function useAgentChatActivity(): ChatActivity {
  return useSyncExternalStore(subscribeAgentChatActivity, agentChatActivity);
}

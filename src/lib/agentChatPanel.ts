import type { KeyPress } from "./shortcuts";

/**
 * Whether the chat panel is open. Kept outside React, like the console's, so
 * the status bar button and the shortcut can toggle it from anywhere.
 */

let open = false;
const listeners = new Set<() => void>();

export function subscribeAgentChatPanel(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function agentChatPanelOpen(): boolean {
  return open;
}

export function setAgentChatPanelOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  for (const listener of listeners) listener();
}

export function toggleAgentChatPanel(): void {
  setAgentChatPanelOpen(!open);
}

/**
 * ⌘⇧J on macOS, Ctrl+Shift+J elsewhere, opens and closes the chat panel.
 * Matched on the physical key, like the console's shortcut.
 */
export function isAgentChatShortcut(press: KeyPress, { mac }: { mac: boolean }): boolean {
  const command = mac ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey;
  return command && press.shiftKey && !press.altKey && press.code === "KeyJ";
}

export function agentChatShortcutLabel(mac: boolean): string {
  return mac ? "⇧⌘J" : "Ctrl+Shift+J";
}

// Width

/** The chat's width limits, and the room the page always keeps next to it. */
export const CHAT_WIDTH = { min: 320, max: 720, initial: 420, page: 580 } as const;

const WIDTH_KEY = "spec0-studio.agent-chat-width";

/**
 * A width the chat can have in a window this wide: within its limits, and
 * never so wide that the page next to it gets narrower than `CHAT_WIDTH.page`.
 * In a window too narrow for both, the chat gets its minimum.
 */
export function clampChatWidth(width: number, windowWidth: number): number {
  const roomLeft = windowWidth - CHAT_WIDTH.page;
  const upper = Math.max(CHAT_WIDTH.min, Math.min(CHAT_WIDTH.max, roomLeft));
  const wanted = Number.isFinite(width) ? Math.round(width) : CHAT_WIDTH.initial;
  return Math.min(upper, Math.max(CHAT_WIDTH.min, wanted));
}

/** The width this viewer left the chat at, or the initial one. */
export function savedChatWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return value > 0 ? value : CHAT_WIDTH.initial;
  } catch {
    return CHAT_WIDTH.initial;
  }
}

export function saveChatWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
  } catch {
    // Storage can be unavailable; the width just isn't remembered then.
  }
}

/** The new width after a key press on the resize handle, or null for other keys. */
export function chatWidthAfterKey(key: string, width: number, windowWidth: number): number | null {
  const step = 24;
  // The handle is on the chat's left edge: moving it left makes the chat wider.
  const next =
    key === "ArrowLeft" ? width + step
    : key === "ArrowRight" ? width - step
    : key === "Home" ? CHAT_WIDTH.max
    : key === "End" ? CHAT_WIDTH.min
    : null;
  return next === null ? null : clampChatWidth(next, windowWidth);
}

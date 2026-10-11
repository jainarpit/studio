import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./request";
import type { AgentId } from "./acpProcess";
import instructions from "../agent-profile/instructions.md?raw";
import testAnApi from "../agent-profile/guides/test-an-api.md?raw";
import checkAServer from "../agent-profile/guides/check-a-server.md?raw";
import buildACollection from "../agent-profile/guides/build-a-collection.md?raw";
import explainAFailedRun from "../agent-profile/guides/explain-a-failed-run.md?raw";

/**
 * Studio's instructions for the agent in the chat panel. The text is in
 * `src/agent-profile/`. Rust writes it into Studio's own agent folder, as the
 * file each agent reads (see `src-tauri/src/agent_profile.rs`). When the agent
 * works somewhere else, or writing failed, it goes with the first message.
 */

/** How the instructions stand for a chat. Mirrors `agent_profile::State`. */
export type InstructionsState = "installed" | "edited" | "off" | "elsewhere" | "failed";

/** The file each agent reads its instructions from. */
export const INSTRUCTIONS_FILE: Record<AgentId, string> = {
  codex: "AGENTS.md",
  claude: "CLAUDE.md",
  gemini: "GEMINI.md",
  custom: "AGENTS.md",
};

const GUIDES = [testAnApi, checkAServer, buildACollection, explainAFailedRun];

/** The instructions as one message: the guides follow, since there's no folder to point at. */
export function instructionsMessage(): string {
  const intro = instructions.replace(/\n*For common tasks, follow the guides in `spec0-studio\/guides\/`[^\n]*\n?$/, "").trim();
  return [intro, "Guides for common tasks:", ...GUIDES.map((guide) => guide.trim())].join("\n\n");
}

/** Whether the first message must carry the instructions: they aren't in the agent's folder. */
export function sendWithMessage(state: InstructionsState | undefined): boolean {
  return state === "elsewhere" || state === "failed";
}

/**
 * What the first message of a session carries ahead of the user's text: the
 * note about what's open, and Studio's instructions when they aren't in the
 * agent's folder. Undefined when there's nothing to add.
 */
export function firstMessageNote(note: string | undefined, state: InstructionsState | undefined): string | undefined {
  const parts = note ? [note] : [];
  if (sendWithMessage(state)) parts.push(`Instructions from Spec0 Studio:\n\n${instructionsMessage()}`);
  return parts.length ? parts.join("\n\n") : undefined;
}

/** How Studio's instructions stand in its own folder, for Settings. Null outside the desktop app. */
export async function instructionsStatus(agent: AgentId): Promise<InstructionsState | null> {
  if (!inTauri) return null;
  return invoke<InstructionsState>("acp_instructions_status", { agent });
}

/** Put Studio's version back, replacing the user's edits. */
export async function restoreInstructions(agent: AgentId): Promise<InstructionsState> {
  return invoke<InstructionsState>("acp_instructions_restore", { agent });
}

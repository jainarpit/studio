/**
 * Studio's instructions for the chat agent: which file each agent reads, what
 * goes with the first message when they aren't in the agent's folder, and that
 * every tool they name is one Studio has.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("../request", () => ({ inTauri: true }));

const { firstMessageNote, instructionsMessage, INSTRUCTIONS_FILE, instructionsStatus, restoreInstructions, sendWithMessage } =
  await import("../agentProfile");
const acp = await import("../acpProcess");
const tools = (await import("../mcp-tools.json")).default as { name: string }[];

const PROFILE = join(__dirname, "../../agent-profile");
const sources = [
  join(PROFILE, "instructions.md"),
  ...readdirSync(join(PROFILE, "guides")).map((name) => join(PROFILE, "guides", name)),
];

beforeEach(() => invoke.mockReset());

describe("Studio's instructions", () => {
  it("go in the file each agent reads, the same names as in Rust", () => {
    expect(INSTRUCTIONS_FILE).toEqual({ codex: "AGENTS.md", claude: "CLAUDE.md", gemini: "GEMINI.md", custom: "AGENTS.md" });
    const rust = readFileSync(join(__dirname, "../../../src-tauri/src/agent_profile.rs"), "utf8");
    for (const file of ["CLAUDE.md", "GEMINI.md", "AGENTS.md"]) expect(rust).toContain(`"${file}"`);
  });

  it("name only tools Studio has", () => {
    const names = new Set(tools.map((tool) => tool.name));
    for (const source of sources) {
      const named = [...readFileSync(source, "utf8").matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((match) => match[1]);
      for (const name of named) expect(names, `${source}: ${name}`).toContain(name);
    }
  });

  it("are plain: no em-dashes", () => {
    for (const source of sources) expect(readFileSync(source, "utf8")).not.toContain("—");
  });

  it("as one message, include the guides instead of pointing at a folder", () => {
    const text = instructionsMessage();
    expect(text).toContain("You're working with a developer inside Spec0 Studio");
    expect(text).not.toContain("spec0-studio/guides/");
    for (const heading of ["# Test an API end to end", "# Check a running server", "# Build a collection", "# Explain a failed run"]) {
      expect(text).toContain(heading);
    }
  });
});

describe("the first message", () => {
  it("carries the instructions only when they aren't in the agent's folder", () => {
    expect(sendWithMessage("installed")).toBe(false);
    expect(sendWithMessage("edited")).toBe(false);
    expect(sendWithMessage("off")).toBe(false);
    expect(sendWithMessage("elsewhere")).toBe(true);
    expect(sendWithMessage("failed")).toBe(true);
  });

  it("keeps the note about what's open and adds the instructions after it", () => {
    const note = firstMessageNote("Open in Studio right now: Orders", "elsewhere")!;
    expect(note.startsWith("Open in Studio right now: Orders")).toBe(true);
    expect(note).toContain("Instructions from Spec0 Studio:");
    expect(firstMessageNote("Open: Orders", "installed")).toBe("Open: Orders");
  });

  it("adds nothing when turned off and there's no note", () => {
    expect(firstMessageNote(undefined, "off")).toBeUndefined();
    expect(firstMessageNote(undefined, "installed")).toBeUndefined();
    expect(firstMessageNote(undefined, "failed")).toContain("Instructions from Spec0 Studio:");
  });
});

describe("talking to Rust", () => {
  it("passes the setting when an agent starts", async () => {
    invoke.mockImplementation(async (command: string) =>
      command === "acp_start" ? { session: 1, command: "codex-acp", cwd: "/tmp/agent", instructions: "off" } : undefined,
    );
    const agent = await acp.startAgent("codex", null, false);
    expect(invoke).toHaveBeenCalledWith("acp_start", { agent: "codex", cwd: null, instructions: false });
    expect(agent.started.instructions).toBe("off");
  });

  it("asks for the status and restores by agent name only", async () => {
    invoke.mockResolvedValueOnce("edited").mockResolvedValueOnce("installed");
    expect(await instructionsStatus("claude")).toBe("edited");
    expect(await restoreInstructions("claude")).toBe("installed");
    expect(invoke).toHaveBeenNthCalledWith(1, "acp_instructions_status", { agent: "claude" });
    expect(invoke).toHaveBeenNthCalledWith(2, "acp_instructions_restore", { agent: "claude" });
  });
});

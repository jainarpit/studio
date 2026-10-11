/**
 * The agent chat gets Studio's tools without setup: a chat starts the local MCP
 * server when it isn't running, and every start and stop is announced so an
 * open chat can tell when its connection to the server is gone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("../request", () => ({ inTauri: true }));

const { ensureMcpRunning, MCP_STATE_EVENT, stopMcp } = await import("../mcpServer");
type McpState = import("../mcpServer").McpState;

const TOKEN = "s0mcp_" + "t".repeat(40);

/** A stand-in for Rust: the saved MCP settings, and a server that can be on or off. */
function fakeShell(start: { running: boolean; port: number | null }) {
  let server = start;
  invoke.mockImplementation(async (command: string) => {
    switch (command) {
      case "store_read":
        return JSON.stringify({ token: TOKEN, port: 47400 });
      case "mcp_status":
        return server;
      case "mcp_start":
        server = { running: true, port: 47400 };
        return server;
      case "mcp_stop":
        server = { running: false, port: null };
        return server;
      default:
        return undefined;
    }
  });
}

let announced: McpState[] = [];

beforeEach(() => {
  invoke.mockReset();
  announced = [];
  const target = new EventTarget();
  target.addEventListener(MCP_STATE_EVENT, (event) => announced.push((event as CustomEvent<McpState>).detail));
  vi.stubGlobal("window", target);
});

afterEach(() => vi.unstubAllGlobals());

describe("Studio's tools for a chat", () => {
  it("start the MCP server when it's off, with the saved port and token", async () => {
    fakeShell({ running: false, port: null });
    const server = await ensureMcpRunning();
    expect(server).toEqual({ url: "http://127.0.0.1:47400/mcp", port: 47400, token: TOKEN, started: true });
    expect(invoke).toHaveBeenCalledWith("mcp_start", { port: 47400, token: TOKEN });
    expect(announced).toEqual([{ running: true, port: 47400, token: TOKEN }]);
  });

  it("use the server that's already running, without restarting it", async () => {
    fakeShell({ running: true, port: 47401 });
    const server = await ensureMcpRunning();
    expect(server).toMatchObject({ port: 47401, started: false });
    expect(invoke).not.toHaveBeenCalledWith("mcp_start", expect.anything());
    expect(announced).toEqual([]);
  });

  it("say why when the server can't start", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "store_read") return JSON.stringify({ token: TOKEN, port: 47400 });
      if (command === "mcp_status") return { running: false, port: null };
      if (command === "mcp_start") throw new Error("Port 47400 and the next 20 are in use.");
      return undefined;
    });
    await expect(ensureMcpRunning()).rejects.toThrow("Port 47400");
  });

  it("announce a stop, so an open chat knows its tools are gone", async () => {
    fakeShell({ running: true, port: 47400 });
    await stopMcp();
    expect(announced).toEqual([{ running: false, port: null, token: null }]);
  });
});

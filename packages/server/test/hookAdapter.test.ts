import { describe, it, expect } from "vitest";
import { eventToSignals, parseMcpToolName } from "../src/hookAdapter.js";

describe("parseMcpToolName", () => {
  it("splits server and tool on the double underscore", () => {
    expect(parseMcpToolName("mcp__postman__run-collection")).toEqual({
      server: "postman",
      tool: "run-collection",
    });
    // tool names may themselves contain underscores
    expect(parseMcpToolName("mcp__exa__web_search_exa")).toEqual({
      server: "exa",
      tool: "web_search_exa",
    });
    expect(parseMcpToolName("Bash")).toBeNull();
  });
});

describe("eventToSignals", () => {
  it("maps a Bash tool use to a bash signal", () => {
    expect(eventToSignals({ tool_name: "Bash", tool_input: { command: "npx playwright test" } })).toEqual([
      { kind: "bash", command: "npx playwright test" },
    ]);
    expect(eventToSignals({ tool_name: "Bash", tool_input: {} })).toEqual([]);
  });

  it("maps Edit/Write to a file signal, made relative to cwd", () => {
    expect(
      eventToSignals({
        tool_name: "Write",
        tool_input: { file_path: "/proj/app/.gitignore" },
        cwd: "/proj/app",
      }),
    ).toEqual([{ kind: "file", path: ".gitignore", event: "change" }]);
  });

  it("maps an MCP tool call to both mcp.added and mcp_tool", () => {
    expect(
      eventToSignals({ tool_name: "mcp__postman__generate-spec", tool_input: {} }),
    ).toEqual([
      { kind: "mcp.added", server: "postman" },
      { kind: "mcp_tool", server: "postman", tool: "generate-spec" },
    ]);
  });

  it("ignores tools it doesn't understand", () => {
    expect(eventToSignals({ tool_name: "Task", tool_input: {} })).toEqual([]);
    expect(eventToSignals({})).toEqual([]);
  });
});

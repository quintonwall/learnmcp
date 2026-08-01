import { describe, it, expect } from "vitest";
import { eventToSignals, parseMcpToolName, normalizeCommandName } from "../src/hookAdapter.js";

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

describe("normalizeCommandName", () => {
  it("strips the slash and arguments", () => {
    expect(normalizeCommandName("/postman:mock")).toBe("postman:mock");
    expect(normalizeCommandName("/postman:run-collection 12345 --bail")).toBe(
      "postman:run-collection",
    );
    expect(normalizeCommandName("postman:docs")).toBe("postman:docs");
  });

  it("rejects things that aren't command names", () => {
    expect(normalizeCommandName("/")).toBeNull();
    expect(normalizeCommandName("  ")).toBeNull();
    expect(normalizeCommandName("/../etc/passwd")).toBeNull();
  });
});

describe("command invocations", () => {
  it("maps a leading slash command in a submitted prompt", () => {
    expect(
      eventToSignals({ hook_event_name: "UserPromptSubmit", prompt: "/postman:mock" }),
    ).toEqual([{ kind: "command", name: "postman:mock" }]);
  });

  it("does NOT count a command merely mentioned mid-prompt", () => {
    expect(
      eventToSignals({
        hook_event_name: "UserPromptSubmit",
        prompt: "should I use /postman:mock here?",
      }),
    ).toEqual([]);
  });

  it("maps the Skill and SlashCommand tools", () => {
    expect(
      eventToSignals({ tool_name: "Skill", tool_input: { skill: "postman:generate-spec" } }),
    ).toEqual([{ kind: "command", name: "postman:generate-spec" }]);

    expect(
      eventToSignals({ tool_name: "SlashCommand", tool_input: { command: "/postman:security" } }),
    ).toEqual([{ kind: "command", name: "postman:security" }]);
  });
});

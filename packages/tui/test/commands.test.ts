import { describe, expect, it } from "vitest";
import { parseCommand } from "@brainstorming/tui";

describe("parseCommand", () => {
  it("passes plain text through as a message", () => {
    expect(parseCommand("hello @claude")).toEqual({ kind: "message", content: "hello @claude" });
  });
  it("parses /quit, /continue, /help", () => {
    expect(parseCommand("/quit")).toEqual({ kind: "quit" });
    expect(parseCommand("/continue")).toEqual({ kind: "continue" });
    expect(parseCommand("/help")).toEqual({ kind: "help" });
  });
  it("parses /budget N", () => {
    expect(parseCommand("/budget 5")).toEqual({ kind: "budget", n: 5 });
  });
  it("parses /decide with text", () => {
    expect(parseCommand("/decide use REST not GraphQL")).toEqual({ kind: "decide", text: "use REST not GraphQL" });
    expect(parseCommand("/decide")).toEqual({ kind: "unknown", name: "decide" });
  });
  it("flags unknown commands", () => {
    expect(parseCommand("/wat now")).toEqual({ kind: "unknown", name: "wat" });
  });
});

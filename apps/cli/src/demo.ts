import { FakeAdapter } from "@brainstorming/core";

/**
 * Demo roster. Scripted to exercise every kernel feature:
 * - "api" topic: claude consults codex (one cascade round)
 * - "pingpong": claude/codex mention each other forever -> round budget stops them
 * - "tests": codex asks permission, runs an activity on allow
 */
export function demoAdapters(): FakeAdapter[] {
  return [
    new FakeAdapter("claude", {
      chunkDelayMs: 15,
      replies: [
        {
          match: /rest|graphql|api/i,
          reply: "I lean REST here — simpler caching. @codex do you agree?",
        },
        { match: /ping|pong/i, reply: "@codex pong" },
      ],
      defaultReply: "Interesting. What is the goal?",
    }),
    new FakeAdapter("codex", {
      chunkDelayMs: 15,
      replies: [
        { match: /do you agree/i, reply: "Agreed — versioned REST plus OpenAPI. I can scaffold it." },
        { match: /ping|pong/i, reply: "@claude ping" },
        {
          match: /test/i,
          reply: "Ran the tests — all green.",
          permission: {
            action: "run command",
            preview: "pnpm test",
            denyReply: "Okay, skipping the test run.",
          },
          activity: { kind: "command", title: "ran: pnpm test (12 passed)", status: "ok" },
        },
      ],
      defaultReply: "Give me a concrete task and I will do it.",
    }),
    new FakeAdapter("antigravity", {
      chunkDelayMs: 15,
      defaultReply: "Alternative view: consider the long-term client list before deciding.",
    }),
    new FakeAdapter("ollama", {
      chunkDelayMs: 15,
      defaultReply: "Opinion: keep it boring and ship.",
    }),
  ];
}

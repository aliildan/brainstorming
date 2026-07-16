import React, { useCallback, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { PermissionDecision, Room } from "@brainstorming/core";
import { useRoom, type PermissionPrompt } from "./use-room.js";
import { Transcript } from "./components/transcript.js";
import { LiveBlocks } from "./components/live-blocks.js";
import { StatusBar } from "./components/status-bar.js";
import { ChatInput } from "./components/chat-input.js";
import { PermissionCard } from "./components/permission-card.js";
import { HELP_TEXT, parseCommand } from "./commands.js";

export function App({ room, title = "brainstorming" }: { room: Room; title?: string }) {
  const view = useRoom(room);
  const { exit } = useApp();
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [answered, setAnswered] = useState<PermissionPrompt[]>([]);
  const activeCard = view.permissions.find((p) => !answered.includes(p)) ?? null;

  const answer = (card: PermissionPrompt, decision: PermissionDecision) => {
    setAnswered((prev) => [...prev, card]);
    card.respond(decision);
  };

  useInput((input, key) => {
    if (key.escape) {
      room.interrupt();
      return;
    }
    if (activeCard) {
      if (input === "i") answer(activeCard, "allow-once");
      else if (input === "o") answer(activeCard, "allow-session");
      else if (input === "r") answer(activeCard, "deny");
    }
  });

  const handleSubmit = useCallback(
    (line: string) => {
      setLocalNotice(null);
      const cmd = parseCommand(line);
      switch (cmd.kind) {
        case "quit":
          exit();
          return;
        case "help":
          setLocalNotice(HELP_TEXT);
          return;
        case "budget":
          room.setRoundBudget(cmd.n);
          setLocalNotice(`round budget set to ${cmd.n}`);
          return;
        case "continue":
          void room.continueCascade();
          return;
        case "unknown":
          setLocalNotice(`unknown command: /${cmd.name} — ${HELP_TEXT}`);
          return;
        case "message":
          void room.sendUserMessage(cmd.content).then((res) => {
            if (res.status === "needs-target") {
              setLocalNotice("No target: mention someone, e.g. @claude or @all.");
            }
          });
      }
    },
    [room, exit],
  );

  const notice = localNotice ?? view.notice;
  return (
    <Box flexDirection="column">
      <StatusBar title={title} statuses={view.statuses} />
      <Transcript messages={view.messages} />
      <LiveBlocks live={view.live} />
      {activeCard ? <PermissionCard prompt={activeCard} /> : null}
      {notice ? <Text color="yellow">{notice}</Text> : null}
      <ChatInput roster={room.roster} onSubmit={handleSubmit} disabled={activeCard !== null} />
    </Box>
  );
}

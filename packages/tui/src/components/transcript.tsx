import React from "react";
import { Box, Static, Text } from "ink";
import type { ChatMessage } from "@brainstorming/core";
import { authorColor } from "../theme.js";

export function Transcript({ messages }: { messages: ChatMessage[] }) {
  return (
    <Static items={messages}>
      {(m) => (
        <Box key={m.id} marginBottom={m.kind === "chat" ? 1 : 0}>
          {m.kind === "chat" ? (
            <Text>
              <Text bold color={authorColor(m.author)}>
                [{m.author}]
              </Text>
              <Text> {m.content}</Text>
            </Text>
          ) : (
            <Text dimColor italic={m.kind === "system"}>
              {m.kind === "system" ? `— ${m.content} —` : m.content}
            </Text>
          )}
        </Box>
      )}
    </Static>
  );
}

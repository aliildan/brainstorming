import React from "react";
import { Box, Text } from "ink";
import type { AgentStatus } from "@brainstorming/core";
import { authorColor } from "../theme.js";

const DOT: Record<AgentStatus, string> = {
  idle: "●",
  thinking: "◐",
  "awaiting-permission": "◍",
};

export function StatusBar({
  title,
  statuses,
}: {
  title: string;
  statuses: ReadonlyMap<string, AgentStatus>;
}) {
  return (
    <Box borderStyle="round" paddingX={1} justifyContent="space-between">
      <Text bold>{title}</Text>
      <Text>
        {[...statuses.entries()].map(([name, status]) => (
          <Text key={name}>
            {" "}
            <Text color={status === "idle" ? "gray" : authorColor(name)}>{DOT[status]}</Text>
            <Text> {name}</Text>
          </Text>
        ))}
      </Text>
    </Box>
  );
}

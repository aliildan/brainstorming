import React from "react";
import { Box, Text } from "ink";
import { authorColor } from "../theme.js";

export function LiveBlocks({ live }: { live: ReadonlyMap<string, string> }) {
  return (
    <Box flexDirection="column">
      {[...live.entries()].map(([agent, text]) => (
        <Box key={agent}>
          <Text>
            <Text bold color={authorColor(agent)}>
              [{agent}]
            </Text>
            <Text> {text}</Text>
            <Text dimColor>▋</Text>
          </Text>
        </Box>
      ))}
    </Box>
  );
}

import React from "react";
import { Box, Text } from "ink";
import { authorColor } from "../theme.js";
import type { PermissionPrompt } from "../use-room.js";

export function PermissionCard({ prompt }: { prompt: PermissionPrompt }) {
  return (
    <Box borderStyle="double" borderColor="yellow" flexDirection="column" paddingX={1}>
      <Text>
        <Text bold color="yellow">
          PERMISSION{" "}
        </Text>
        <Text bold color={authorColor(prompt.agent)}>
          @{prompt.agent}
        </Text>
        <Text> wants to {prompt.request.action}</Text>
      </Text>
      <Text dimColor>{prompt.request.preview}</Text>
      <Text>
        <Text color="green">[i]</Text> allow once <Text color="green">[o]</Text> allow for session{" "}
        <Text color="red">[r]</Text> deny
      </Text>
    </Box>
  );
}

import React from "react";
import { Box, Text } from "ink";
import type { Room } from "@brainstorming/core";
import { useRoom } from "./use-room.js";
import { Transcript } from "./components/transcript.js";
import { LiveBlocks } from "./components/live-blocks.js";
import { StatusBar } from "./components/status-bar.js";

export function App({ room, title = "brainstorming" }: { room: Room; title?: string }) {
  const view = useRoom(room);
  return (
    <Box flexDirection="column">
      <StatusBar title={title} statuses={view.statuses} />
      <Transcript messages={view.messages} />
      <LiveBlocks live={view.live} />
      {view.notice ? <Text color="yellow">{view.notice}</Text> : null}
    </Box>
  );
}

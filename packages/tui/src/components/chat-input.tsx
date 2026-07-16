import React, { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

/** Current @-token under the cursor (end of line), or null. */
export function mentionPrefix(value: string): string | null {
  const m = /(?:^|\s)@([a-z0-9._:-]*)$/i.exec(value);
  return m ? m[1].toLowerCase() : null;
}

export function suggestions(value: string, roster: string[]): string[] {
  const prefix = mentionPrefix(value);
  if (prefix === null) return [];
  return ["all", ...roster].filter((n) => n.startsWith(prefix) && n !== prefix);
}

export function ChatInput({
  roster,
  onSubmit,
  disabled,
}: {
  roster: string[];
  onSubmit: (line: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");
  // Mirror the value in a ref so keypresses that arrive in the same tick
  // (e.g. text immediately followed by Enter) always read the latest input.
  const valueRef = useRef("");
  const setVal = (next: string) => {
    valueRef.current = next;
    setValue(next);
  };
  const hints = suggestions(value, roster);

  useInput(
    (input, key) => {
      if (key.return) {
        const line = valueRef.current.trim();
        if (line) {
          setVal("");
          onSubmit(line);
        }
        return;
      }
      if (key.backspace || key.delete) {
        setVal(valueRef.current.slice(0, -1));
        return;
      }
      if (key.tab) {
        const prefix = mentionPrefix(valueRef.current);
        const options = prefix === null ? [] : suggestions(valueRef.current, roster);
        if (prefix !== null && options.length > 0) {
          setVal(valueRef.current.slice(0, valueRef.current.length - prefix.length) + options[0] + " ");
        }
        return;
      }
      if (input && !key.ctrl && !key.meta && !key.escape) setVal(valueRef.current + input);
    },
    { isActive: !disabled },
  );

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" paddingX={1}>
        <Text>
          {"> "}
          {value}
          <Text inverse> </Text>
        </Text>
      </Box>
      {hints.length > 0 ? (
        <Text dimColor>tab: {hints.map((h) => "@" + h).join("  ")}</Text>
      ) : null}
    </Box>
  );
}

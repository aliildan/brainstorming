import { useEffect, useState } from "react";
import type {
  AgentStatus,
  ChatMessage,
  PermissionDecision,
  PermissionRequest,
  Room,
} from "@brainstorming/core";

export interface PermissionPrompt {
  agent: string;
  request: PermissionRequest;
  respond: (d: PermissionDecision) => void;
}

export interface RoomView {
  messages: ChatMessage[];
  live: ReadonlyMap<string, string>;
  statuses: ReadonlyMap<string, AgentStatus>;
  permissions: PermissionPrompt[];
  notice: string | null;
}

/** Subscribe to RoomEvents and project them into immutable view state. */
export function useRoom(room: Room): RoomView {
  const [messages, setMessages] = useState<ChatMessage[]>([...room.transcript.all()]);
  const [live, setLive] = useState<ReadonlyMap<string, string>>(new Map());
  const [statuses, setStatuses] = useState<ReadonlyMap<string, AgentStatus>>(
    new Map(room.roster.map((n) => [n, "idle" as AgentStatus])),
  );
  const [permissions, setPermissions] = useState<PermissionPrompt[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    return room.on((ev) => {
      switch (ev.type) {
        case "message":
          // Re-read the transcript (the source of truth) so no message is lost
          // even if an earlier event fired before this listener registered.
          setMessages([...room.transcript.all()]);
          if (ev.message.author !== "user" && ev.message.author !== "system") {
            setLive((prev) => {
              const next = new Map(prev);
              next.delete(ev.message.author);
              return next;
            });
          }
          break;
        case "stream-delta":
          setLive((prev) => {
            const next = new Map(prev);
            next.set(ev.agent, (next.get(ev.agent) ?? "") + ev.text);
            return next;
          });
          break;
        case "agent-status":
          setStatuses((prev) => new Map(prev).set(ev.agent, ev.status));
          if (ev.status === "idle") {
            setLive((prev) => {
              const next = new Map(prev);
              next.delete(ev.agent);
              return next;
            });
          }
          break;
        case "permission": {
          const prompt: PermissionPrompt = {
            agent: ev.agent,
            request: ev.request,
            respond: ev.respond,
          };
          setPermissions((prev) => [...prev, prompt]);
          break;
        }
        case "budget-exhausted":
          setNotice("Round budget exhausted — /continue to let agents proceed.");
          break;
        case "agent-error":
          setNotice(`@${ev.agent} error: ${ev.error.message}`);
          break;
      }
    });
  }, [room]);

  return { messages, live, statuses, permissions, notice };
}

/** Remove an answered permission from the queue (used by App). */
export function dropPermission(
  list: PermissionPrompt[],
  target: PermissionPrompt,
): PermissionPrompt[] {
  return list.filter((p) => p !== target);
}

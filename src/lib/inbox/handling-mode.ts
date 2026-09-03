import type { Conversation } from "@/types";

/**
 * Who is effectively handling a conversation right now.
 *
 * Assignment always wins: if an agent is assigned, a human owns the
 * thread regardless of the handling_mode flag (mirrors the auto-reply
 * gate in src/lib/ai/auto-reply.ts). Otherwise the sticky handling_mode
 * decides — 'ai' is the default for conversations that never switched.
 */
export type EffectiveHandler = "ai" | "human";

export function getEffectiveHandler(conversation: Conversation): EffectiveHandler {
  if (conversation.assigned_agent_id) return "human";
  return conversation.handling_mode ?? "ai";
}

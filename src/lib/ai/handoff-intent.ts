// ============================================================
// Human Handoff Intent Detector
//
// A lightweight, keyword-based detector that runs BEFORE the LLM on
// every inbound message. When the customer explicitly asks for a human
// ("talk to an agent", "موظف", "agent se baat"), it switches the
// conversation to human handling immediately — no LLM call required,
// and no wasted auto-reply on a message that clearly wants a person.
//
// Mirrors the cart-intent architecture: pure classifier (testable)
// + dispatch wrapper that owns all I/O and never throws.
//
// The reverse direction (human → AI) is a deliberate UI action in the
// Inbox (the AI/Human toggle) — customers can't flip themselves back.
// ============================================================

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { engineSendText } from '@/lib/flows/meta-send';

export type HandoffIntent = 'human_request' | null;

const HUMAN_REQUEST_PATTERNS = [
  // English
  /\b(talk|speak|chat)\s+(to|with)\s+(a\s+|an\s+)?(human|person|agent|someone\s+real|real\s+person|real\s+agent)\b/i,
  /\bcan\s+i\s+(talk|speak|chat)\s+(to|with)\s+(a\s+|an\s+)?(human|person|agent)\b/i,
  /\b(human|real\s+person|real\s+agent|representative)\s+please\b/i,
  /\bi\s+(want|need)\s+(a\s+|an\s+)?(real\s+)?(human|agent|person)\b/i,
  /\bcustomer\s+(service|support|care|representative)\b/i,
  /\bconnect\s+me\s+(to|with)\s+(a\s+|an\s+)?(human|agent|person)\b/i,
  /\bis\s+(anyone|somebody)\s+there\b/i,
  /\bstop\s+(the\s+)?(bot|robot)\b/i,
  // Arabic (Gulf + MSA)
  /(أبغى|ابي|اريد|أريد|ابغي|بغيت|ممكن)\s+(أتكلم|اتكلم|أكلمه|اكلمه)?\s*(مع\s+)?(موظف|موظفة|شخص|وكيل|مندوب|خدمة\s+العملاء)/u,
  /(كلمني|كلموني|تواصل\s+معي)\s*(مع\s+)?(موظف|شخص|وكيل|مندوب)?/u,
  /موظف\s+حقيقي|شخص\s+حقيقي|ما\s+أبغى\s+بوت|لا\s+تريد\s+رد\s+آلي/u,
  // Hindi / Roman Urdu
  /\b(insaan|aadmi|bande?)\s+se\s+baat\b/i,
  /\b(agent|human|representative)\s+se\s+baat\b/i,
  /\bmujhe\s+(agent|human|insaan)\s+(chahiye|se\s+baat\s+hai)\b/i,
];

/**
 * Classify the inbound message text into a handoff intent (or null).
 */
export function classifyHandoffIntent(text: string): HandoffIntent {
  if (!text?.trim()) return null;
  for (const p of HUMAN_REQUEST_PATTERNS) {
    if (p.test(text)) return 'human_request';
  }
  return null;
}

/** Detect the customer's language so the confirmation matches it. */
function detectLang(text: string): 'ar' | 'hi' | 'en' {
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/\b(kya|hai|mujhe|baat|chahiye|insaan|aadmi|karo|nahi|ji)\b/i.test(text)) return 'hi';
  return 'en';
}

const CONFIRMATION: Record<'ar' | 'hi' | 'en', string> = {
  en: "No problem — I'm connecting you with a team member now. 🧑‍💼 A human agent will be with you shortly!",
  ar: 'أكيد! راح أوصلك مع أحد موظفينا الحقيقيين الآن. 🧑‍💼',
  hi: 'ज़रूर! मैं आपको हमारी टीम के किसी सदस्य से जोड़ रहा हूँ। 🧑‍💼',
};

export interface HandoffIntentArgs {
  accountId: string;
  contactId: string;
  conversationId: string;
  configOwnerUserId: string;
  inboundText: string;
}

/**
 * Entry point called by the webhook after the cart-intent layer. Returns
 * true when a human request was handled (caller must skip the LLM),
 * false otherwise. Never throws.
 */
export async function dispatchHandoffIntent(args: HandoffIntentArgs): Promise<boolean> {
  const intent = classifyHandoffIntent(args.inboundText);
  if (!intent) return false;

  const db = supabaseAdmin();
  try {
    // Sticky switch to human handling (migration 046). Keep the legacy
    // ai_autoreply_disabled flag in sync for older readers.
    await db
      .from('conversations')
      .update({ handling_mode: 'human', ai_autoreply_disabled: true, status: 'pending' })
      .eq('id', args.conversationId);

    await engineSendText({
      accountId: args.accountId,
      userId: args.configOwnerUserId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: CONFIRMATION[detectLang(args.inboundText)],
    });

    try {
      await db.rpc('create_handoff_notification', {
        p_account_id: args.accountId,
        p_conversation_id: args.conversationId,
        p_reason: 'Customer requested a human agent',
      });
    } catch (err) {
      console.error('[handoff-intent] create_handoff_notification failed:', err);
    }

    return true;
  } catch (err) {
    console.error('[handoff-intent] dispatch failed:', err);
    return false;
  }
}

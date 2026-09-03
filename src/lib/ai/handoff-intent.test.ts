import { describe, it, expect } from 'vitest';
import { classifyHandoffIntent } from './handoff-intent';

describe('classifyHandoffIntent — human_request', () => {
  it('matches English requests', () => {
    expect(classifyHandoffIntent('Can I talk to a human?')).toBe('human_request');
    expect(classifyHandoffIntent('I want to speak with an agent')).toBe('human_request');
    expect(classifyHandoffIntent('human please')).toBe('human_request');
    expect(classifyHandoffIntent('connect me with customer support')).toBe('human_request');
    expect(classifyHandoffIntent('Is anyone there?')).toBe('human_request');
    expect(classifyHandoffIntent('stop the bot')).toBe('human_request');
    expect(classifyHandoffIntent('I need a real person')).toBe('human_request');
  });

  it('matches Arabic requests', () => {
    expect(classifyHandoffIntent('أبغى أتكلم مع موظف')).toBe('human_request');
    expect(classifyHandoffIntent('ابي شخص حقيقي')).toBe('human_request');
    expect(classifyHandoffIntent('كلمني مع خدمة العملاء')).toBe('human_request');
    expect(classifyHandoffIntent('ممكن أتكلم مع وكيل؟')).toBe('human_request');
  });

  it('matches Hindi / Roman Urdu requests', () => {
    expect(classifyHandoffIntent('mujhe agent se baat karni hai')).toBe('human_request');
    expect(classifyHandoffIntent('insaan se baat karo')).toBe('human_request');
    expect(classifyHandoffIntent('mujhe agent chahiye')).toBe('human_request');
  });
});

describe('classifyHandoffIntent — no match', () => {
  it('returns null for normal messages', () => {
    expect(classifyHandoffIntent('Hello!')).toBeNull();
    expect(classifyHandoffIntent('What products do you have?')).toBeNull();
    expect(classifyHandoffIntent('are you a bot?')).toBeNull();
    expect(classifyHandoffIntent('thanks, bye')).toBeNull();
    expect(classifyHandoffIntent('')).toBeNull();
  });

  it('does not hijack ambiguous "agent" mentions', () => {
    // "my agent" without a request verb should fall through to the AI.
    expect(classifyHandoffIntent('my delivery agent never called')).toBeNull();
    expect(classifyHandoffIntent('are you an agent or AI?')).toBeNull();
  });
});

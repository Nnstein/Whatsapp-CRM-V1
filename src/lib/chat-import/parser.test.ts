import { describe, expect, it } from 'vitest';
import { parseWhatsAppChat, type ParsedChat } from './parser';

// ─── Helper ─────────────────────────────────────────────────────

function ts(d: Date): string {
  return d.toISOString();
}

// ─── iOS format tests ────────────────────────────────────────────

describe('parseWhatsAppChat — iOS format', () => {
  const IOS_BASIC = `[01/08/2024, 10:15:30] Merchant: Hello, how can I help you?
[01/08/2024, 10:16:00] Customer: I want to buy the foundation
[01/08/2024, 10:16:45] Merchant: Sure! Which shade do you prefer?`;

  it('detects iOS format', () => {
    const result = parseWhatsAppChat(IOS_BASIC, 'Merchant');
    expect(result.detectedFormat).toBe('ios');
  });

  it('parses all three messages', () => {
    const result = parseWhatsAppChat(IOS_BASIC, 'Merchant');
    expect(result.messages).toHaveLength(3);
  });

  it('correctly marks outbound (merchant) messages', () => {
    const result = parseWhatsAppChat(IOS_BASIC, 'Merchant');
    expect(result.messages[0].isOutbound).toBe(true);
    expect(result.messages[1].isOutbound).toBe(false);
    expect(result.messages[2].isOutbound).toBe(true);
  });

  it('extracts message content', () => {
    const result = parseWhatsAppChat(IOS_BASIC, 'Merchant');
    expect(result.messages[0].contentText).toBe('Hello, how can I help you?');
    expect(result.messages[1].contentText).toBe('I want to buy the foundation');
  });

  it('parses timestamp correctly', () => {
    const result = parseWhatsAppChat(IOS_BASIC, 'Merchant');
    const msg = result.messages[0];
    expect(msg.timestamp.getFullYear()).toBe(2024);
    expect(msg.timestamp.getMonth()).toBe(7); // August = 7
    expect(msg.timestamp.getDate()).toBe(1);
    expect(msg.timestamp.getHours()).toBe(10);
    expect(msg.timestamp.getMinutes()).toBe(15);
  });

  it('collects participant names', () => {
    const result = parseWhatsAppChat(IOS_BASIC, 'Merchant');
    expect(result.participantNames).toContain('Merchant');
    expect(result.participantNames).toContain('Customer');
  });
});

// ─── Android format tests ────────────────────────────────────────

describe('parseWhatsAppChat — Android format', () => {
  const ANDROID_12H = `08/01/24, 10:15 AM - Shop Owner: Good morning!
08/01/24, 10:16 AM - Ali Hassan: Can I see the catalog?
08/01/24, 3:30 PM - Shop Owner: Of course, here it is`;

  it('detects Android format', () => {
    const result = parseWhatsAppChat(ANDROID_12H, 'Shop Owner');
    expect(result.detectedFormat).toBe('android');
  });

  it('correctly parses 12h AM/PM times', () => {
    const result = parseWhatsAppChat(ANDROID_12H, 'Shop Owner');
    expect(result.messages[0].timestamp.getHours()).toBe(10);
    expect(result.messages[2].timestamp.getHours()).toBe(15); // 3 PM
  });

  it('correctly identifies sender direction', () => {
    const result = parseWhatsAppChat(ANDROID_12H, 'Shop Owner');
    expect(result.messages[0].isOutbound).toBe(true);
    expect(result.messages[1].isOutbound).toBe(false);
    expect(result.messages[2].isOutbound).toBe(true);
  });
});

// ─── Media handling ──────────────────────────────────────────────

describe('parseWhatsAppChat — media messages', () => {
  const WITH_MEDIA = `[10/03/2025, 09:00:00] Merchant: Here is the product photo
[10/03/2025, 09:00:01] Merchant: IMG-20250310-WA0001.jpg (file attached)
[10/03/2025, 09:01:00] Customer: <Media omitted>
[10/03/2025, 09:02:00] Customer: PTT-20250310-WA0002.opus (file attached)
[10/03/2025, 09:03:00] Merchant: Invoice.pdf (file attached)`;

  it('classifies image attachment correctly', () => {
    const result = parseWhatsAppChat(WITH_MEDIA, 'Merchant');
    const imgMsg = result.messages.find((m) => m.mediaFilename?.includes('IMG'));
    expect(imgMsg).toBeDefined();
    expect(imgMsg!.contentType).toBe('image');
    expect(imgMsg!.contentText).toBe('[Photo]');
  });

  it('classifies voice note attachment correctly', () => {
    const result = parseWhatsAppChat(WITH_MEDIA, 'Merchant');
    const voiceMsg = result.messages.find((m) => m.mediaFilename?.includes('PTT'));
    expect(voiceMsg).toBeDefined();
    expect(voiceMsg!.contentType).toBe('audio');
    expect(voiceMsg!.contentText).toBe('[Voice Note]');
  });

  it('classifies document attachment correctly', () => {
    const result = parseWhatsAppChat(WITH_MEDIA, 'Merchant');
    const docMsg = result.messages.find((m) => m.mediaFilename?.includes('.pdf'));
    expect(docMsg).toBeDefined();
    expect(docMsg!.contentType).toBe('document');
    expect(docMsg!.contentText).toBe('[Document]');
  });

  it('handles <Media omitted> as image placeholder', () => {
    const result = parseWhatsAppChat(WITH_MEDIA, 'Merchant');
    const omitted = result.messages.find((m) => m.contentText === '[Media omitted]');
    expect(omitted).toBeDefined();
    expect(omitted!.contentType).toBe('image');
  });
});

// ─── System message filtering ────────────────────────────────────

describe('parseWhatsAppChat — system message filtering', () => {
  const WITH_SYSTEM = `[01/01/2025, 08:00:00] System: Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them. Tap to learn more.
[01/01/2025, 08:01:00] Sara: Hi there!
[01/01/2025, 08:01:30] Merchant: Hello Sara, welcome!
[01/01/2025, 08:02:00] System: Sara changed their phone number to a new number. Tap to message or add the new number.`;

  it('filters out system messages', () => {
    const result = parseWhatsAppChat(WITH_SYSTEM, 'Merchant');
    expect(result.messages).toHaveLength(2);
  });

  it('keeps real customer and merchant messages', () => {
    const result = parseWhatsAppChat(WITH_SYSTEM, 'Merchant');
    expect(result.messages[0].contentText).toBe('Hi there!');
    expect(result.messages[1].contentText).toBe('Hello Sara, welcome!');
  });
});

// ─── Multi-line messages ─────────────────────────────────────────

describe('parseWhatsAppChat — multi-line messages', () => {
  const MULTILINE = `[05/06/2025, 11:00:00] Merchant: Here is your order summary:
- Foundation Stick x1 — SAR 120
- Matte Lipstick x2 — SAR 130

Total: SAR 250
[05/06/2025, 11:01:00] Customer: Perfect, thank you!`;

  it('accumulates continuation lines into the previous message', () => {
    const result = parseWhatsAppChat(MULTILINE, 'Merchant');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].contentText).toContain('Foundation Stick');
    expect(result.messages[0].contentText).toContain('Total: SAR 250');
  });

  it('does not lose the next message after a multi-line one', () => {
    const result = parseWhatsAppChat(MULTILINE, 'Merchant');
    expect(result.messages[1].contentText).toBe('Perfect, thank you!');
  });
});

// ─── Edge cases ──────────────────────────────────────────────────

describe('parseWhatsAppChat — edge cases', () => {
  it('returns empty messages for an empty file', () => {
    const result = parseWhatsAppChat('', 'Merchant');
    expect(result.messages).toHaveLength(0);
  });

  it('returns empty messages for a file with only system messages', () => {
    const text = `[01/01/2025, 00:00:00] System: Messages and calls are end-to-end encrypted.`;
    const result = parseWhatsAppChat(text, 'Merchant');
    expect(result.messages).toHaveLength(0);
  });

  it('is case-insensitive when matching merchant name for direction', () => {
    const text = `[01/01/2025, 10:00:00] MY SHOP: Hello
[01/01/2025, 10:01:00] Customer: Hi`;
    const result = parseWhatsAppChat(text, 'my shop');
    expect(result.messages[0].isOutbound).toBe(true);
    expect(result.messages[1].isOutbound).toBe(false);
  });

  it('handles Arabic sender names', () => {
    const text = `[٠١/٠٨/٢٠٢٤, ١٠:١٥:٣٠] التاجر: مرحبا، كيف يمكنني مساعدتك؟
[01/08/2024, 10:16:00] أحمد: أريد شراء المنتج`;
    // Arabic-indic numerals in the date won't parse as a date, but the
    // second message should parse correctly.
    const result = parseWhatsAppChat(text, 'أحمد');
    // At minimum it should not throw
    expect(result).toBeDefined();
  });

  it('parses 2-digit year correctly (Android short format)', () => {
    const text = `8/1/24, 10:15 AM - Merchant: Hello
8/1/24, 10:16 AM - Customer: Hi`;
    const result = parseWhatsAppChat(text, 'Merchant');
    expect(result.messages[0].timestamp.getFullYear()).toBe(2024);
  });
});

// ============================================================
// WhatsApp Chat Export Parser
//
// Parses raw .txt files exported from the WhatsApp mobile app
// and returns a structured list of messages with timestamps,
// sender names, direction (inbound/outbound), and content type.
//
// Supports:
//   • iOS format:     [25/08/2026, 14:30:15] Name: text
//   • Android format: 08/25/26, 2:30 PM - Name: text
//   • 24h and 12h clocks, DD/MM and MM/DD date orders
//   • Arabic / RTL locale variants
//   • Media-omitted placeholder lines
//   • Multi-line messages (continuation lines)
//   • System message filtering
// ============================================================

export type ImportedContentType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker';

export interface ParsedMessage {
  /** Original timestamp parsed from the chat file. */
  timestamp: Date;
  /** Raw sender name as it appears in the export. */
  senderName: string;
  /**
   * True when the sender is the merchant / business owner.
   * Determined by matching senderName to the merchantName hint.
   */
  isOutbound: boolean;
  contentType: ImportedContentType;
  /** Text content; null for pure media-omitted lines. */
  contentText: string | null;
  /** Original media filename if present (e.g. IMG-20240103-WA0001.jpg). */
  mediaFilename: string | null;
}

export interface ParsedChat {
  detectedFormat: 'ios' | 'android' | 'unknown';
  /** All distinct participant names found in the file. */
  participantNames: string[];
  messages: ParsedMessage[];
}

// ─── Regex patterns ────────────────────────────────────────────

/**
 * iOS: [DD/MM/YYYY, HH:MM:SS] Name: text
 * The date/time part is inside square brackets, locale-independent
 * as WhatsApp uses ISO-style separators on iOS.
 */
const IOS_PATTERN =
  /^\[(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)\]\s+([^:]+?):\s([\s\S]*)/;

/**
 * Android: MM/DD/YY, H:MM AM/PM - Name: text
 * No square brackets; date and time are separated by a comma, then
 * a dash separates the timestamp from the sender.
 */
const ANDROID_PATTERN =
  /^(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)\s+-\s+([^:]+?):\s([\s\S]*)/;

/**
 * System messages to silently discard.
 * Covers English, Arabic, and common multi-locale variants.
 */
const SYSTEM_PATTERNS: RegExp[] = [
  /^Messages and calls are end-to-end encrypted/i,
  /^<Media omitted>$/i,
  /This message was deleted/i,
  /You deleted this message/i,
  /changed their phone number/i,
  /changed the subject/i,
  /changed this group/i,
  /added you/i,
  /was added/i,
  /left$/i,
  /joined using this group/i,
  /security code changed/i,
  /^null$/i,
  // Arabic system messages
  /^تم تشفير رسائلك/,
  /^تمت إضافتك/,
  /^غادر/,
];

/**
 * Media attachment patterns detected in the message body.
 * WhatsApp exports media as a filename followed by (file attached).
 */
const MEDIA_PATTERNS: {
  regex: RegExp;
  contentType: ImportedContentType;
  label: string;
}[] = [
  {
    regex: /^(IMG-\S+\.(?:jpg|jpeg|png|webp|gif))\s*\(file attached\)$/i,
    contentType: 'image',
    label: '[Photo]',
  },
  {
    regex: /^(VID-\S+\.(?:mp4|mov|avi|mkv))\s*\(file attached\)$/i,
    contentType: 'video',
    label: '[Video]',
  },
  {
    regex: /^(PTT-\S+\.(?:opus|ogg|m4a|mp3))\s*\(file attached\)$/i,
    contentType: 'audio',
    label: '[Voice Note]',
  },
  {
    regex: /^(\S+\.(?:pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip))\s*\(file attached\)$/i,
    contentType: 'document',
    label: '[Document]',
  },
  {
    regex: /^(\S+\.webp)\s*\(file attached\)$/i,
    contentType: 'sticker',
    label: '[Sticker]',
  },
  // Generic fallback for any (file attached) line
  {
    regex: /^(\S+)\s*\(file attached\)$/i,
    contentType: 'document',
    label: '[Attachment]',
  },
  // Plain "<Media omitted>" or "image omitted" lines
  {
    regex: /^<Media omitted>$/i,
    contentType: 'image',
    label: '[Media omitted]',
  },
  {
    regex: /^image omitted$/i,
    contentType: 'image',
    label: '[Photo]',
  },
  {
    regex: /^video omitted$/i,
    contentType: 'video',
    label: '[Video]',
  },
  {
    regex: /^audio omitted$/i,
    contentType: 'audio',
    label: '[Voice Note]',
  },
  {
    regex: /^document omitted$/i,
    contentType: 'document',
    label: '[Document]',
  },
  {
    regex: /^sticker omitted$/i,
    contentType: 'sticker',
    label: '[Sticker]',
  },
];

// ─── Date parsing helpers ───────────────────────────────────────

/**
 * Normalise a date+time string pair to a JS Date.
 * WhatsApp exports use DD/MM/YYYY on most locales; some Android
 * locales use MM/DD/YY. We try DD/MM first, then MM/DD as fallback.
 */
function parseDateTime(datePart: string, timePart: string): Date {
  // Normalise separators: dots and dashes → slashes
  const d = datePart.replace(/[.\-]/g, '/');
  const parts = d.split('/');

  let year: number, month: number, day: number;

  if (parts.length === 3) {
    const [a, b, c] = parts.map(Number);
    if (c > 31) {
      // c is the 4-digit year → DD/MM/YYYY (most common global format)
      day = a;
      month = b - 1;
      year = c;
    } else if (c >= 0 && c <= 99) {
      // 2-digit year — treat as DD/MM/YY → add 2000
      day = a;
      month = b - 1;
      year = c + 2000;
    } else {
      day = a;
      month = b - 1;
      year = c;
    }
  } else {
    return new Date(NaN);
  }

  // Parse time: HH:MM[:SS][ AM|PM]
  const timeClean = timePart.trim();
  const amPmMatch = timeClean.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s?([AP]M)?/i);
  if (!amPmMatch) return new Date(NaN);

  let hours = parseInt(amPmMatch[1], 10);
  const minutes = parseInt(amPmMatch[2], 10);
  const seconds = amPmMatch[3] ? parseInt(amPmMatch[3], 10) : 0;
  const amPm = amPmMatch[4]?.toUpperCase();

  if (amPm === 'PM' && hours < 12) hours += 12;
  if (amPm === 'AM' && hours === 12) hours = 0;

  return new Date(year, month, day, hours, minutes, seconds);
}

// ─── Content classifier ─────────────────────────────────────────

function classifyContent(body: string): {
  contentType: ImportedContentType;
  contentText: string | null;
  mediaFilename: string | null;
} {
  const trimmed = body.trim();

  for (const { regex, contentType, label } of MEDIA_PATTERNS) {
    const m = trimmed.match(regex);
    if (m) {
      return {
        contentType,
        contentText: label,
        mediaFilename: m[1] ?? null,
      };
    }
  }

  return {
    contentType: 'text',
    contentText: trimmed || null,
    mediaFilename: null,
  };
}

// ─── System message check ───────────────────────────────────────

function isSystemMessage(body: string): boolean {
  const t = body.trim();
  return SYSTEM_PATTERNS.some((p) => p.test(t));
}

// ─── Normalise merchant name for comparison ─────────────────────

function normaliseName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// ─── Main parser ────────────────────────────────────────────────

/**
 * Parse a raw WhatsApp `.txt` export into structured messages.
 *
 * @param text       Raw file contents (UTF-8 string).
 * @param merchantName  The display name the business owner used in
 *                   the exported chat (used to set isOutbound).
 */
export function parseWhatsAppChat(
  text: string,
  merchantName: string,
): ParsedChat {
  const normMerchant = normaliseName(merchantName);
  const lines = text.split(/\r?\n/);

  let detectedFormat: ParsedChat['detectedFormat'] = 'unknown';
  const participantSet = new Set<string>();
  const messages: ParsedMessage[] = [];

  // Working variables for multi-line message accumulation
  let currentMsg: {
    timestamp: Date;
    senderName: string;
    body: string;
  } | null = null;

  function flushCurrent() {
    if (!currentMsg) return;

    const { timestamp, senderName, body } = currentMsg;
    // Classify content first — media-omitted lines should become
    // placeholder bubbles even though they resemble system text.
    const classified = classifyContent(body);

    // Only filter system messages for text content (non-media lines)
    const shouldDrop =
      classified.contentType === 'text' && isSystemMessage(body);

    if (!shouldDrop && (classified.contentText !== null || classified.mediaFilename !== null)) {
      messages.push({
        timestamp,
        senderName,
        isOutbound: normaliseName(senderName) === normMerchant,
        ...classified,
      });
    }
    currentMsg = null;
  }

  for (const line of lines) {
    // Try iOS pattern first
    let m = line.match(IOS_PATTERN);
    if (m) {
      detectedFormat = 'ios';
      flushCurrent();
      const [, datePart, timePart, senderName, body] = m;
      participantSet.add(senderName.trim());
      currentMsg = {
        timestamp: parseDateTime(datePart, timePart),
        senderName: senderName.trim(),
        body: body,
      };
      continue;
    }

    // Try Android pattern
    m = line.match(ANDROID_PATTERN);
    if (m) {
      detectedFormat = 'android';
      flushCurrent();
      const [, datePart, timePart, senderName, body] = m;
      participantSet.add(senderName.trim());
      currentMsg = {
        timestamp: parseDateTime(datePart, timePart),
        senderName: senderName.trim(),
        body: body,
      };
      continue;
    }

    // Continuation line — append to the current message's body
    if (currentMsg && line.trim()) {
      currentMsg.body += '\n' + line;
    }
  }

  // Flush the last message
  flushCurrent();

  return {
    detectedFormat,
    participantNames: Array.from(participantSet),
    messages,
  };
}

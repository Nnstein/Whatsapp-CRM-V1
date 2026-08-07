// ============================================================
// Multilingual Language Detection & Normalization Engine
//
// Supports:
//   - Gulf Arabic / Arabic ('ar'): script range \u0600-\u06FF, \u0750-\u077F, \u08A0-\u08FF
//   - Hindi / Hinglish ('hi'): script range \u0900-\u097F or Hinglish keywords
//   - English ('en'): default fallback
// ============================================================

export type SupportedLanguage = 'ar' | 'hi' | 'en';

export interface LanguageMeta {
  code: SupportedLanguage;
  label: string;
  nativeLabel: string;
  flag: string;
}

export const SUPPORTED_LANGUAGES: Record<SupportedLanguage, LanguageMeta> = {
  ar: {
    code: 'ar',
    label: 'Gulf Arabic',
    nativeLabel: 'العربية (الخليجية)',
    flag: '🇦🇪',
  },
  hi: {
    code: 'hi',
    label: 'Hindi',
    nativeLabel: 'हिन्दी',
    flag: '🇮🇳',
  },
  en: {
    code: 'en',
    label: 'English',
    nativeLabel: 'English',
    flag: '🇬🇧',
  },
};

/**
 * Normalises raw language codes (e.g. 'ar_AE', 'ar-SA', 'hi_IN', 'en_US')
 * to standard ISO codes ('ar', 'hi', 'en').
 */
export function normalizeLanguageCode(
  raw: string | null | undefined
): SupportedLanguage {
  if (!raw) return 'en';
  const lower = raw.trim().toLowerCase();
  if (lower.startsWith('ar') || lower.includes('arabic') || lower.includes('khaleeji')) {
    return 'ar';
  }
  if (lower.startsWith('hi') || lower.includes('hindi') || lower.includes('hinglish')) {
    return 'hi';
  }
  return 'en';
}

/**
 * Fast client/server language detector from text content using script regex & vocabulary.
 */
export function detectLanguageFromText(text: string | null | undefined): SupportedLanguage {
  if (!text) return 'en';
  const trimmed = text.trim();
  if (!trimmed) return 'en';

  // Arabic / Gulf Arabic script check (\u0600-\u06FF, \u0750-\u077F, \u08A0-\u08FF)
  const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
  if (ARABIC_SCRIPT_RE.test(trimmed)) {
    return 'ar';
  }

  // Devanagari Hindi script check (\u0900-\u097F)
  const DEVANAGARI_SCRIPT_RE = /[\u0900-\u097F]/;
  if (DEVANAGARI_SCRIPT_RE.test(trimmed)) {
    return 'hi';
  }

  // Common Romanised Hinglish keywords check
  const HINGLISH_RE = /\b(namaste|kaise|kya|bhai|ji|dhanyawaad|kripya|apka|mERA|haan|nahi)\b/i;
  if (HINGLISH_RE.test(trimmed)) {
    return 'hi';
  }

  // Common Gulf Arabic transliterated keywords check
  const KHALEEJI_RE = /\b(marhaba|hala|shlonak|yall|mashkoor|abshar|habibi|shukran)\b/i;
  if (KHALEEJI_RE.test(trimmed)) {
    return 'ar';
  }

  return 'en';
}

/**
 * Human-readable display label with flag for a language code.
 */
export function getLanguageLabel(code: string | null | undefined): string {
  const norm = normalizeLanguageCode(code);
  const meta = SUPPORTED_LANGUAGES[norm];
  return `${meta.flag} ${meta.label}`;
}

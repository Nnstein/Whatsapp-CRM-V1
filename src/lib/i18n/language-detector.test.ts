import { describe, it, expect } from 'vitest';
import {
  detectLanguageFromText,
  normalizeLanguageCode,
  getLanguageLabel,
} from './language-detector';

describe('Language Detector & Normalizer', () => {
  it('detects Gulf Arabic text', () => {
    expect(detectLanguageFromText('شلونك يا الغالي أبا استفسر عن الأسعار')).toBe('ar');
    expect(detectLanguageFromText('أبشر مشكور جدا')).toBe('ar');
    expect(detectLanguageFromText('Hala habibi shukran')).toBe('ar');
  });

  it('detects Hindi text & Hinglish', () => {
    expect(detectLanguageFromText('नमस्ते सर, मुझे प्रोडक्ट की कीमत जाननी है')).toBe('hi');
    expect(detectLanguageFromText('Namaste kaise ho bhai kya price hai')).toBe('hi');
  });

  it('defaults to English for English text', () => {
    expect(detectLanguageFromText('Hello, I would like to inquire about your services.')).toBe('en');
  });

  it('normalizes language codes accurately', () => {
    expect(normalizeLanguageCode('ar_AE')).toBe('ar');
    expect(normalizeLanguageCode('ar-SA')).toBe('ar');
    expect(normalizeLanguageCode('khaleeji')).toBe('ar');
    expect(normalizeLanguageCode('hi_IN')).toBe('hi');
    expect(normalizeLanguageCode('hinglish')).toBe('hi');
    expect(normalizeLanguageCode('en_US')).toBe('en');
  });

  it('generates formatted language labels with flags', () => {
    expect(getLanguageLabel('ar')).toContain('🇦🇪 Gulf Arabic');
    expect(getLanguageLabel('hi')).toContain('🇮🇳 Hindi');
    expect(getLanguageLabel('en')).toContain('🇬🇧 English');
  });
});

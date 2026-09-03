import { describe, it, expect } from 'vitest';
import { normalizeAppUrl } from './payment-link';

const DEFAULT = 'https://whatsapp-crm-v1.onrender.com';

describe('normalizeAppUrl', () => {
  it('returns the default when input is missing or empty', () => {
    expect(normalizeAppUrl(undefined)).toBe(DEFAULT);
    expect(normalizeAppUrl(null)).toBe(DEFAULT);
    expect(normalizeAppUrl('')).toBe(DEFAULT);
    expect(normalizeAppUrl('   ')).toBe(DEFAULT);
  });

  it('passes through a valid https URL and strips trailing slashes', () => {
    expect(normalizeAppUrl('https://shop.example.com/')).toBe('https://shop.example.com');
    expect(normalizeAppUrl('https://shop.example.com///')).toBe('https://shop.example.com');
  });

  it('passes through http (localhost dev)', () => {
    expect(normalizeAppUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('prepends https:// when the scheme is missing', () => {
    expect(normalizeAppUrl('myapp.onrender.com')).toBe('https://myapp.onrender.com');
    expect(normalizeAppUrl('localhost:3000')).toBe('https://localhost:3000');
  });

  it('falls back to the default for junk values', () => {
    expect(normalizeAppUrl('not a url at all :::')).toBe(DEFAULT);
    expect(normalizeAppUrl('ftp://example.com')).toBe(DEFAULT);
  });
});

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

function isPrivateUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      return true;
    }
    // IPv4 private ranges
    const parts = hostname.split('.').map(Number);
    if (parts.length === 4 && parts.every((p) => !isNaN(p))) {
      if (parts[0] === 10) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 169 && parts[1] === 254) return true; // Link-local / metadata
    }
    return false;
  } catch {
    return true;
  }
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function extractTextFromHtml(html: string): { title: string; content: string } {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = titleMatch ? titleMatch[1].trim() : '';
  title = decodeHtmlEntities(title.replace(/\s+/g, ' '));

  // Strip script, style, noscript, nav, footer, header
  let clean = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

  // Add line breaks for structural HTML tags
  clean = clean
    .replace(/<\/(h[1-6]|p|div|li|tr|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ');

  // Strip remaining HTML tags
  clean = clean.replace(/<[^>]+>/g, ' ');

  // Decode entities and collapse multiple blank lines
  let text = decodeHtmlEntities(clean);
  text = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  if (!title) {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      title = decodeHtmlEntities(h1Match[1].replace(/<[^>]+>/g, '').trim());
    }
  }

  return { title, content: text };
}

/**
 * POST /api/ai/knowledge/import-url  (admin+)
 *
 * Scrapes a web URL and extracts clean document title & text content for the knowledge base.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireRole('admin');
    const limit = checkRateLimit(`ai-kb-url:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const rawUrl = typeof body?.url === 'string' ? body.url.trim() : '';

    if (!rawUrl) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    let validUrl: URL;
    try {
      validUrl = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    if (validUrl.protocol !== 'http:' && validUrl.protocol !== 'https:') {
      return NextResponse.json(
        { error: 'Only HTTP and HTTPS URLs are supported' },
        { status: 400 },
      );
    }

    if (isPrivateUrl(validUrl.toString())) {
      return NextResponse.json(
        { error: 'Internal or private IP addresses are not permitted' },
        { status: 400 },
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(validUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WhatsApp-CRM-Bot/1.0',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
      },
    }).finally(() => clearTimeout(timeoutId));

    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL (HTTP status ${res.status})` },
        { status: 400 },
      );
    }

    const contentType = res.headers.get('content-type') || '';
    const rawBody = await res.text();

    let extractedTitle = '';
    let extractedContent = '';

    if (contentType.includes('text/html') || rawBody.includes('<html')) {
      const parsed = extractTextFromHtml(rawBody);
      extractedTitle = parsed.title || validUrl.hostname;
      extractedContent = parsed.content;
    } else {
      extractedTitle = validUrl.hostname + validUrl.pathname;
      extractedContent = rawBody.trim();
    }

    if (!extractedContent) {
      return NextResponse.json(
        { error: 'Could not extract text content from the URL' },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      title: extractedTitle || validUrl.hostname,
      content: extractedContent,
      url: validUrl.toString(),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Request timed out after 10 seconds' },
        { status: 504 },
      );
    }
    return toErrorResponse(err);
  }
}

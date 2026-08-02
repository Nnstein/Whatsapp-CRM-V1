import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

function cleanTitleFromFilename(filename: string): string {
  const baseName = filename.replace(/\.[^/.]+$/, ''); // remove extension
  const title = baseName.replace(/[-_]+/g, ' ').trim();
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function extractTextFromBinaryPdf(buffer: Buffer): string {
  const raw = buffer.toString('binary');
  const textBlocks: string[] = [];

  // Match text within parenthesis inside PDF stream (e.g., (Hello World) Tj or [(Hello) (World)] TJ)
  const regex = /\(([\s\S]*?)\)\s*(?:Tj|TJ|'|")/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    const s = match[1]
      .replace(/\\([()\\])/g, '$1') // unescape \( \) \\
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .trim();

    if (s.length > 1 && /^[\x20-\x7E\s]+$/.test(s)) {
      textBlocks.push(s);
    }
  }

  if (textBlocks.length === 0) {
    // Fallback: extract continuous readable ascii sequences
    const asciiMatches = raw.match(/[\x20-\x7E\n\r\t]{5,}/g);
    if (asciiMatches) {
      return asciiMatches
        .filter((s) => !s.startsWith('/') && !s.includes('obj') && !s.includes('endobj'))
        .join('\n');
    }
  }

  return textBlocks.join(' ');
}

/**
 * POST /api/ai/knowledge/import-file  (admin+)
 *
 * Accepts a file upload (PDF, TXT, MD, CSV, JSON, DOCX), extracts text content,
 * and returns document title and content for knowledge base ingestion.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireRole('admin');
    const limit = checkRateLimit(`ai-kb-file:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      // 10 MB max
      return NextResponse.json(
        { error: 'File size exceeds 10 MB limit' },
        { status: 400 },
      );
    }

    const filename = file.name || 'Document';
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let extractedText = '';

    if (['txt', 'md', 'markdown', 'csv', 'json', 'yaml', 'yml'].includes(ext)) {
      extractedText = buffer.toString('utf-8');
    } else if (ext === 'pdf') {
      extractedText = extractTextFromBinaryPdf(buffer);
    } else {
      // Attempt UTF-8 text extraction for other text formats
      extractedText = buffer.toString('utf-8');
      // If full of control characters, fall back to printable strings
      if (/[\x00-\x08\x0E-\x1F]/.test(extractedText)) {
        extractedText = extractTextFromBinaryPdf(buffer);
      }
    }

    // Clean up line breaks and whitespace
    const cleanContent = extractedText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n');

    if (!cleanContent) {
      return NextResponse.json(
        { error: 'Could not extract readable text from the file' },
        { status: 400 },
      );
    }

    const title = cleanTitleFromFilename(filename);

    return NextResponse.json({
      success: true,
      title,
      content: cleanContent,
      fileName: filename,
      fileSize: file.size,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

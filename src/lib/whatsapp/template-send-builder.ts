/**
 * Build the Meta `components` array used by POST /{phone_number_id}/messages
 * when sending an APPROVED template.
 *
 * Distinct from `template-components.ts` — that module builds the
 * `components` for TEMPLATE CREATION (where you describe headers,
 * footers, buttons, examples). This module builds the per-send
 * `components` (where you fill in variable values and supply the
 * actual media link or button URL suffix for THIS specific delivery).
 *
 * Auto-fills as much as possible from the template row so callers
 * only need to supply values for the variable-bearing fields:
 *
 *   - Static IMAGE/VIDEO/DOCUMENT headers ride along automatically
 *     using the template's `header_media_url` (or `header_handle`).
 *     Meta requires the media component on every send even though
 *     the URL hasn't changed since approval.
 *   - TEXT headers with `{{1}}` need `headerText` from the caller.
 *   - Body variables come in as `body: string[]`, indexed by {{N}}.
 *   - URL buttons with `{{1}}` need `buttonUrlParams[i]` keyed by
 *     button index. URL buttons without variables, plus QUICK_REPLY
 *     and PHONE_NUMBER buttons, don't need send-time parameters.
 *   - COPY_CODE buttons need the actual code to display. We fall
 *     back to the template's `example` value if the caller doesn't
 *     override — that matches the most common use case (a static
 *     promo code) without forcing UI work.
 *
 * Validation throws here (not at the Meta API boundary) so a missing
 * sample surfaces as "Header text variable {{1}} requires a value",
 * not a 400 from Meta that doesn't say which field broke.
 */

import type { MessageTemplate, TemplateButton } from '@/types';
import { extractVariableIndices, extractVariableTokens } from './template-validators';

export interface SendTimeParams {
  /** Values for body {{1}}, {{2}}, … indexed by variable position. */
  body?: string[];
  /** Value for TEXT-header {{1}}, when the header has a variable. */
  headerText?: string;
  /** Override the template's static media URL for this send. */
  headerMediaUrl?: string;
  /** Alternative: send the media by Meta media id (from prior upload). */
  headerMediaId?: string;
  /**
   * Per-button overrides keyed by the button's index in the
   * template's `buttons` array. Used for URL buttons with a {{1}}
   * suffix and for COPY_CODE buttons whose example you want to
   * override at send time.
   */
  buttonParams?: Record<number, string>;
}

export type MetaSendComponent =
  | { type: 'header'; parameters: MetaSendParameter[] }
  | { type: 'body'; parameters: MetaSendParameter[] }
  | {
      type: 'button';
      sub_type: 'url' | 'quick_reply' | 'copy_code';
      index: string;
      parameters: MetaSendParameter[];
    };

type MetaSendParameter =
  | { type: 'text'; text: string; parameter_name?: string }
  | { type: 'image'; image: { link?: string; id?: string } }
  | { type: 'video'; video: { link?: string; id?: string } }
  | { type: 'document'; document: { link?: string; id?: string } }
  | { type: 'coupon_code'; coupon_code: string }
  | { type: 'payload'; payload: string };

function buildHeaderComponent(
  template: MessageTemplate,
  params: SendTimeParams,
): MetaSendComponent | null {
  const headerType = template.header_type;
  if (!headerType) return null;

  if (headerType === 'text') {
    const varCount = extractVariableIndices(template.header_content ?? '').length;
    if (varCount === 0) return null;
    const rawHeader = template.sample_values?.header;
    const sampleStr = typeof rawHeader === 'string' ? rawHeader : Array.isArray(rawHeader) ? rawHeader[0] : undefined;
    const value = (params.headerText && params.headerText.trim()) || (sampleStr && sampleStr.trim()) || 'Notice';
    return {
      type: 'header',
      parameters: [{ type: 'text', text: value }],
    };
  }

  const link =
    params.headerMediaUrl ??
    template.header_media_url ??
    (typeof template.sample_values?.header === 'string'
      ? template.sample_values.header
      : undefined);
  const id = params.headerMediaId;
  if (!link && !id) {
    throw new Error(
      `${headerType} header requires a media link or id at send time — set header_media_url on the template or pass headerMediaUrl/headerMediaId.`,
    );
  }
  const mediaPayload: { link?: string; id?: string } = id ? { id } : { link };
  return {
    type: 'header',
    parameters: [
      headerType === 'image'
        ? { type: 'image', image: mediaPayload }
        : headerType === 'video'
          ? { type: 'video', video: mediaPayload }
          : { type: 'document', document: mediaPayload },
    ],
  };
}

function buildBodyComponent(
  template: MessageTemplate,
  params: SendTimeParams,
): MetaSendComponent | null {
  const tokens = extractVariableTokens(template.body_text);
  const varCount = tokens.length;
  const body = params.body ?? [];
  if (varCount === 0 && body.length === 0) return null;

  let values: string[] = [];
  if (varCount > 0) {
    const sampleBody = template.sample_values?.body;
    for (let i = 0; i < varCount; i++) {
      const userVal = body[i];
      const sampleVal = Array.isArray(sampleBody)
        ? sampleBody[i]
        : typeof sampleBody === 'string'
          ? sampleBody
          : undefined;
      const finalVal =
        (userVal != null && String(userVal).trim() !== '' ? String(userVal).trim() : null) ??
        (sampleVal != null && String(sampleVal).trim() !== '' ? String(sampleVal).trim() : null) ??
        'Customer';
      values.push(finalVal);
    }
  } else {
    values = body;
  }

  if (values.length === 0) return null;

  return {
    type: 'body',
    parameters: values.map((text, i) => {
      const token = tokens[i];
      if (token?.name) {
        return { type: 'text' as const, parameter_name: token.name, text: String(text) };
      }
      return { type: 'text' as const, text: String(text) };
    }),
  };
}


function buttonNeedsSendParam(
  button: TemplateButton,
  override: string | undefined,
): boolean {
  switch (button.type) {
    case 'URL':
      return extractVariableIndices(button.url).length > 0;
    case 'COPY_CODE':
      // We always emit a button param for COPY_CODE so the customer
      // gets a real code (either the caller's override or the
      // template's example as a default).
      return true;
    case 'QUICK_REPLY':
    case 'PHONE_NUMBER':
      return override !== undefined;
    default:
      return false;
  }
}

function buildButtonComponent(
  button: TemplateButton,
  index: number,
  override: string | undefined,
): MetaSendComponent | null {
  if (!buttonNeedsSendParam(button, override)) return null;

  switch (button.type) {
    case 'URL': {
      const val = (override && override.trim()) || 'info';
      return {
        type: 'button',
        sub_type: 'url',
        index: String(index),
        parameters: [{ type: 'text', text: val }],
      };
    }
    case 'COPY_CODE': {
      const code = override?.trim() || button.example;
      return {
        type: 'button',
        sub_type: 'copy_code',
        index: String(index),
        parameters: [{ type: 'coupon_code', coupon_code: code }],
      };
    }
    case 'QUICK_REPLY': {
      // Only included when the caller explicitly overrides the
      // payload (rare — usually QR buttons use their default text).
      return {
        type: 'button',
        sub_type: 'quick_reply',
        index: String(index),
        parameters: [{ type: 'payload', payload: override! }],
      };
    }
    case 'PHONE_NUMBER':
    default:
      // PHONE_NUMBER and other static buttons never accept send-time params per Meta —
      // return null even if an override snuck through.
      return null;
  }
}

/**
 * Build the full `components` array for the send-message payload.
 * Returns an empty array when the template is fully static (no
 * variables, no media header), which is a valid Meta request.
 */
export function buildSendComponents(
  template: MessageTemplate,
  params: SendTimeParams = {},
): MetaSendComponent[] {
  const out: MetaSendComponent[] = [];
  const header = buildHeaderComponent(template, params);
  if (header) out.push(header);
  const body = buildBodyComponent(template, params);
  if (body) out.push(body);
  if (template.buttons?.length) {
    template.buttons.forEach((btn, i) => {
      const override = params.buttonParams?.[i];
      const component = buildButtonComponent(btn, i, override);
      if (component) out.push(component);
    });
  }
  return out;
}

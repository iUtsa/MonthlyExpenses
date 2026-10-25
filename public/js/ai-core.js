// Document understanding with Claude, shared by the Node server and the browser-only build:
// receipts -> categorized line items, work schedules -> shifts, pay stubs -> earnings/tax breakdown.
// Every call returns JSON constrained by a schema (structured outputs).

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_EFFORT = 'medium';

export class AIError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// { mimeType, base64, name } -> Claude content block
export function fileBlock({ mimeType, base64, name }) {
  if (mimeType === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
  if (!IMAGE_TYPES.has(mimeType)) throw new AIError(`Unsupported file type ${mimeType} (${name || 'file'}). Use JPG, PNG, WEBP or PDF.`, 415);
  return { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } };
}

// `Anthropic` is the SDK class (for its typed errors); `client` an instance of it.
export async function extract({ Anthropic, client, model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, system, content, schema }) {
  const params = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content }],
    thinking: { type: 'adaptive' },
    output_config: { effort, format: { type: 'json_schema', schema } },
  };

  let response;
  try {
    try {
      // Server-side fallback re-runs a safety-declined request on another model.
      response = await client.beta.messages.create({
        ...params,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (err) {
      // Some accounts/models reject the fallback beta; retry once without it.
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
      response = await client.messages.create(params);
    }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AIError('Anthropic API key was rejected. Check your key.', 401);
    if (err instanceof Anthropic.RateLimitError) throw new AIError('Rate limited by the Anthropic API. Try again in a minute.', 429);
    if (err instanceof Anthropic.BadRequestError) throw new AIError(`The AI request was rejected: ${err.message}`, 400);
    if (err instanceof Anthropic.APIConnectionError) throw new AIError('Could not reach the Anthropic API. Check your connection.', 503);
    if (err instanceof Anthropic.APIError) throw new AIError(`Anthropic API error ${err.status ?? ''}: ${err.message}`, 502);
    throw err;
  }

  if (response.stop_reason === 'refusal') throw new AIError('The model declined to read this document.', 422);
  if (response.stop_reason === 'max_tokens') throw new AIError('The document was too long to finish parsing. Try fewer pages.', 422);
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new AIError('The model returned an unreadable result. Try again.', 502);
  }
}

/* ---------- NVIDIA (build.nvidia.com, OpenAI-compatible chat completions) ---------- */
export const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
// Tried in order: on errors or a busy model the next one is used. Both read receipts
// accurately in testing; Nemotron VL is the stronger model, Llama 11B the faster one.
export const NVIDIA_MODELS = ['nvidia/nemotron-3.5-super-vl-120b-a12b', 'meta/llama-3.2-11b-vision-instruct'];

// Coerce a model reply into the exact shape of `schema` (these models don't enforce schemas).
export function conform(schema, value) {
  if (schema.type === 'object') {
    const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(Object.entries(schema.properties).map(([k, s]) => [k, conform(s, src[k])]));
  }
  if (schema.type === 'array') return Array.isArray(value) ? value.map((v) => conform(schema.items, v)) : [];
  if (schema.type === 'number') {
    const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  const s = value == null ? '' : String(value);
  return schema.enum && !schema.enum.includes(s) ? '' : s;
}

// Pull the JSON object out of a reply that may include reasoning, <think> blocks or ``` fences.
export function parseJsonReply(text) {
  const cleaned = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AIError('The model did not return any data. Try again or use a clearer photo.', 502);
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new AIError('The model returned an unreadable result. Try again.', 502);
  }
}

export async function extractNvidia({ apiKey, models = NVIDIA_MODELS, system, content, schema }) {
  const images = content.filter((b) => b.type !== 'text');
  if (images.some((b) => b.type !== 'image')) throw new AIError('NVIDIA models read images only — PDFs are converted to images before upload.', 415);
  if (images.length > 1) throw new AIError('NVIDIA vision models take one image per request — pages are stitched before upload.', 415);
  const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');
  const messages = [
    { role: 'system', content: `${system} Reply with a single JSON object only — no markdown, no explanation.` },
    {
      role: 'user',
      content: [
        { type: 'text', text: `${text}\n\nReturn JSON matching this JSON Schema exactly (every property required):\n${JSON.stringify(schema)}` },
        ...images.map((b) => ({ type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } })),
      ],
    },
  ];

  let lastError = null;
  for (const model of models) {
    let res;
    try {
      res = await fetch(NVIDIA_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: 8192, temperature: 0.1 }),
        signal: AbortSignal.timeout(240000),
      });
    } catch (err) {
      lastError = new AIError(err.name === 'TimeoutError' ? 'The NVIDIA model took too long to answer.' : 'Could not reach the NVIDIA API. Check your connection.', 503);
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) throw new AIError('NVIDIA API key was rejected. Check NVIDIA_API_KEY.', 401);
    if (!res.ok) {
      lastError = new AIError(`NVIDIA API error ${res.status} (${model}): ${data.detail || data.message || data.error?.message || 'request failed'}`, res.status === 429 ? 429 : 502);
      continue; // busy or failing model: try the next one
    }
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') throw new AIError('The document was too long to finish parsing. Try a closer photo.', 422);
    return conform(schema, parseJsonReply(choice?.message?.content));
  }
  throw lastError || new AIError('No NVIDIA model was available.', 502);
}

const str = { type: 'string' };
const num = { type: 'number' };
const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

// Each builder returns { system, content, schema } for extract(); `blocks` are fileBlock() results.
export function receiptRequest({ blocks, categories, today }) {
  const schema = obj({
    merchant: str,
    date: { ...str, description: 'YYYY-MM-DD, or empty string if not printed' },
    payment_method: str,
    currency: str,
    items: {
      type: 'array',
      items: obj({
        description: str,
        quantity: num,
        amount: { ...num, description: 'Line total after item-level discounts; negative for refunds/coupons' },
        category_id: { type: 'string', enum: categories.map((c) => c.id) },
      }),
    },
    subtotal: num,
    tax: num,
    tip: num,
    fees: num,
    discount: { ...num, description: 'Receipt-level discount as a positive number, 0 if none' },
    total: num,
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    notes: str,
  });
  const categoryList = categories.map((c) => `- ${c.id}: ${c.name} (${c.type})`).join('\n');
  return {
    system: 'You read shopping receipts and convert them into budget line items. Report amounts exactly as printed. Never invent items that are not on the receipt.',
    content: [
      ...blocks,
      {
        type: 'text',
        text: `Extract this receipt (all images are pages of the same receipt). Today is ${today}.

Assign every line item to the single best budget category from this list:
${categoryList}

Guidance:
- Grocery food and household consumables -> groceries, even at Walmart/Target/Costco; clothing, electronics, cosmetics there -> shopping.
- Prepared food, restaurants, coffee shops -> dining. Fuel -> transportation. Pharmacy prescriptions -> health.
- Put tax, tip, fees and receipt-level discounts in their own fields, not as items.
- Use 0 for any amount that is not printed, and an empty string for unknown text fields.
- In notes, mention anything unclear (blurry totals, items you could not read).`,
      },
    ],
    schema,
  };
}

export function scheduleRequest({ blocks, person, today }) {
  const schema = obj({
    employer: str,
    person_name: str,
    period_start: { ...str, description: 'YYYY-MM-DD or empty' },
    period_end: { ...str, description: 'YYYY-MM-DD or empty' },
    hourly_rate: { ...num, description: '0 if no pay rate is shown' },
    shifts: {
      type: 'array',
      items: obj({
        date: { ...str, description: 'YYYY-MM-DD' },
        start: { ...str, description: '24-hour HH:MM' },
        end: { ...str, description: '24-hour HH:MM; may be earlier than start for overnight shifts' },
        break_minutes: num,
        role: str,
        location: str,
        notes: str,
      }),
    },
    notes: str,
  });
  return {
    system: 'You read work schedules (rosters, scheduling-app screenshots, calendars, PDFs) and list the work shifts they contain. Only report shifts that are actually shown.',
    content: [
      ...blocks,
      {
        type: 'text',
        text: `List every work shift in this schedule. Today is ${today}; when the year is not printed, pick the year that puts the dates closest to today.
${person ? `If the schedule shows several people, only include shifts for "${person}" (match first names or initials loosely).` : 'If the schedule shows several people, include only the shifts that appear to belong to the schedule owner and explain your choice in notes.'}
Convert times to 24-hour HH:MM. Skip days off, PTO, or "available" blocks unless they are paid shifts. Use 0 for unpaid break minutes that are not shown.`,
      },
    ],
    schema,
  };
}

export function paystubRequest({ blocks, today }) {
  const schema = obj({
    employer: str,
    pay_date: { ...str, description: 'YYYY-MM-DD' },
    period_start: str,
    period_end: str,
    hours_regular: num,
    hours_overtime: num,
    hourly_rate: num,
    gross_pay: num,
    tips: num,
    federal_income_tax: num,
    state_income_tax: num,
    local_tax: num,
    social_security: num,
    medicare: num,
    pre_tax_deductions: { type: 'array', items: obj({ name: str, amount: num }) },
    post_tax_deductions: { type: 'array', items: obj({ name: str, amount: num }) },
    net_pay: num,
    ytd_gross: num,
    notes: str,
  });
  return {
    system: 'You read pay stubs and earnings statements and extract the current-period figures exactly as printed.',
    content: [
      ...blocks,
      {
        type: 'text',
        text: `Extract this pay stub. Today is ${today}. Use current-period amounts (not year-to-date) for every field except ytd_gross. Taxes and deductions are positive numbers. Pre-tax deductions include 401(k)/403(b), HSA/FSA, and pre-tax health premiums; post-tax include Roth contributions, garnishments, union dues. Use 0 for anything not shown.`,
      },
    ],
    schema,
  };
}

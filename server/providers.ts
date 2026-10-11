/** AI providers for the part lookup. Each returns the raw `submit_part_spec` input; index.ts validates it with parseSpec.
 * To add another provider, implement Provider and register it in makeProvider. It must be able to search the web,
 * or the results will not be accurate. */
import { PART_SPEC_SCHEMA, schemaForLookup, SYSTEM_PROMPT, lookupPrompt, templateGuide, type LookupRequest, type PartSpec } from '../src/ai-parts/spec.ts';
import { PARTS, templateEnvelope, type TemplateId } from '../rack-generator/floor-parts/templates.ts';
import type { Env } from './env.ts';

export interface Provider { name: string; model: string; lookup(req: LookupRequest): Promise<{ spec: unknown; searches: number }> }
export class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
/** A good balance of research quality and cost; override with AI_MODEL (e.g. claude-opus-5-5 for the hardest products). */
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const API = 'https://api.anthropic.com/v1/messages';

type Block = { type: string; name?: string; input?: unknown; text?: string; [key: string]: unknown };
type Message = { role: 'user' | 'assistant'; content: string | Block[] };

/** Web searches allowed per lookup (each one costs money); override with AI_MAX_SEARCHES. */
export const DEFAULT_MAX_SEARCHES = 4;
const SUBMIT_DESCRIPTION = 'Submit the identified product, its published measurements with sources, and the filled template. Call exactly once, at the end of your research.';
const NUDGE = 'Now call submit_part_spec with what you found. If you could not identify the product or find its measurements, call it with status "not_found" (or "partial") and list the measurements the user should take in questions.';

export function anthropicProvider(apiKey: string, model = DEFAULT_MODEL, fetchImpl: typeof fetch = fetch, maxSearches = DEFAULT_MAX_SEARCHES): Provider {
  const system = [{ type: 'text', text: SYSTEM_PROMPT + templateGuide(), cache_control: { type: 'ephemeral' } }];
  const tools = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches },
    { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 6, max_content_tokens: 30000 },
    { name: 'submit_part_spec', description: SUBMIT_DESCRIPTION, input_schema: PART_SPEC_SCHEMA, strict: true },
  ];
  return {
    name: 'anthropic', model,
    async lookup(req) {
      const content: Block[] = [];
      if (req.image) content.push({ type: 'image', source: { type: 'base64', media_type: req.image.media_type, data: req.image.data } });
      content.push({ type: 'text', text: lookupPrompt(req) });
      const messages: Message[] = [{ role: 'user', content }];
      let searches = 0;
      for (let turn = 0; turn < 10; turn++) {
        const res = await fetchImpl(API, {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 8192, system, tools:tools.map(tool => tool.name === 'submit_part_spec' ? {...tool,input_schema:schemaForLookup(req)} : tool), messages }),
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => null) as { error?: { message?: string } } | null, text = detail?.error?.message ?? res.statusText;
          if (res.status === 401 || res.status === 403) throw new HttpError(502, 'The AI provider rejected the API key. Check ANTHROPIC_API_KEY.');
          if (res.status === 429 || res.status === 529) throw new HttpError(503, 'The AI provider is busy. Try again in a minute.');
          throw new HttpError(502, `The AI provider returned an error: ${text}`);
        }
        const msg = await res.json() as { content?: Block[]; stop_reason?: string; usage?: { server_tool_use?: { web_search_requests?: number } } };
        searches += msg.usage?.server_tool_use?.web_search_requests ?? 0;
        const blocks = msg.content ?? [], call = blocks.find(b => b.type === 'tool_use' && b.name === 'submit_part_spec');
        if (call) return { spec: call.input, searches };
        if (msg.stop_reason === 'refusal') throw new HttpError(422, 'The AI declined to research this request.');
        // A paused or unfinished turn continues the same assistant message; anything else gets a nudge to submit.
        const last = messages.at(-1)!;
        if (last.role === 'assistant' && Array.isArray(last.content)) last.content.push(...blocks);
        else messages.push({ role: 'assistant', content: blocks });
        if (msg.stop_reason !== 'pause_turn') messages.push({ role: 'user', content: NUDGE });
      }
      throw new HttpError(504, 'The AI did not finish its research. Try a more specific product name.');
    },
  };
}

// ── OpenRouter ────────────────────────────────────────────────────────────────────────────────────
/** The cheapest model that reads photos, searches the web and fills the template reliably. Override with AI_MODEL. */
export const OPENROUTER_DEFAULT_MODEL = 'anthropic/claude-haiku-5.5';
/** OpenRouter's search engine: "parallel" (cheapest), "exa", "native" (the model provider's own search) or "auto". */
export const OPENROUTER_DEFAULT_ENGINE = 'parallel';
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: unknown; tool_calls?: unknown; tool_call_id?: string };

/** Any OpenRouter model with tool calling (and image input, for photos), using OpenRouter's web search and fetch tools. */
export function openrouterProvider(apiKey: string, model = OPENROUTER_DEFAULT_MODEL, options: { engine?: string; maxSearches?: number } = {}, fetchImpl: typeof fetch = fetch): Provider {
  const engine = options.engine || OPENROUTER_DEFAULT_ENGINE, maxSearches = options.maxSearches ?? DEFAULT_MAX_SEARCHES;
  const tools = [
    { type: 'openrouter:web_search', parameters: { engine, max_uses: maxSearches, max_results: 5, max_total_results: maxSearches * 5 } },
    { type: 'openrouter:web_fetch', parameters: { max_uses: 4, max_content_tokens: 20000 } },
    { type: 'function', function: { name: 'submit_part_spec', description: SUBMIT_DESCRIPTION, parameters: PART_SPEC_SCHEMA, strict: true } },
  ];
  return {
    name: 'openrouter', model,
    async lookup(req) {
      const user: unknown[] = [{ type: 'text', text: lookupPrompt(req) }];
      if (req.image) user.push({ type: 'image_url', image_url: { url: `data:${req.image.media_type};base64,${req.image.data}` } });
      const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT + templateGuide() }, { role: 'user', content: user }];
      let searches = 0;
      for (let turn = 0; turn < 6; turn++) {
        const res = await fetchImpl(OPENROUTER_API, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'x-title': 'Gym Builder part lookup' },
          body: JSON.stringify({ model, messages, tools:tools.map(tool => tool.type === 'function' ? {...tool,function:{...tool.function,parameters:schemaForLookup(req)}} : tool), tool_choice: 'auto', max_tokens: 8192 }),
        });
        const data = await res.json().catch(() => null) as {
          error?: { message?: string; code?: number };
          choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: { id: string; function?: { name?: string; arguments?: string } }[] } }[];
          usage?: { server_tool_use?: { web_search_requests?: number } };
        } | null;
        if (!res.ok || !data || data.error) {
          const status = res.ok ? data?.error?.code ?? 502 : res.status, text = data?.error?.message ?? res.statusText;
          if (status === 401 || status === 403) throw new HttpError(502, 'OpenRouter rejected the API key. Check OPENROUTER_API_KEY.');
          if (status === 402) throw new HttpError(503, 'Your OpenRouter account is out of credits. Add credits at openrouter.ai.');
          if (status === 429 || status === 503) throw new HttpError(503, 'The AI provider is busy. Try again in a minute.');
          throw new HttpError(502, `OpenRouter returned an error: ${text}`);
        }
        searches += data.usage?.server_tool_use?.web_search_requests ?? 0;
        const message = data.choices?.[0]?.message ?? {}, call = message.tool_calls?.find(c => c.function?.name === 'submit_part_spec');
        if (call) {
          try { return { spec: JSON.parse(call.function?.arguments || '{}'), searches }; }
          catch {
            messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls });
            messages.push({ role: 'tool', tool_call_id: call.id, content: 'That was not valid JSON. Call submit_part_spec again with valid JSON matching the schema.' });
            continue;
          }
        }
        messages.push({ role: 'assistant', content: message.content ?? '' }, { role: 'user', content: NUDGE });
      }
      throw new HttpError(504, 'The AI did not finish its research. Try a more specific product name.');
    },
  };
}

/** Offline provider for trying the flow without an API key. Its numbers are examples, clearly labelled as such. */
export function mockProvider(): Provider {
  const pickTemplate = (text: string): { template: TemplateId; params: Record<string, number>; category: string } => {
    const t = text.toLowerCase();
    if (/\bbed\b|headboard|mattress/.test(t)) return { template: 'template-bed', category: 'bed', params: { length: 2100, width: 1700, height: 1000, frameHeight: 300, mattressThickness: 200, boardThickness: 30, legHeight: 80, pillows: 1, frameColor: 2, padColor: 2 } };
    if (/bench/.test(t)) return { template: 'template-bench', category: 'bench', params: { kind: /adjust|incline|fid/.test(t) ? 1 : 0, length: 1370, width: 660, padLength: 1270, padWidth: 290, padHeight: 445, padThickness: 75, seatLength: 380, incline: 0, tube: 76 } };
    if (/tread/.test(t)) return { template: 'template-cardio', category: 'treadmill', params: { kind: 0, length: 2000, width: 900, height: 1500 } };
    if (/bike/.test(t)) return { template: 'template-cardio', category: 'bike', params: { kind: 1, length: 1320, width: 660, height: 1270 } };
    if (/row/.test(t)) return { template: 'template-cardio', category: 'rower', params: { kind: 2, length: 2440, width: 610, height: 1000 } };
    if (/rack|shelf|storage/.test(t)) return { template: 'template-storage', category: 'storage', params: { width: 1520, depth: 610, height: 840, tiers: 2, shelf: 1, tube: 50 } };
    if (/plate|ball|disc|tyre|tire/.test(t)) return { template: 'template-disc', category: 'plate', params: { shape: 0, diameter: 450, thickness: 65, hole: 51 } };
    if (/machine|cable|tower|press|leg|lat/.test(t)) return { template: 'template-machine', category: 'machine', params: { width: 1500, depth: 1200, height: 2100, tube: 75, posts: 0, stacks: 1, seat: 1, seatHeight: 480 } };
    return { template: 'template-block', category: 'equipment', params: { width: 600, depth: 500, height: 450, radius: 10 } };
  };
  return {
    name: 'mock', model: 'mock',
    async lookup(req) {
      const name = (req.query || req.url || 'Photographed product').slice(0, 120), { template, params, category } = pickTemplate(`${req.query ?? ''} ${req.url ?? ''}`);
      const part = PARTS.find(p => p.id === template)!, full = { ...part.defaults, ...params }, [length_mm, width_mm, height_mm] = templateEnvelope(template, full);
      const spec: PartSpec = {
        status: 'partial', brand: 'Example brand', model: name, category, product_url: req.url ?? '', template,
        params: Object.entries(params).map(([key, value]) => ({ key, value, basis: 'estimated', source_url: '', note: 'Mock value' })),
        overall: { length_mm, width_mm, height_mm, basis: 'estimated', source_url: '' },
        sources: [],
        notes: 'Local demo: these measurements are examples, not product research or photo recognition. Measure your equipment and correct the values before using the design.',
        questions: req.image ? ['Measure the overall height so the photo can be scaled.'] : [],
      };
      return { spec, searches: 0 };
    },
  };
}

export function providerName(env: Env) { return env.AI_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : env.OPENROUTER_API_KEY ? 'openrouter' : 'unconfigured'); }
const maxSearches = (env: Env) => { const n = Number(env.AI_MAX_SEARCHES); return Number.isInteger(n) && n >= 1 && n <= 20 ? n : DEFAULT_MAX_SEARCHES; };
export function makeProvider(env: Env, fetchImpl?: typeof fetch): Provider {
  const name = providerName(env);
  if (name === 'mock') return mockProvider();
  if (name === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'The AI lookup is not configured: set the ANTHROPIC_API_KEY secret.');
    return anthropicProvider(env.ANTHROPIC_API_KEY, env.AI_MODEL || DEFAULT_MODEL, fetchImpl, maxSearches(env));
  }
  if (name === 'openrouter') {
    if (!env.OPENROUTER_API_KEY) throw new HttpError(503, 'The AI lookup is not configured: set the OPENROUTER_API_KEY secret.');
    return openrouterProvider(env.OPENROUTER_API_KEY, env.AI_MODEL || OPENROUTER_DEFAULT_MODEL, { engine: env.AI_SEARCH_ENGINE, maxSearches: maxSearches(env) }, fetchImpl);
  }
  throw new HttpError(503, name === 'unconfigured' ? 'The AI lookup is not configured: set OPENROUTER_API_KEY or ANTHROPIC_API_KEY, or AI_PROVIDER=mock to try it.' : `Unknown AI_PROVIDER "${name}".`);
}

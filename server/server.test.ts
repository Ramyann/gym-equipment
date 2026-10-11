import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './index.ts';
import { anthropicProvider, makeProvider, openrouterProvider } from './providers.ts';
import { parseSpec, reviewSpec } from '../src/ai-parts/spec.ts';
import type { Env, KV } from './env.ts';

const memoryKV = (): KV => { const m = new Map<string, string>(); return { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };
const env = (over: Partial<Env> = {}): Env => ({
  ASSETS: { fetch: async () => new Response('<html>site</html>') }, AI_PROVIDER: 'mock', DAILY_LIMIT: '2', PARTS_KV: memoryKV(), ...over,
});
const call = (e: Env, path: string, init: RequestInit = {}) => handle(new Request(`https://gym.test${path}`, { ...init, headers: { 'content-type': 'application/json' } }), e);
const lookup = (e: Env, body: unknown) => call(e, '/api/parts/lookup', { method: 'POST', body: JSON.stringify(body) });

test('non-API paths are served by the static site; health reports the AI, catalog requests and today\'s count', async () => {
  const e = env();
  assert.equal(await (await call(e, '/builder')).text(), '<html>site</html>');
  assert.deepEqual(await (await call(e, '/api/health')).json(), { ok: true, provider: 'mock', catalogRequests: false, used: 0, limit: 2 });
  assert.equal((await (await call(env({ GITHUB_TOKEN: 't', GITHUB_REPO: 'me/repo' }), '/api/health')).json()).catalogRequests, true);
  assert.equal((await call(e, '/api/me')).status, 404, 'no accounts or access keys');
});

test('a lookup needs no key, returns a checked spec, is cached, and stops at the shared daily limit', async () => {
  const e = env();
  const res = await lookup(e, { query: 'Example adjustable bench' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.provider, 'mock');
  const spec = parseSpec(body.spec);
  assert.equal(spec.template, 'template-bench');
  assert.equal(reviewSpec(spec).error, null);
  assert.ok(reviewSpec(spec).checks.every(c => c.ok), 'mock overall size matches its own template');
  // Same query: served from the cache, not counted again.
  assert.equal((await (await lookup(e, { query: 'Example adjustable bench' })).json()).cached, true);
  assert.equal((await (await call(e, '/api/health')).json()).used, 1);
  assert.equal((await lookup(e, { query: 'Treadmill T1' })).status, 200);
  const blocked = await lookup(e, { query: 'Rower R2' });
  assert.equal(blocked.status, 429);
  assert.match((await blocked.json()).error, /used up \(2 per day\)/);
  assert.equal((await (await lookup(e, { query: 'Example adjustable bench' })).json()).cached, true, 'cached answers still work at the limit');
});

test('lookup input is validated', async () => {
  const e = env();
  for (const [body, message] of [
    [{}, /name, a link or a photo/], [{ query: 'x'.repeat(301) }, /300/], [{ url: 'ftp://files' }, /http/],
    [{ image: { media_type: 'image/tiff', data: 'AAAA' } }, /JPEG/], [{ image: { media_type: 'image/jpeg', data: 'not base64!' } }, /base64/],
  ] as const) {
    const res = await lookup(e, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match((await res.json()).error, message);
  }
  const res = await call(e, '/api/parts/lookup', { method: 'POST', body: '{bad' });
  assert.equal(res.status, 400);
});

test('an unconfigured server explains what to set', async () => {
  const res = await lookup(env({ AI_PROVIDER: undefined }), { query: 'bench' });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /ANTHROPIC_API_KEY/);
  assert.equal(makeProvider(env({ AI_PROVIDER: undefined, ANTHROPIC_API_KEY: 'sk-test', AI_MODEL: 'claude-opus-5-5' })).model, 'claude-opus-5-5');
});

test('the Claude provider researches with web tools, continues paused turns, nudges, and returns the tool input', async () => {
  const bodies: Record<string, unknown>[] = [];
  const spec = { template: 'template-block', status: 'found', brand: 'B', model: 'M', category: 'box', product_url: '', params: [], overall: { length_mm: 600, width_mm: 600, height_mm: 500, basis: 'published', source_url: '' }, sources: [], notes: '', questions: [] };
  const replies = [
    { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', name: 'web_search', id: 's1', input: { query: 'M specs' } }], usage: { server_tool_use: { web_search_requests: 2 } } },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I found the specs.' }], usage: { server_tool_use: { web_search_requests: 1 } } },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_part_spec', id: 't1', input: spec }], usage: {} },
  ];
  const fake = (async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify(replies.shift())); }) as unknown as typeof fetch;
  const result = await anthropicProvider('sk-test', 'claude-sonnet-5-5', fake).lookup({ query: 'M', image: { media_type: 'image/jpeg', data: 'AAAA' } });
  assert.deepEqual(result, { spec, searches: 3 });
  const first = bodies[0] as { system: { cache_control: unknown }[]; tools: { name: string; strict?: boolean; type?: string }[]; messages: { content: { type: string }[] }[] };
  assert.deepEqual(first.tools.map(t => t.name), ['web_search', 'web_fetch', 'submit_part_spec']);
  assert.equal(first.tools[2].strict, true);
  assert.deepEqual(first.system[0].cache_control, { type: 'ephemeral' });
  assert.deepEqual(first.messages[0].content.map(c => c.type), ['image', 'text']);
  const second = bodies[1] as { messages: { role: string }[] }, third = bodies[2] as { messages: { role: string; content: unknown }[] };
  assert.deepEqual(second.messages.map(m => m.role), ['user', 'assistant'], 'a paused turn is resent to continue');
  assert.deepEqual(third.messages.map(m => m.role), ['user', 'assistant', 'user'], 'the finished turn is merged, then nudged');
  assert.match(String(third.messages[2].content), /submit_part_spec/);
});

test('provider errors become readable messages', async () => {
  const status = (code: number) => (async () => new Response(JSON.stringify({ error: { message: 'nope' } }), { status: code })) as unknown as typeof fetch;
  await assert.rejects(anthropicProvider('bad', undefined, status(401)).lookup({ query: 'x' }), /rejected the API key/);
  await assert.rejects(anthropicProvider('k', undefined, status(529)).lookup({ query: 'x' }), /busy/);
  await assert.rejects(anthropicProvider('k', undefined, status(400)).lookup({ query: 'x' }), /error: nope/);
});

test('OpenRouter: Haiku 5.5 by default, cheap web search, photo as a data URL, nudges until the spec is submitted', async () => {
  const bodies: Record<string, unknown>[] = [];
  const spec = { template: 'template-block', status: 'found', brand: 'B', model: 'M', category: 'box', product_url: '', params: [], overall: { length_mm: 600, width_mm: 600, height_mm: 500, basis: 'published', source_url: '' }, sources: [], notes: '', questions: [] };
  const replies = [
    { choices: [{ finish_reason: 'stop', message: { content: 'I found the spec sheet.' } }], usage: { server_tool_use: { web_search_requests: 3 } } },
    { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'submit_part_spec', arguments: JSON.stringify(spec) } }] } }], usage: { server_tool_use: { web_search_requests: 1 } } },
  ];
  const fake = (async (url: string, init: RequestInit) => { assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions'); bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify(replies.shift())); }) as unknown as typeof fetch;
  const provider = makeProvider(env({ AI_PROVIDER: undefined, OPENROUTER_API_KEY: 'sk-or-test' }), fake);
  assert.deepEqual([provider.name, provider.model], ['openrouter', 'anthropic/claude-haiku-5.5']);
  const result = await provider.lookup({ query: 'M', image: { media_type: 'image/jpeg', data: 'AAAA' } });
  assert.deepEqual(result, { spec, searches: 4 });
  const first = bodies[0] as { model: string; tools: { type: string; parameters?: Record<string, unknown>; function?: { name: string; strict: boolean } }[]; messages: { role: string; content: { type: string; image_url?: { url: string } }[] }[] };
  assert.equal(first.model, 'anthropic/claude-haiku-5.5');
  assert.deepEqual(first.tools.map(t => t.type), ['openrouter:web_search', 'openrouter:web_fetch', 'function']);
  assert.deepEqual([first.tools[0].parameters!.engine, first.tools[0].parameters!.max_uses], ['parallel', 4]);
  assert.deepEqual([first.tools[2].function!.name, first.tools[2].function!.strict], ['submit_part_spec', true]);
  assert.equal(first.messages[1].content[1].image_url!.url, 'data:image/jpeg;base64,AAAA');
  assert.deepEqual((bodies[1] as { messages: { role: string }[] }).messages.map(m => m.role), ['system', 'user', 'assistant', 'user'], 'nudged after a text-only answer');
});

test('OpenRouter settings and errors', async () => {
  assert.equal(makeProvider(env({ AI_PROVIDER: '', OPENROUTER_API_KEY: 'k', ANTHROPIC_API_KEY: undefined })).name, 'openrouter', 'blank provider in .env selects the configured key');
  const p = makeProvider(env({ AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k', AI_MODEL: 'google/gemini-3.5-flash', AI_SEARCH_ENGINE: 'native', AI_MAX_SEARCHES: '2' }));
  assert.equal(p.model, 'google/gemini-3.5-flash');
  const res = await lookup(env({ AI_PROVIDER: 'openrouter' }), { query: 'bench' });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /OPENROUTER_API_KEY/);
  const status = (code: number) => (async () => new Response(JSON.stringify({ error: { message: 'nope', code } }), { status: code })) as unknown as typeof fetch;
  await assert.rejects(openrouterProvider('bad', undefined, {}, status(401)).lookup({ query: 'x' }), /rejected the API key/);
  await assert.rejects(openrouterProvider('k', undefined, {}, status(402)).lookup({ query: 'x' }), /out of credits/);
  await assert.rejects(openrouterProvider('k', undefined, {}, status(400)).lookup({ query: 'x' }), /OpenRouter returned an error: nope/);
});

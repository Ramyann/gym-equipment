/** Cloudflare Worker bindings and the few platform types the server uses (kept local: no extra dependency). */
export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}
export interface AssetFetcher { fetch(request: Request): Promise<Response> }
export interface Env {
  /** Static site (dist/), bound in wrangler.jsonc. */
  ASSETS: AssetFetcher;
  /** "openrouter", "anthropic" or "mock". Defaults to whichever API key is set. */
  AI_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  /** Model id for the provider (e.g. anthropic/claude-haiku-5.5 on OpenRouter, claude-sonnet-5-5 on Anthropic). */
  AI_MODEL?: string;
  /** OpenRouter web search engine: parallel (default, cheapest), exa, native or auto. */
  AI_SEARCH_ENGINE?: string;
  /** Web searches allowed per lookup (default 4). */
  AI_MAX_SEARCHES?: string;
  /** AI lookups allowed per UTC day for the whole site (default 100); every lookup uses the owner's AI key. */
  DAILY_LIMIT?: string;
  /** Optional KV namespace for quotas and the lookup cache (falls back to memory, per Worker instance). */
  PARTS_KV?: KV;
  /** Catalog requests (step 2): a GitHub token that can create issues, and "owner/repo" to file them in. */
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
}

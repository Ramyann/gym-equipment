/** Fail with setting names, never secret values, before opening a production database. */
export function validateBackendSettings(env: Record<string, string | undefined>) {
  if (env.NODE_ENV && !['development','test','production'].includes(env.NODE_ENV)) throw Error('NODE_ENV must be development, test or production.');
  const production = env.NODE_ENV === 'production';
  for (const [name, minimum, maximum] of [['PORT',1,65535],['SMTP_PORT',1,65535],['TRUST_PROXY',0,10],['AI_USER_DAILY_LIMIT',1,100000],['DAILY_LIMIT',1,1000000],['AI_CONCURRENCY',1,64],['AI_MAX_SEARCHES',1,20]] as const) {
    if (env[name] && (!/^\d+$/.test(env[name]!) || Number(env[name]) < minimum || Number(env[name]) > maximum)) throw Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  for (const name of ['SMTP_SECURE','REQUIRE_EMAIL_VERIFICATION']) if (env[name] && !['true','false'].includes(env[name]!)) throw Error(`${name} must be true or false.`);
  let url: URL;
  try { url = new URL(env.SITE_URL || 'http://127.0.0.1:5173'); } catch { throw Error('SITE_URL must be the frontend website origin.'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('SITE_URL must be an HTTP(S) origin without a path or credentials.');
  if (env.DATABASE_URL) {
    try { if (!['postgres:','postgresql:'].includes(new URL(env.DATABASE_URL).protocol)) throw Error(); } catch { throw Error('DATABASE_URL must be a PostgreSQL connection string.'); }
  }
  if (env.AI_PROVIDER && !['anthropic','openrouter','mock'].includes(env.AI_PROVIDER)) throw Error('AI_PROVIDER must be anthropic, openrouter, mock or blank.');
  if (production && (!env.SITE_URL || url.protocol !== 'https:' || !env.DATABASE_URL)) throw Error('Production requires an HTTPS SITE_URL and PostgreSQL DATABASE_URL.');
  if (production && (!env.SMTP_HOST || !env.SMTP_FROM)) throw Error('Production requires SMTP_HOST and SMTP_FROM.');
  if (production && env.AI_PROVIDER === 'mock') throw Error('Demo AI must not be used in production.');
}

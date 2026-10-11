import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBackendSettings } from './backend-config.ts';
test('production settings fail early without exposing credentials, and valid local/production configurations pass', () => {
  assert.doesNotThrow(() => validateBackendSettings({}));
  assert.doesNotThrow(() => validateBackendSettings({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://user:secret@private/studio', SITE_URL: 'https://studio.example.com', SMTP_HOST: 'mail.example.com', SMTP_FROM: 'studio@example.com', PORT: '8788' }));
  assert.throws(() => validateBackendSettings({ NODE_ENV: 'production' }), /Production requires/);
  assert.throws(() => validateBackendSettings({ SITE_URL: 'https://user:secret@example.com/path' }), error => error instanceof Error && !error.message.includes('secret'));
  assert.throws(() => validateBackendSettings({ AI_CONCURRENCY: '-2' }), /AI_CONCURRENCY/);
  assert.throws(() => validateBackendSettings({ SMTP_SECURE: 'yes' }), /SMTP_SECURE/);
  assert.throws(() => validateBackendSettings({ AI_PROVIDER: 'unknown' }), /AI_PROVIDER/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter, isRedirect } from '@tanstack/react-router';
import { routeTree } from './routes.tsx';

const router = createRouter({ routeTree, history: createMemoryHistory() });
const leaf = (path: string) => router.matchRoutes(path).at(-1)!;
/** Runs the matched route's beforeLoad and returns where its redirect points (Node routers skip client navigation). */
const redirectOf = (path: string, search: Record<string, unknown> = {}) => {
  const route = (router.routesById as Record<string, { options: { beforeLoad?: unknown } }>)[leaf(path).routeId];
  try { (route.options.beforeLoad as (ctx: unknown) => void)?.({ search }); } catch (error) {
    assert.ok(isRedirect(error), path);
    return error.options;
  }
};

test('the dashboard is home and the builder has its own route', () => {
  assert.equal(leaf('/account').routeId, '/account');
  assert.equal(leaf('/').routeId, '/');
  assert.equal(redirectOf('/'), undefined);
  assert.equal(redirectOf('/builder'), undefined);
  assert.equal(leaf('/builder').routeId, '/builder');
  assert.equal(redirectOf('/builder.html')?.to, '/builder');
  assert.equal(redirectOf('/index.html')?.to, '/');
  assert.equal(redirectOf('/index.html',{gym:'test'})?.to, '/builder');
  assert.equal(redirectOf('/', {gym:'test'})?.to, '/builder');
  assert.deepEqual(redirectOf('/', {gym:'test',layout:'six'})?.search, {gym:'test',layout:'six'});
});

test('parts live at real /parts/<id> paths; a bare /parts goes to the library', () => {
  const part = leaf('/parts/j-hook-standard');
  assert.deepEqual([part.routeId, part.params.partId], ['/parts/$partId', 'j-hook-standard']);
  assert.equal(redirectOf('/parts/j-hook-standard'), undefined);
  assert.equal(leaf('/parts/not-a-part').params.partId, 'not-a-part');
  for (const path of ['/parts', '/parts/', '/parts.html']) assert.equal(redirectOf(path)?.to, '/library', path);
  assert.equal(leaf('/library').routeId, '/library');
});

test('the gym gallery lives at /gyms with a detail page per gym', () => {
  assert.equal(leaf('/gyms').routeId, '/gyms');
  const gym = leaf('/gyms/cable-compound');
  assert.deepEqual([gym.routeId, gym.params.slug], ['/gyms/$slug', 'cable-compound']);
});

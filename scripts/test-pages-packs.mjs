import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onRequest } from '../functions/_middleware.js';
import packs from '../functions/generated-apartment-packs.js';
import paths from '../functions/generated-apartment-redirects.js';

const codes = Object.keys(packs);
const assetFetcher = { fetch: async (url) => new Response(await readFile(`dist${new URL(url).pathname}`, 'utf8')) };
const makeContext = (path, method = 'GET', assets = assetFetcher) => ({
  request: new Request(`https://danjipyo.kr${path}`, { method }),
  env: { ASSETS: assets }, next: async () => new Response('static fallback', { status: 404 })
});
for (const code of [codes[0], codes.at(-1)].filter(Boolean)) {
  const expected = JSON.parse(await readFile(`dist/report-packs/${packs[code]}.json`, 'utf8'))[code];
  const response = await onRequest(makeContext(paths[code]));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await response.text(), expected);
  const head = await onRequest(makeContext(paths[code], 'HEAD'));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await onRequest(makeContext(paths[code].slice(0, -1)))).status, 308);
  assert.equal((await onRequest(makeContext(paths[code], 'GET', { fetch: async () => new Response('', { status: 404 }) }))).status, 503);
}
assert.equal((await onRequest(makeContext('/apartments/unknown-a00000000/'))).status, 404);
assert.equal((await onRequest(makeContext('/posts/deleted/'))).status, 410);
console.log(`Pages routing verified: ${codes.length} packed URLs, GET/HEAD/redirect/404/503/410.`);

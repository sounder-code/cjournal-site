import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const distDir = resolve(process.env.SEO_AUDIT_DIST || 'dist');
const siteOrigin = (process.env.PUBLIC_SITE_URL || 'https://danjipyo.kr').replace(/\/+$/, '');
const errors = [];
const sitemapUrls = new Map();
const visitedSitemaps = new Set();

const assert = (condition, message) => {
  if (!condition) errors.push(message);
};
const decodeXml = (value) => value
  .replaceAll('&amp;', '&')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', "'");
const normalizeVisibleText = (value) => decodeXml(value)
  .replaceAll('&nbsp;', ' ')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/\s+/g, ' ')
  .trim();
const localPath = (url, html = false) => {
  const pathname = decodeURIComponent(new URL(url, `${siteOrigin}/`).pathname);
  if (html && pathname.endsWith('/')) return resolve(distDir, pathname.slice(1), 'index.html');
  return resolve(distDir, pathname.slice(1));
};
const parseJsonLd = (html, href) => {
  const values = [];
  for (const match of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const value = JSON.parse(match[1]);
      values.push(...(Array.isArray(value) ? value : [value]));
    } catch {
      errors.push(`Invalid JSON-LD: ${href}`);
    }
  }
  return values;
};
const containsSchemaType = (value, type) => {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => containsSchemaType(entry, type));
  if (value['@type'] === type || (Array.isArray(value['@type']) && value['@type'].includes(type))) return true;
  return Object.values(value).some((entry) => containsSchemaType(entry, type));
};

const collectSitemap = async (url) => {
  const absolute = new URL(url, `${siteOrigin}/`).href;
  if (visitedSitemaps.has(absolute)) return;
  visitedSitemaps.add(absolute);
  const xml = await readFile(localPath(absolute), 'utf8');
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => new URL(decodeXml(match[1].trim())).href);
  if (xml.includes('<sitemapindex')) {
    for (const location of locations) await collectSitemap(location);
    return;
  }

  for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = block[1].match(/<loc>([^<]+)<\/loc>/)?.[1];
    if (!loc) continue;
    const href = new URL(decodeXml(loc.trim())).href;
    const lastmod = block[1].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]?.trim();
    assert(!sitemapUrls.has(href), `Duplicate sitemap URL: ${href}`);
    sitemapUrls.set(href, lastmod);
  }
};

await collectSitemap(`${siteOrigin}/sitemap.xml`);
assert(sitemapUrls.size > 0, 'Sitemap contains no page URLs.');

const manifest = JSON.parse(await readFile('public/data/apartments/manifest.json', 'utf8'));
const sourceDate = String(manifest.sourceDate || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
const apartmentBulkSource = await readFile('src/lib/apartmentBulk.ts', 'utf8');
const reportUpdated = apartmentBulkSource.match(/APARTMENT_REPORT_UPDATED\s*=\s*'(\d{4}-\d{2}-\d{2})'/)?.[1];
const allowedLastmods = new Set([sourceDate, reportUpdated].filter(Boolean));
const apartmentIndex = JSON.parse(await readFile('public/data/apartments/index.json', 'utf8'));
const apartmentBySlug = new Map(apartmentIndex.map((entry) => [entry.s, entry]));
for (const region of manifest.regions || []) {
  const entries = JSON.parse(await readFile(resolve('public', region.file.replace(/^\//, '')), 'utf8'));
  for (const entry of entries) if (/^\d{4}-\d{2}-\d{2}$/.test(entry.md || '')) allowedLastmods.add(entry.md);
}

let detailSample;
let regionSample;
let detailPages = 0;
let regionPages = 0;
for (const [href, lastmod] of sitemapUrls) {
  const url = new URL(href);
  assert(url.origin === siteOrigin, `Non-canonical sitemap host: ${href}`);
  assert(!url.search && !url.hash, `Parameterized URL in sitemap: ${href}`);
  assert(url.pathname === '/' || url.pathname.endsWith('/'), `Missing trailing slash in sitemap: ${href}`);
  if (lastmod) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(lastmod), `Invalid lastmod: ${href} ${lastmod}`);
    assert(allowedLastmods.has(lastmod), `lastmod is not tied to source/page changes: ${href} ${lastmod}`);
  }

  let html;
  try {
    html = await readFile(localPath(href, true), 'utf8');
  } catch {
    errors.push(`Sitemap URL has no generated HTML: ${href}`);
    continue;
  }
  const canonicals = [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/g)].map((match) => match[1]);
  assert(canonicals.length === 1, `Expected one canonical link: ${href}`);
  if (canonicals[0]) assert(new URL(canonicals[0]).href === href, `Canonical mismatch: ${href} -> ${canonicals[0]}`);
  assert(!/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html), `noindex URL in sitemap: ${href}`);
  assert((html.match(/<h1(?:\s|>)/g) || []).length === 1, `Expected one H1: ${href}`);
  assert(!/href="https?:\/\/(?:www\.)?cjournal\.kr\/apartments\//i.test(html), `Old-domain apartment link remains: ${href}`);

  const schemas = parseJsonLd(html, href);
  if (url.pathname === '/') {
    assert(schemas.some((schema) => containsSchemaType(schema, 'WebSite')), 'Home WebSite schema is missing.');
    assert(schemas.some((schema) => containsSchemaType(schema, 'Organization')), 'Home Organization schema is missing.');
  }

  if (/^\/apartments\/(?!regions\/)[^/]+\/$/.test(url.pathname)) {
    detailPages += 1;
    detailSample ??= { href, html };
    const slug = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1));
    const apartment = apartmentBySlug.get(slug);
    assert(Boolean(apartment), `Detail page missing from apartment index: ${href}`);
    assert(schemas.some((schema) => containsSchemaType(schema, 'BreadcrumbList')), `Detail BreadcrumbList is missing: ${href}`);
    assert(schemas.some((schema) => containsSchemaType(schema, 'Dataset')), `Detail Dataset schema is missing: ${href}`);
    assert(schemas.some((schema) => containsSchemaType(schema, 'Organization')), `Detail Organization publisher is missing: ${href}`);

    const visibleText = normalizeVisibleText(html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '));
    if (apartment) {
      assert(visibleText.includes(normalizeVisibleText(apartment.n)), `Apartment name is missing from initial HTML: ${href}`);
      assert(visibleText.includes(normalizeVisibleText(apartment.a)), `Apartment address is missing from initial HTML: ${href}`);
      assert(visibleText.includes(normalizeVisibleText(apartment.lm)), `Apartment reference month is missing from initial HTML: ${href}`);
    }
    assert(!visibleText.includes('결과 없음'), `Initial apartment HTML exposes an incorrect empty-result message: ${href}`);
  }

  if (/^\/apartments\/regions\/[^/]+(?:\/[^/]+)?\/$/.test(url.pathname)) {
    regionPages += 1;
    regionSample ??= { href, html };
    assert(schemas.some((schema) => containsSchemaType(schema, 'BreadcrumbList')), `Region BreadcrumbList is missing: ${href}`);
  }
}

assert(Boolean(detailSample), 'No apartment detail URL found in sitemap.');
assert(Boolean(regionSample), 'No apartment region URL found in sitemap.');

let publishedDetailPages = 0;
let noindexDetailPages = 0;
for (const apartment of apartmentIndex.filter((entry) => entry.q === 1)) {
  publishedDetailPages += 1;
  const href = new URL(`/apartments/${encodeURIComponent(apartment.s)}/`, siteOrigin).href;
  let html;
  try {
    html = await readFile(localPath(href, true), 'utf8');
  } catch {
    errors.push(`Published apartment has no generated HTML: ${href}`);
    continue;
  }
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/)?.[1];
  const noindex = /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html);
  const inSitemap = sitemapUrls.has(href);
  if (noindex) noindexDetailPages += 1;

  assert(Boolean(canonical) && new URL(canonical).href === href, `Published apartment canonical mismatch: ${href} -> ${canonical || '(missing)'}`);
  assert((html.match(/<h1(?:\s|>)/g) || []).length === 1, `Published apartment must have one H1: ${href}`);
  assert(noindex !== inSitemap, `Apartment sitemap/noindex mismatch: ${href}`);
  assert(!/href="https?:\/\/(?:www\.)?cjournal\.kr\/apartments\//i.test(html), `Old-domain apartment link remains: ${href}`);
}

if (errors.length) {
  console.error(errors.slice(0, 40).join('\n'));
  throw new Error(`SEO structure audit failed: ${errors.length} issues`);
}

console.log(JSON.stringify({
  sitemapFiles: visitedSitemaps.size,
  canonicalPages: sitemapUrls.size,
  detailPages,
  regionPages,
  publishedDetailPages,
  noindexDetailPages,
  allowedLastmods: [...allowedLastmods].sort(),
  detailSample: detailSample?.href,
  regionSample: regionSample?.href
}, null, 2));

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://danjipyo.kr').replace(/\/+$/, '');
const siteHost = new URL(siteUrl).host;
const key = process.env.INDEXNOW_KEY || 'dd31d55254614118988122a86e38eb19';
const keyLocation = `${siteUrl}/${key}.txt`;
const sitemapUrl = `${siteUrl}/sitemap.xml`;
const changeFile = resolve(process.env.INDEXNOW_URL_FILE || 'data/kapt/indexnow-changes.json');
const endpoints = (process.env.INDEXNOW_ENDPOINTS || [
  'https://searchadvisor.naver.com/indexnow',
  'https://api.indexnow.org/indexnow'
].join(','))
  .split(/[\n,]/)
  .map((value) => value.trim())
  .filter(Boolean);
const batchSize = 10_000;
const dryRun = process.env.INDEXNOW_DRY_RUN === '1';
const releaseId = process.env.INDEXNOW_RELEASE_ID || process.env.GITHUB_SHA || Date.now().toString();

const decodeXml = (value) => value
  .replaceAll('&amp;', '&')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', "'");

const fetchWithTimeout = (url, init = {}) => fetch(url, {
  ...init,
  signal: AbortSignal.timeout(Number(process.env.INDEXNOW_TIMEOUT_MS || 15_000))
});

const normalizeUrl = (value) => {
  const url = new URL(String(value), `${siteUrl}/`);
  if (url.host !== siteHost || url.protocol !== 'https:') {
    throw new Error(`URL is outside the configured HTTPS host: ${url.href}`);
  }
  url.hash = '';
  return url.href;
};

const collectCanonicalSitemapUrls = async () => {
  const visited = new Set();
  const collect = async (url, depth = 0) => {
    if (depth > 3) throw new Error(`Sitemap nesting is too deep: ${url}`);
    if (visited.has(url)) return [];
    if (visited.size >= 100) throw new Error('Sitemap index contains too many files.');
    if (new URL(url).host !== siteHost) throw new Error(`Sitemap URL is outside the configured site host: ${url}`);
    visited.add(url);

    const fresh = new URL(url);
    fresh.searchParams.set('_release', releaseId);
    const response = await fetchWithTimeout(fresh, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Sitemap download failed: ${response.status} ${url}`);
    const xml = await response.text();
    const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((match) => normalizeUrl(decodeXml(match[1].trim())));
    if (!xml.includes('<sitemapindex')) return locations;
    return (await Promise.all(locations.map((location) => collect(location, depth + 1)))).flat();
  };
  return new Set(await collect(sitemapUrl));
};

const loadChangeSet = async () => {
  const manual = (process.env.INDEXNOW_URLS || '')
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (manual.length) return { urls: manual, removedUrls: [], source: 'INDEXNOW_URLS' };

  const parsed = JSON.parse(await readFile(changeFile, 'utf8'));
  return {
    urls: Array.isArray(parsed.urls) ? parsed.urls : [],
    removedUrls: Array.isArray(parsed.removedUrls) ? parsed.removedUrls : [],
    source: changeFile,
    stats: parsed.stats
  };
};

const verifyKey = async () => {
  const response = await fetchWithTimeout(keyLocation, { cache: 'no-store' });
  if (!response.ok) throw new Error(`IndexNow key verification failed: ${response.status} ${keyLocation}`);
  if ((await response.text()).trim() !== key) throw new Error(`IndexNow key mismatch at ${keyLocation}`);
};

const submit = async () => {
  const changes = await loadChangeSet();
  const requestedActive = [...new Set(changes.urls.map(normalizeUrl))];
  const requestedRemoved = [...new Set(changes.removedUrls.map(normalizeUrl))];
  if (!requestedActive.length && !requestedRemoved.length) {
    console.log(`IndexNow skipped: no changed URLs in ${changes.source}`);
    return;
  }

  const canonicalUrls = await collectCanonicalSitemapUrls();
  const activeUrls = requestedActive.filter((url) => canonicalUrls.has(url));
  const excluded = requestedActive.filter((url) => !canonicalUrls.has(url));
  const removedUrls = requestedRemoved.filter((url) => !canonicalUrls.has(url));
  const urls = [...new Set([...activeUrls, ...removedUrls])];

  if (excluded.length) {
    console.warn(`IndexNow excluded ${excluded.length} active URLs absent from the canonical sitemap.`);
  }
  if (!urls.length) {
    console.log(`IndexNow skipped: no canonical changed or removed URLs in ${changes.source}`);
    return;
  }

  if (dryRun) {
    console.log(JSON.stringify({
      source: changes.source,
      active: activeUrls.length,
      removed: removedUrls.length,
      excluded: excluded.length,
      endpoints
    }, null, 2));
    return;
  }

  await verifyKey();
  const failures = [];
  for (const endpoint of endpoints) {
    for (let index = 0; index < urls.length; index += batchSize) {
      const urlList = urls.slice(index, index + batchSize);
      try {
        const response = await fetchWithTimeout(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ host: siteHost, key, keyLocation, urlList })
        });
        if (![200, 202].includes(response.status)) {
          const message = (await response.text()).trim();
          throw new Error(`${response.status} ${message}`.trim());
        }
        console.log(`${new URL(endpoint).host}: ${urlList.length} changed URLs accepted (${response.status})`);
      } catch (error) {
        failures.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  console.log(`IndexNow complete: ${activeUrls.length} active + ${removedUrls.length} removed URLs from ${changes.source}`);
  for (const failure of failures) console.warn(`IndexNow warning: ${failure}`);
};

try {
  await submit();
} catch (error) {
  console.warn(`IndexNow skipped without failing the release: ${error instanceof Error ? error.message : String(error)}`);
}

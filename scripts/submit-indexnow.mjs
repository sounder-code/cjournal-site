const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://danjipyo.kr').replace(/\/+$/, '');
const key = process.env.INDEXNOW_KEY || 'dd31d55254614118988122a86e38eb19';
const endpoint = process.env.INDEXNOW_ENDPOINT || 'https://searchadvisor.naver.com/indexnow';
const keyLocation = `${siteUrl}/${key}.txt`;
const sitemapUrl = `${siteUrl}/sitemap.xml`;
const batchSize = 10_000;
const dryRun = process.env.INDEXNOW_DRY_RUN === '1';

const keyResponse = await fetch(keyLocation);
if (!keyResponse.ok) {
  throw new Error(`IndexNow key verification failed: ${keyResponse.status} ${keyLocation}`);
}

const publishedKey = (await keyResponse.text()).trim();
if (publishedKey !== key) {
  throw new Error(`IndexNow key mismatch at ${keyLocation}`);
}

const siteHost = new URL(siteUrl).host;
const visitedSitemaps = new Set();

const decodeXml = (value) => value
  .replaceAll('&amp;', '&')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', "'");

const collectSitemapUrls = async (url, depth = 0) => {
  if (depth > 3) throw new Error(`Sitemap nesting is too deep: ${url}`);
  if (visitedSitemaps.has(url)) return [];
  if (visitedSitemaps.size >= 100) throw new Error('Sitemap index contains too many files.');
  if (new URL(url).host !== siteHost) throw new Error(`Sitemap URL is outside the configured site host: ${url}`);
  visitedSitemaps.add(url);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Sitemap download failed: ${response.status} ${url}`);
  const xml = await response.text();
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decodeXml(match[1].trim()));
  if (xml.includes('<sitemapindex')) {
    const nested = await Promise.all(locations.map((location) => collectSitemapUrls(location, depth + 1)));
    return nested.flat();
  }
  return locations;
};

const urls = [...new Set(await collectSitemapUrls(sitemapUrl))];

if (!urls.length) throw new Error(`No URLs found in ${sitemapUrl}`);
if (urls.some((url) => new URL(url).host !== siteHost)) {
  throw new Error('Sitemap contains a URL outside the configured site host.');
}

if (dryRun) {
  console.log(`IndexNow dry run: ${urls.length.toLocaleString('en-US')} URLs are ready.`);
} else {
  for (let index = 0; index < urls.length; index += batchSize) {
    const urlList = urls.slice(index, index + batchSize);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: siteHost,
        key,
        keyLocation,
        urlList
      })
    });

    if (![200, 202].includes(response.status)) {
      const message = (await response.text()).trim();
      throw new Error(`IndexNow batch ${index / batchSize + 1} failed: ${response.status} ${message}`);
    }

    console.log(
      `IndexNow batch ${index / batchSize + 1}/${Math.ceil(urls.length / batchSize)} accepted: ` +
        `${urlList.length.toLocaleString('en-US')} URLs (${response.status})`
    );
  }
}

console.log(
  `IndexNow submission complete: ${urls.length.toLocaleString('en-US')} URLs from ` +
    `${visitedSitemaps.size.toLocaleString('en-US')} sitemap files`
);

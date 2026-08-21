import {
  compareApartmentDiscoveryPriority,
  APARTMENT_REPORT_UPDATED,
  loadApartmentManifest,
  loadApartmentPageData
} from '@/lib/apartmentBulk';
import { districtHubPath, regionHubPath } from '@/lib/apartmentSeo';

export const APARTMENT_SITEMAP_CHUNK_SIZE = 1_000;

type ChangeFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq: ChangeFrequency;
  priority: string;
}

interface SitemapInventory {
  lastmod?: string;
  core: SitemapEntry[];
  regions: SitemapEntry[];
  apartments: SitemapEntry[];
}

const corePages: Array<Omit<SitemapEntry, 'lastmod'>> = [
  { loc: '/', priority: '1.0', changefreq: 'daily' },
  { loc: '/apartments/', priority: '1.0', changefreq: 'weekly' },
  { loc: '/about/', priority: '0.5', changefreq: 'monthly' },
  { loc: '/contact/', priority: '0.4', changefreq: 'monthly' },
  { loc: '/methodology/', priority: '0.6', changefreq: 'monthly' },
  { loc: '/management-fee-guide/', priority: '0.8', changefreq: 'monthly' },
  { loc: '/editorial-policy/', priority: '0.5', changefreq: 'monthly' },
  { loc: '/privacy/', priority: '0.3', changefreq: 'yearly' },
  { loc: '/terms/', priority: '0.3', changefreq: 'yearly' }
];

const validIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value)
    ? value
    : undefined;
};

const sitemapLastmod = (sourceDate?: string) => {
  const compact = sourceDate?.match(/^(\d{4})(\d{2})(\d{2})$/);
  return compact
    ? validIsoDate(`${compact[1]}-${compact[2]}-${compact[3]}`)
    : undefined;
};

const latestDate = (...values: Array<string | undefined>) => values
  .filter((value): value is string => Boolean(value))
  .sort()
  .at(-1);

const apartmentLastmod = (
  apartment: { md?: string },
  sourceLastmod?: string
) => latestDate(
  APARTMENT_REPORT_UPDATED,
  validIsoDate(apartment.md ?? '') ?? sourceLastmod
);

const comparePaths = (left: string, right: string) => left.localeCompare(right, 'ko');

const assertUniqueCanonicalPaths = (groups: Array<[string, SitemapEntry[]]>) => {
  const owners = new Map<string, string>();
  for (const [group, entries] of groups) {
    for (const { loc } of entries) {
      const owner = owners.get(loc);
      if (owner) throw new Error(`Canonical URL appears in both ${owner} and ${group}: ${loc}`);
      owners.set(loc, group);
    }
  }
};

let inventoryPromise: Promise<SitemapInventory> | undefined;

export const loadSitemapInventory = () => {
  inventoryPromise ??= (async () => {
    const [manifest, pages] = await Promise.all([
      loadApartmentManifest(),
      loadApartmentPageData()
    ]);
    const sourceLastmod = sitemapLastmod(manifest.sourceDate);
    const provincePaths = new Set<string>();
    const districtPaths = new Set<string>();
    const apartmentPaths = new Set<string>();
    const regionLastmods = new Map<string, string | undefined>();

    for (const page of pages) {
      const apartment = page?.apartment;
      if (!apartment) continue;

      const slug = typeof apartment.s === 'string' ? apartment.s.trim() : '';
      if (slug) apartmentPaths.add(`/apartments/${slug}/`);

      const province = typeof apartment.sd === 'string' ? apartment.sd.trim() : '';
      if (!province) continue;
      const provincePath = regionHubPath(province);
      provincePaths.add(provincePath);
      regionLastmods.set(provincePath, latestDate(
        regionLastmods.get(provincePath),
        validIsoDate(apartment.md ?? '') ?? sourceLastmod
      ));

      const district = typeof apartment.sg === 'string' ? apartment.sg.trim() : '';
      const districtPath = districtHubPath(province, district);
      districtPaths.add(districtPath);
      regionLastmods.set(districtPath, latestDate(
        regionLastmods.get(districtPath),
        validIsoDate(apartment.md ?? '') ?? sourceLastmod
      ));
    }

    const dataLastmod = latestDate(
      sourceLastmod,
      ...pages.map(({ apartment }) => validIsoDate(apartment.md ?? ''))
    );

    const core = corePages.map((entry) => ({
      ...entry,
      lastmod: entry.loc === '/'
        ? latestDate(APARTMENT_REPORT_UPDATED, dataLastmod)
        : entry.loc === '/apartments/'
          ? dataLastmod
          : entry.loc === '/methodology/' ? APARTMENT_REPORT_UPDATED : undefined
    }));
    const regions = [...provincePaths, ...districtPaths]
      .sort(comparePaths)
      .map((loc) => ({ loc, lastmod: regionLastmods.get(loc) ?? sourceLastmod, priority: '0.8', changefreq: 'monthly' as const }));
    const apartments = pages
      .filter((page) => page.indexable)
      .filter((page) => page?.apartment && apartmentPaths.has(`/apartments/${page.apartment.s}/`))
      .sort((left, right) => compareApartmentDiscoveryPriority(left.apartment, right.apartment))
      .map(({ apartment }) => ({
        loc: `/apartments/${apartment.s}/`,
        lastmod: apartmentLastmod(apartment, sourceLastmod),
        priority: apartment.h >= 1_000 ? '0.8' : '0.7',
        changefreq: 'monthly' as const
      }));

    assertUniqueCanonicalPaths([
      ['core sitemap', core],
      ['regions sitemap', regions],
      ['apartment sitemaps', apartments]
    ]);

    const lastmod = latestDate(
      ...core.map((entry) => entry.lastmod),
      ...regions.map((entry) => entry.lastmod),
      ...apartments.map((entry) => entry.lastmod)
    );
    return { lastmod, core, regions, apartments };
  })();

  return inventoryPromise;
};

export const apartmentSitemapChunks = (entries: SitemapEntry[]) => {
  const chunks: SitemapEntry[][] = [];
  for (let index = 0; index < entries.length; index += APARTMENT_SITEMAP_CHUNK_SIZE) {
    chunks.push(entries.slice(index, index + APARTMENT_SITEMAP_CHUNK_SIZE));
  }
  return chunks;
};

const xmlEscape = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const absoluteUrl = (path: string, site?: URL) =>
  new URL(path, site ?? new URL('https://danjipyo.kr/')).toString();

export const renderUrlSet = (entries: SitemapEntry[], site?: URL) => {
  const urls = entries.map((entry) => {
    const lastmod = entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : '';
    return `  <url><loc>${xmlEscape(absoluteUrl(entry.loc, site))}</loc>${lastmod}<changefreq>${entry.changefreq}</changefreq><priority>${entry.priority}</priority></url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;
};

export const renderSitemapIndex = (paths: string[], lastmod: string | undefined, site?: URL) => {
  const maps = paths.map((path) => {
    const modified = lastmod ? `<lastmod>${lastmod}</lastmod>` : '';
    return `  <sitemap><loc>${xmlEscape(absoluteUrl(path, site))}</loc>${modified}</sitemap>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${maps.join('\n')}\n</sitemapindex>`;
};

export const xmlResponse = (body: string) => new Response(body, {
  headers: { 'Content-Type': 'application/xml; charset=utf-8' }
});

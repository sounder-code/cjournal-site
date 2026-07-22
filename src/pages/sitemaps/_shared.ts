import { loadApartmentManifest, loadApartmentPageData } from '@/lib/apartmentBulk';
import { districtHubPath, regionHubPath } from '@/lib/apartmentSeo';

export const APARTMENT_SITEMAP_CHUNK_SIZE = 5_000;

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

const sitemapLastmod = (sourceDate?: string, generatedAt?: string) => {
  const compact = sourceDate?.match(/^(\d{4})(\d{2})(\d{2})$/);
  const fromSource = compact
    ? validIsoDate(`${compact[1]}-${compact[2]}-${compact[3]}`)
    : undefined;
  return fromSource ?? validIsoDate(generatedAt?.slice(0, 10) ?? '');
};

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
    const lastmod = sitemapLastmod(manifest.sourceDate, manifest.generatedAt);
    const provincePaths = new Set<string>();
    const districtPaths = new Set<string>();
    const apartmentPaths = new Set<string>();

    for (const page of pages) {
      const apartment = page?.apartment;
      if (!apartment) continue;

      const slug = typeof apartment.s === 'string' ? apartment.s.trim() : '';
      if (slug) apartmentPaths.add(`/apartments/${slug}/`);

      const province = typeof apartment.sd === 'string' ? apartment.sd.trim() : '';
      if (!province) continue;
      provincePaths.add(regionHubPath(province));

      const district = typeof apartment.sg === 'string' ? apartment.sg.trim() : '';
      districtPaths.add(districtHubPath(province, district));
    }

    const core = corePages.map((entry) => ({ ...entry, lastmod }));
    const regions = [...provincePaths, ...districtPaths]
      .sort(comparePaths)
      .map((loc) => ({ loc, lastmod, priority: '0.8', changefreq: 'monthly' as const }));
    const apartments = [...apartmentPaths]
      .sort(comparePaths)
      .map((loc) => ({ loc, lastmod, priority: '0.7', changefreq: 'weekly' as const }));

    assertUniqueCanonicalPaths([
      ['core sitemap', core],
      ['regions sitemap', regions],
      ['apartment sitemaps', apartments]
    ]);

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

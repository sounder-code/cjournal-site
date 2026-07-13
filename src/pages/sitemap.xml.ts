import type { APIRoute } from 'astro';
import { calculators } from '@/data/calculators';
import { guides } from '@/data/guides';
import { loadApartmentManifest, loadApartmentPageData } from '@/lib/apartmentBulk';

export const GET: APIRoute = async ({ site }) => {
  const base = site?.toString().replace(/\/$/, '') ?? '';
  const [manifest, apartmentPages] = await Promise.all([loadApartmentManifest(), loadApartmentPageData()]);
  const lastmod = `${manifest.sourceDate.slice(0, 4)}-${manifest.sourceDate.slice(4, 6)}-${manifest.sourceDate.slice(6, 8)}`;

  const urls = [
    { loc: '/', priority: '1.0', changefreq: 'daily' },
    { loc: '/calculators/', priority: '0.95', changefreq: 'daily' },
    { loc: '/map/', priority: '1.0', changefreq: 'weekly' },
    { loc: '/apartments/', priority: '1.0', changefreq: 'weekly' },
    { loc: '/news', priority: '0.8', changefreq: 'weekly' },
    { loc: '/about', priority: '0.5', changefreq: 'monthly' },
    { loc: '/contact', priority: '0.4', changefreq: 'monthly' },
    { loc: '/methodology', priority: '0.6', changefreq: 'monthly' },
    { loc: '/management-fee-guide/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/calculator-audit/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/editorial-policy', priority: '0.5', changefreq: 'monthly' },
    { loc: '/privacy', priority: '0.3', changefreq: 'yearly' },
    { loc: '/terms', priority: '0.3', changefreq: 'yearly' },
    ...guides.map((guide) => ({
      loc: `/guides/${guide.slug}/`,
      priority: '0.75',
      changefreq: 'monthly'
    })),
    ...calculators.map((calculator) => ({
      loc: `/calculators/${calculator.slug}/`,
      priority: calculator.slug === 'stock-cashout-tax' ? '0.9' : '0.85',
      changefreq: 'monthly'
    })),
    ...apartmentPages.map(({ apartment }) => ({
      loc: `/apartments/${apartment.s}/`,
      priority: '0.7',
      changefreq: 'weekly'
    }))
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (url) =>
        `  <url><loc>${encodeURI(`${base}${url.loc}`)}</loc><lastmod>${lastmod}</lastmod><changefreq>${url.changefreq}</changefreq><priority>${url.priority}</priority></url>`
    )
    .join('\n')}\n</urlset>`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' }
  });
};

import type { APIRoute } from 'astro';
import { calculators } from '@/data/calculators';

export const GET: APIRoute = async ({ site }) => {
  const base = site?.toString().replace(/\/$/, '') ?? '';

  const urls = [
    '/',
    '/news',
    '/about',
    '/contact',
    '/methodology',
    '/privacy',
    '/terms',
    ...calculators.map((calculator) => `/calculators/${calculator.slug}/`)
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((url) => `  <url><loc>${base}${url}</loc></url>`)
    .join('\n')}\n</urlset>`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' }
  });
};

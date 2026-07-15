import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const origin = site?.toString().replace(/\/$/, '') ?? '';
  const body = `User-agent: *
Allow: /
Disallow: /posts/
Disallow: /tags/

User-agent: Mediapartners-Google
Allow: /ads.txt

User-agent: Google-Display-Ads-Bot
Allow: /ads.txt

User-agent: Googlebot
Allow: /ads.txt

Sitemap: ${origin}/sitemap.xml
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
};

import apartmentCanonicalPaths from './generated-apartment-redirects.js';
import apartmentPacks from './generated-apartment-packs.js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const naverVerificationPath = '/naver692408c2a6023501bbb744a3d0dbe9dd.html';
  if (url.pathname === naverVerificationPath) {
    return new Response('naver-site-verification: naver692408c2a6023501bbb744a3d0dbe9dd.html', {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=3600'
      }
    });
  }

  const removedPrefixes = ['/posts', '/tags'];
  const isRemovedPath = removedPrefixes.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));

  if (isRemovedPath) {
    return new Response('Gone', {
      status: 410,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'x-robots-tag': 'noindex, nofollow'
      }
    });
  }

  const apartmentMatch = url.pathname.match(/^\/apartments\/[^/]+-([a-z][a-z0-9]+)\/?$/i);
  if (apartmentMatch) {
    const canonicalPath = apartmentCanonicalPaths[apartmentMatch[1].toLowerCase()];
    if (canonicalPath && url.pathname !== canonicalPath) {
      return Response.redirect(new URL(canonicalPath, url.origin), 308);
    }
    const pack = apartmentPacks[apartmentMatch[1].toLowerCase()];
    if (canonicalPath && pack && ['GET', 'HEAD'].includes(context.request.method)) {
      const asset = await context.env.ASSETS.fetch(new URL(`/report-packs/${pack}.json`, url.origin));
      if (!asset.ok) return new Response('Temporarily unavailable', { status: 503, headers: { 'retry-after': '60' } });
      const reports = await asset.json();
      const html = reports[apartmentMatch[1].toLowerCase()];
      if (typeof html !== 'string') return new Response('Temporarily unavailable', { status: 503, headers: { 'retry-after': '60' } });
      return new Response(context.request.method === 'HEAD' ? null : html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=3600, s-maxage=86400',
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'SAMEORIGIN',
          'referrer-policy': 'strict-origin-when-cross-origin',
          'permissions-policy': 'geolocation=(), microphone=(), camera=()',
          'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
          'cross-origin-opener-policy': 'same-origin-allow-popups',
          'cross-origin-resource-policy': 'cross-origin'
        }
      });
    }
  }

  return context.next();
}

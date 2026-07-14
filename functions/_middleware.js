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

  return context.next();
}

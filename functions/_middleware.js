export async function onRequest(context) {
  const url = new URL(context.request.url);
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

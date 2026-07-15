const fallbackOrigin = 'https://danjipyo.kr';

export const siteOrigin = (import.meta.env.PUBLIC_SITE_URL || fallbackOrigin).replace(/\/+$/, '');

export const siteUrl = (path = '/') => new URL(path, `${siteOrigin}/`).toString();

/** Preserve identity only from observed records with the same apartment code. */
export function apartmentIdentity(name: string, code: string, previous?: { slug: string; name: string; aliases?: string[] }) {
  const slug = previous?.slug || `${name}-${code}`.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '');
  const aliases = [...new Set([...(previous?.aliases ?? []), previous?.name ?? ''].map((value) => value.trim()).filter((value) => value && value !== name.trim()))].sort();
  return { s: slug, ...(aliases.length ? { an: aliases } : {}) };
}

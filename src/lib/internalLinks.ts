export type PostIndexItem = {
  slug: string;
  title: string;
  tags: string[];
  publishedAt: string;
  updatedAt?: string;
};

function score(item: PostIndexItem) {
  const updated = Date.parse(item.updatedAt ?? '');
  const published = Date.parse(item.publishedAt ?? '');
  const u = Number.isNaN(updated) ? 0 : updated;
  const p = Number.isNaN(published) ? 0 : published;
  return Math.max(u, p);
}

export function suggestRelatedPosts(current: PostIndexItem, pool: PostIndexItem[], limit = 3) {
  return pool
    .filter((item) => item.slug !== current.slug)
    .map((item) => {
      const overlap = item.tags.filter((t) => current.tags.includes(t)).length;
      return { item, overlap };
    })
    .filter((row) => row.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || score(b.item) - score(a.item))
    .slice(0, limit)
    .map((row) => row.item);
}

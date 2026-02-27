export type PostIndexItem = {
  slug: string;
  title: string;
  tags: string[];
  publishedAt: string;
};

export function suggestRelatedPosts(current: PostIndexItem, pool: PostIndexItem[], limit = 3) {
  return pool
    .filter((item) => item.slug !== current.slug)
    .map((item) => {
      const overlap = item.tags.filter((t) => current.tags.includes(t)).length;
      return { item, overlap };
    })
    .filter((row) => row.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || b.item.publishedAt.localeCompare(a.item.publishedAt))
    .slice(0, limit)
    .map((row) => row.item);
}

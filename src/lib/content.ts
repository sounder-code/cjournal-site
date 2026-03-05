import { getCollection } from 'astro:content';
import { toDate } from './date';

export async function getAllPosts() {
  const posts = await getCollection('posts');
  return posts.sort((a, b) => {
    const aRecent = Math.max(toDate(a.data.updatedAt).getTime(), toDate(a.data.publishedAt).getTime());
    const bRecent = Math.max(toDate(b.data.updatedAt).getTime(), toDate(b.data.publishedAt).getTime());
    if (bRecent !== aRecent) return bRecent - aRecent;
    const byPublished = toDate(b.data.publishedAt).getTime() - toDate(a.data.publishedAt).getTime();
    if (byPublished !== 0) return byPublished;
    return b.slug.localeCompare(a.slug);
  });
}

export async function getLatestPosts(limit = 12) {
  const posts = await getAllPosts();
  return posts.slice(0, limit);
}

export async function getTagCounts() {
  const posts = await getAllPosts();
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }));
}

export async function getPostsByTag(tag: string) {
  const posts = await getAllPosts();
  return posts.filter((post) => post.data.tags.includes(tag));
}

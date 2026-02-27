import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { toDate } from '@/lib/date';

export async function GET(context: { site: URL }) {
  const posts = await getCollection('posts');

  return rss({
    title: '콘텐츠 허브 RSS',
    description: '최신 정보형 아티클 피드',
    site: context.site,
    items: posts
      .sort((a, b) => toDate(b.data.publishedAt).getTime() - toDate(a.data.publishedAt).getTime())
      .map((post) => ({
        title: post.data.title,
        description: post.data.description,
        pubDate: toDate(post.data.publishedAt),
        link: `/posts/${post.slug}/`
      }))
  });
}

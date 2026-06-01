import rss from '@astrojs/rss';
import { calculators, groupLabels } from '@/data/calculators';
import { guides } from '@/data/guides';

export async function GET(context: { site: URL }) {
  return rss({
    title: '바로계산 계산기 피드',
    description: '돈, 생활, 계약, 건강 계산기와 계산 가이드 업데이트',
    site: context.site,
    items: [
      ...guides.map((guide) => ({
        title: guide.title,
        description: `${guide.category} · ${guide.description}`,
        pubDate: new Date(`${guide.updatedAt}T00:00:00+09:00`),
        link: `/guides/${guide.slug}/`
      })),
      ...calculators.map((calculator) => ({
        title: calculator.title,
        description: `${groupLabels[calculator.group]} · ${calculator.description}`,
        pubDate: new Date('2026-05-28T00:00:00+09:00'),
        link: `/calculators/${calculator.slug}/`
      }))
    ]
  });
}

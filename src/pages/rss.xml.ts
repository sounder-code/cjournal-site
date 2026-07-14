import rss from '@astrojs/rss';

export async function GET(context: { site: URL }) {
  return rss({
    title: '단지표 아파트 관리비 피드',
    description: 'K-apt 공개자료를 기반으로 한 아파트 관리비 데이터와 산정 기준 업데이트',
    site: context.site,
    items: [
      {
        title: '아파트 관리비 읽는 법',
        description: '공용관리비, 개별사용료, 장기수선충당금과 ㎡당 비교 단가를 해석하는 기준',
        pubDate: new Date('2026-07-13T00:00:00+09:00'),
        link: '/management-fee-guide/'
      },
      {
        title: '관리비 데이터 산정 기준',
        description: 'K-apt 원본 결합, 비교군, 백분위와 자동 검증 항목',
        pubDate: new Date('2026-07-13T00:00:00+09:00'),
        link: '/methodology/'
      }
    ]
  });
}

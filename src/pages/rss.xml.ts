import rss from '@astrojs/rss';
import {
  compareApartmentDiscoveryPriority,
  loadApartmentManifest,
  loadApartmentPageData
} from '@/lib/apartmentBulk';

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;
const monthLabel = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;

export async function GET(context: { site: URL }) {
  const [manifest, pages] = await Promise.all([
    loadApartmentManifest(),
    loadApartmentPageData()
  ]);
  const publishedAt = new Date(
    `${manifest.sourceDate.slice(0, 4)}-${manifest.sourceDate.slice(4, 6)}-${manifest.sourceDate.slice(6, 8)}T09:00:00+09:00`
  );
  const apartmentItems = [...pages]
    .sort((left, right) => compareApartmentDiscoveryPriority(left.apartment, right.apartment))
    .slice(0, 100)
    .map(({ apartment, peerLabel }) => {
      const latest = apartment.f.at(-1)!;
      const previous = apartment.f.at(-2) ?? latest;
      const delta = latest[1] - previous[1];
      const trend = delta === 0
        ? '전월과 같습니다.'
        : `전월보다 ${Math.abs(delta).toLocaleString('ko-KR')}원 ${delta > 0 ? '높습니다.' : '낮습니다.'}`;
      const description = `${apartment.n}의 ${monthLabel(latest[0])} 총 관리비는 ㎡당 ${won(latest[1])}이며 ${trend}`;
      return {
        title: `${apartment.n} ${latest[0]} 관리비`,
        description,
        content: `<p>${description}</p><p>공용관리비는 ㎡당 ${won(latest[2])}, 개별사용료는 ${won(latest[3])}, 장기수선충당금은 ${won(latest[4])}입니다.</p><p>${apartment.sd} ${apartment.sg} ${apartment.d}, ${apartment.h.toLocaleString('ko-KR')}세대 단지이며 비교 기준은 ${peerLabel}입니다. K-apt 공개자료의 최근 ${apartment.f.length}개월 내역을 확인할 수 있습니다.</p>`,
        pubDate: publishedAt,
        link: `/apartments/${apartment.s}/`
      };
    });

  return rss({
    title: '단지표 아파트 관리비 피드',
    description: 'K-apt 공개자료를 기반으로 한 아파트 관리비 데이터와 산정 기준 업데이트',
    site: context.site,
    customData: '<language>ko-KR</language>',
    items: [
      ...apartmentItems,
      {
        title: '아파트 관리비 읽는 법',
        description: '공용관리비, 개별사용료, 장기수선충당금과 ㎡당 비교 단가를 해석하는 기준',
        pubDate: publishedAt,
        link: '/management-fee-guide/'
      },
      {
        title: '관리비 데이터 산정 기준',
        description: 'K-apt 원본 결합, 비교군, 백분위와 자동 검증 항목',
        pubDate: publishedAt,
        link: '/methodology/'
      }
    ]
  });
}

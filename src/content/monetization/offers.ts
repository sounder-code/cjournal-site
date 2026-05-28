export type MonetizationOffer = {
  id: string;
  title: string;
  description: string;
  url: string;
  tags: string[];
  category?: string;
};

export const MONETIZATION_OFFERS: MonetizationOffer[] = [
  {
    id: 'offer-seller-tools',
    title: '판매자 비용 관리 도구',
    description: '마진, 광고비, 재고 비용을 함께 관리할 때 확인할 만한 도구 모음입니다.',
    url: 'https://example.com/seller-tools',
    tags: ['마진', '판매자', '수수료', '광고비', '재고', '정산'],
    category: '판매자'
  },
  {
    id: 'offer-shipping',
    title: '택배·포장비 비교',
    description: '배송비와 포장비가 마진에 미치는 영향을 줄이고 싶을 때 확인하세요.',
    url: 'https://example.com/shipping',
    tags: ['배송비', '포장비', '택배', '판매자', '마진'],
    category: '판매자'
  },
  {
    id: 'offer-budget-app',
    title: '고정비 관리 도구',
    description: '구독비, 렌탈료, 약정 비용을 한 곳에서 점검할 때 참고할 수 있습니다.',
    url: 'https://example.com/budget-apps',
    tags: ['구독비', '렌탈', '생활비', '예산', '절감'],
    category: '생활비'
  },
  {
    id: 'offer-internet',
    title: '인터넷·통신비 비교',
    description: '약정 변경 전 월요금, 위약금, 사은품 조건을 비교할 때 확인하세요.',
    url: 'https://example.com/internet',
    tags: ['인터넷', '통신비', '위약금', '약정', '사은품'],
    category: '생활비'
  },
  {
    id: 'offer-rental',
    title: '렌탈 총비용 비교',
    description: '월 렌탈료보다 약정 총액과 할인 조건을 먼저 비교하세요.',
    url: 'https://example.com/rental',
    tags: ['렌탈', '정수기', '비데', '공기청정기', '약정'],
    category: '생활비'
  }
];

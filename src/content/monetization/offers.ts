export type MonetizationOffer = {
  id: string;
  title: string;
  description: string;
  url: string;
  tags: string[];
  category?: string;
};

// Replace URLs with your real affiliate/referral destinations.
export const MONETIZATION_OFFERS: MonetizationOffer[] = [
  {
    id: 'offer-ai-writing',
    title: 'AI 문서 자동화 툴 비교',
    description: '보고서/기획안 작성 시간을 줄이는 생산성 툴 가이드입니다.',
    url: 'https://example.com/ai-writing-tools',
    tags: ['생산성', '업무', '문서', '메일', '정리', 'ai', '자동화'],
    category: '생산성'
  },
  {
    id: 'offer-security-vpn',
    title: '보안/VPN 추천 가이드',
    description: '공용 와이파이와 계정 보호에 유용한 보안 도구 모음입니다.',
    url: 'https://example.com/security-vpn',
    tags: ['보안', '디지털', '와이파이', '개인정보', '계정', '비밀번호'],
    category: '디지털'
  },
  {
    id: 'offer-budget-app',
    title: '가계/사업 지출관리 앱',
    description: '고정비 추적과 예산 관리에 도움 되는 도구를 정리했습니다.',
    url: 'https://example.com/budget-apps',
    tags: ['가계부', '예산', '절약', '생활관리', '소비', '정산'],
    category: '생활관리'
  },
  {
    id: 'offer-travel-card',
    title: '여행/교통 혜택 카드',
    description: '교통비와 여행비를 줄일 수 있는 카드/멤버십 정보를 제공합니다.',
    url: 'https://example.com/travel-card',
    tags: ['교통', '여행', '항공', '기차', '버스', '전기차'],
    category: '교통/이동'
  },
  {
    id: 'offer-wellness-app',
    title: '수면/건강 루틴 앱',
    description: '수면 기록, 스트레스 관리, 운동 루틴 추적용 도구 모음입니다.',
    url: 'https://example.com/wellness-app',
    tags: ['건강', '수면', '운동', '스트레스', '루틴'],
    category: '건강생활'
  }
];

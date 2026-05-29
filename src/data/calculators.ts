export type CalculatorGroup = 'seller' | 'living' | 'utility';

export type Calculator = {
  slug: string;
  group: CalculatorGroup;
  title: string;
  shortTitle: string;
  description: string;
  intent: string;
  inputs: Array<{
    key: string;
    label: string;
    suffix?: string;
    value: number | string;
    type?: 'number' | 'select';
    options?: Array<{ label: string; value: string }>;
    min?: number;
    max?: number;
    step?: number;
  }>;
};

export const groupLabels: Record<CalculatorGroup, string> = {
  seller: '판매자 계산기',
  living: '생활비 계산기',
  utility: '금융·운영 계산기'
};

export const calculators: Calculator[] = [
  {
    slug: 'seller-margin',
    group: 'seller',
    title: '판매자 순이익 마진 계산기',
    shortTitle: '마진 계산기',
    description: '판매가, 원가, 수수료, 배송비, 광고비, 반품률을 반영해 실제 남는 돈을 계산합니다.',
    intent: '팔수록 손해인지 먼저 보기',
    inputs: [
      { key: 'price', label: '판매가', suffix: '원', value: 29900, min: 0, step: 100 },
      { key: 'cost', label: '매입/제조 원가', suffix: '원', value: 12000, min: 0, step: 100 },
      { key: 'platformFee', label: '플랫폼 수수료', suffix: '%', value: 10.8, min: 0, max: 40, step: 0.1 },
      { key: 'paymentFee', label: '결제 수수료', suffix: '%', value: 3.3, min: 0, max: 15, step: 0.1 },
      { key: 'shipping', label: '판매자 부담 배송비', suffix: '원', value: 3000, min: 0, step: 100 },
      { key: 'adCost', label: '주문당 광고비', suffix: '원', value: 1800, min: 0, step: 100 },
      { key: 'returnRate', label: '반품/불량률', suffix: '%', value: 3, min: 0, max: 60, step: 0.1 }
    ]
  },
  {
    slug: 'break-even-price',
    group: 'seller',
    title: '손익분기 판매가 계산기',
    shortTitle: '손익분기 판매가',
    description: '원가와 비용을 넣으면 최소 판매가와 목표 마진 판매가를 역산합니다.',
    intent: '최소 판매가 역산',
    inputs: [
      { key: 'cost', label: '원가', suffix: '원', value: 14000, min: 0, step: 100 },
      { key: 'fixedCost', label: '주문당 고정비', suffix: '원', value: 4200, min: 0, step: 100 },
      { key: 'feeRate', label: '총 수수료율', suffix: '%', value: 14, min: 0, max: 50, step: 0.1 },
      { key: 'targetMargin', label: '목표 마진율', suffix: '%', value: 25, min: 0, max: 80, step: 0.1 }
    ]
  },
  {
    slug: 'ad-roas-limit',
    group: 'seller',
    title: '광고비 허용 한도 계산기',
    shortTitle: '광고비 한도',
    description: '목표 이익을 지키면서 주문 1건에 얼마까지 광고비를 쓸 수 있는지 계산합니다.',
    intent: '광고 켜기 전 손실 방지',
    inputs: [
      { key: 'price', label: '판매가', suffix: '원', value: 34900, min: 0, step: 100 },
      { key: 'cost', label: '원가', suffix: '원', value: 16000, min: 0, step: 100 },
      { key: 'feeRate', label: '수수료율', suffix: '%', value: 13.5, min: 0, max: 50, step: 0.1 },
      { key: 'shipping', label: '배송/포장비', suffix: '원', value: 3500, min: 0, step: 100 },
      { key: 'targetProfit', label: '목표 순이익', suffix: '원', value: 5000, min: 0, step: 100 }
    ]
  },
  {
    slug: 'return-loss',
    group: 'seller',
    title: '반품률 반영 순이익 계산기',
    shortTitle: '반품 손실',
    description: '반품률과 반품 1건 손실액을 반영해 월 순이익이 얼마나 깎이는지 봅니다.',
    intent: '반품 많은 상품의 숨은 비용',
    inputs: [
      { key: 'orders', label: '월 주문 수', suffix: '건', value: 120, min: 0, step: 1 },
      { key: 'profitPerOrder', label: '주문당 기본 이익', suffix: '원', value: 7200, min: 0, step: 100 },
      { key: 'returnRate', label: '반품률', suffix: '%', value: 6, min: 0, max: 80, step: 0.1 },
      { key: 'lossPerReturn', label: '반품 1건 손실', suffix: '원', value: 9000, min: 0, step: 100 }
    ]
  },
  {
    slug: 'platform-fee-compare',
    group: 'seller',
    title: '플랫폼 수수료 비교 계산기',
    shortTitle: '수수료 비교',
    description: '두 판매 채널의 수수료와 고정비를 비교해 더 유리한 채널을 계산합니다.',
    intent: '쿠팡/스마트스토어/자사몰 비교',
    inputs: [
      { key: 'price', label: '판매가', suffix: '원', value: 39900, min: 0, step: 100 },
      { key: 'orders', label: '월 주문 수', suffix: '건', value: 200, min: 0, step: 1 },
      { key: 'feeA', label: '채널 A 수수료', suffix: '%', value: 13, min: 0, max: 50, step: 0.1 },
      { key: 'feeB', label: '채널 B 수수료', suffix: '%', value: 6, min: 0, max: 50, step: 0.1 },
      { key: 'fixedB', label: '채널 B 월 고정비', suffix: '원', value: 55000, min: 0, step: 1000 }
    ]
  },
  {
    slug: 'vat-profit',
    group: 'seller',
    title: '부가세 제외 실이익 계산기',
    shortTitle: '부가세 실이익',
    description: '부가세 포함 판매가에서 공급가와 실제 이익을 분리해 계산합니다.',
    intent: '입금액과 실제 이익 혼동 방지',
    inputs: [
      { key: 'grossPrice', label: '부가세 포함 판매가', suffix: '원', value: 55000, min: 0, step: 100 },
      { key: 'cost', label: '부가세 제외 원가', suffix: '원', value: 26000, min: 0, step: 100 },
      { key: 'expense', label: '기타 비용', suffix: '원', value: 8000, min: 0, step: 100 },
      { key: 'vatRate', label: '부가세율', suffix: '%', value: 10, min: 0, max: 20, step: 0.1 }
    ]
  },
  {
    slug: 'discount-margin',
    group: 'seller',
    title: '할인 판매 마진 계산기',
    shortTitle: '할인 마진',
    description: '정가에서 할인을 적용했을 때 수수료와 배송비를 빼고 실제 남는 금액을 계산합니다.',
    intent: '쿠폰·세일 전 손실 방지',
    inputs: [
      { key: 'regularPrice', label: '정가', suffix: '원', value: 39900, min: 0, step: 100 },
      { key: 'discountRate', label: '할인율', suffix: '%', value: 15, min: 0, max: 90, step: 0.1 },
      { key: 'cost', label: '원가', suffix: '원', value: 17000, min: 0, step: 100 },
      { key: 'feeRate', label: '총 수수료율', suffix: '%', value: 13.5, min: 0, max: 50, step: 0.1 },
      { key: 'shipping', label: '배송/포장비', suffix: '원', value: 3500, min: 0, step: 100 },
      { key: 'adCost', label: '주문당 광고비', suffix: '원', value: 1500, min: 0, step: 100 }
    ]
  },
  {
    slug: 'coupon-burden',
    group: 'seller',
    title: '쿠폰 부담 후 마진 계산기',
    shortTitle: '쿠폰 부담',
    description: '쿠폰 금액 중 판매자 부담분을 반영해 정산 기준 매출과 순이익을 계산합니다.',
    intent: '쿠폰행사 참여 전 계산',
    inputs: [
      { key: 'price', label: '상품 판매가', suffix: '원', value: 45900, min: 0, step: 100 },
      { key: 'coupon', label: '쿠폰 금액', suffix: '원', value: 5000, min: 0, step: 100 },
      { key: 'sellerBurdenRate', label: '판매자 부담률', suffix: '%', value: 50, min: 0, max: 100, step: 1 },
      { key: 'cost', label: '원가', suffix: '원', value: 21000, min: 0, step: 100 },
      { key: 'feeRate', label: '수수료율', suffix: '%', value: 12.5, min: 0, max: 50, step: 0.1 },
      { key: 'shipping', label: '배송/포장비', suffix: '원', value: 3500, min: 0, step: 100 }
    ]
  },
  {
    slug: 'bundle-shipping-profit',
    group: 'seller',
    title: '묶음배송 손익 계산기',
    shortTitle: '묶음배송 손익',
    description: '한 주문에 여러 개가 팔릴 때 상품 이익, 수수료, 실제 배송비를 합쳐 손익을 계산합니다.',
    intent: '묶음 구매 손익 비교',
    inputs: [
      { key: 'price', label: '개당 판매가', suffix: '원', value: 12900, min: 0, step: 100 },
      { key: 'cost', label: '개당 원가', suffix: '원', value: 5200, min: 0, step: 100 },
      { key: 'quantity', label: '주문 수량', suffix: '개', value: 3, min: 1, step: 1 },
      { key: 'feeRate', label: '수수료율', suffix: '%', value: 13, min: 0, max: 50, step: 0.1 },
      { key: 'shippingCharge', label: '고객 배송비', suffix: '원', value: 3000, min: 0, step: 100 },
      { key: 'actualShipping', label: '실제 배송/포장비', suffix: '원', value: 4200, min: 0, step: 100 }
    ]
  },
  {
    slug: 'subscription-cut',
    group: 'living',
    title: '월 구독비 절감 계산기',
    shortTitle: '구독비 절감',
    description: '쓰지 않는 구독을 줄였을 때 월/연 절감액과 3년 누적액을 계산합니다.',
    intent: '작은 고정비를 연 단위로 보기',
    inputs: [
      { key: 'monthlyTotal', label: '현재 월 구독비', suffix: '원', value: 89000, min: 0, step: 1000 },
      { key: 'cutRate', label: '줄일 비율', suffix: '%', value: 35, min: 0, max: 100, step: 1 },
      { key: 'newService', label: '새로 남길 필수 구독', suffix: '원', value: 12000, min: 0, step: 1000 }
    ]
  },
  {
    slug: 'internet-switch',
    group: 'living',
    title: '인터넷 갈아타기 손익 계산기',
    shortTitle: '인터넷 갈아타기',
    description: '위약금, 사은품, 월요금 차이를 합쳐 갈아타기가 이득인지 계산합니다.',
    intent: '상담 전 손익 계산',
    inputs: [
      { key: 'penalty', label: '예상 위약금', suffix: '원', value: 180000, min: 0, step: 1000 },
      { key: 'reward', label: '사은품/지원금', suffix: '원', value: 420000, min: 0, step: 1000 },
      { key: 'oldMonthly', label: '기존 월요금', suffix: '원', value: 42000, min: 0, step: 1000 },
      { key: 'newMonthly', label: '새 월요금', suffix: '원', value: 36000, min: 0, step: 1000 },
      { key: 'months', label: '비교 기간', suffix: '개월', value: 36, min: 1, step: 1 }
    ]
  },
  {
    slug: 'rental-total-cost',
    group: 'living',
    title: '렌탈 총비용 계산기',
    shortTitle: '렌탈 총비용',
    description: '정수기, 비데, 공기청정기 렌탈의 약정 총액과 사은품 반영 실부담을 계산합니다.',
    intent: '월요금 말고 총액으로 비교',
    inputs: [
      { key: 'monthly', label: '월 렌탈료', suffix: '원', value: 29900, min: 0, step: 1000 },
      { key: 'months', label: '약정 기간', suffix: '개월', value: 36, min: 1, step: 1 },
      { key: 'install', label: '설치/등록비', suffix: '원', value: 0, min: 0, step: 1000 },
      { key: 'reward', label: '사은품/할인', suffix: '원', value: 150000, min: 0, step: 1000 }
    ]
  },
  {
    slug: 'electricity-cost',
    group: 'living',
    title: '전기요금 예상 계산기',
    shortTitle: '전기요금',
    description: '소비전력과 사용시간으로 월 전력 사용량과 예상 비용을 계산합니다.',
    intent: '계절가전 켜기 전 비용 감 잡기',
    inputs: [
      { key: 'watt', label: '소비전력', suffix: 'W', value: 900, min: 0, step: 10 },
      { key: 'hours', label: '하루 사용 시간', suffix: '시간', value: 6, min: 0, max: 24, step: 0.5 },
      { key: 'days', label: '월 사용일', suffix: '일', value: 30, min: 0, max: 31, step: 1 },
      { key: 'rate', label: 'kWh당 단가', suffix: '원', value: 180, min: 0, step: 1 }
    ]
  },
  {
    slug: 'moving-cost',
    group: 'living',
    title: '이사비용 예산 계산기',
    shortTitle: '이사 예산',
    description: '기본 견적, 옵션, 청소, 중개비, 예비비를 합쳐 이사 총예산을 계산합니다.',
    intent: '견적 외 비용 누락 방지',
    inputs: [
      { key: 'base', label: '이사 기본 견적', suffix: '원', value: 750000, min: 0, step: 10000 },
      { key: 'options', label: '사다리차/에어컨 등 옵션', suffix: '원', value: 180000, min: 0, step: 10000 },
      { key: 'cleaning', label: '청소/폐기 비용', suffix: '원', value: 250000, min: 0, step: 10000 },
      { key: 'brokerage', label: '중개/계약 비용', suffix: '원', value: 400000, min: 0, step: 10000 },
      { key: 'bufferRate', label: '예비비', suffix: '%', value: 10, min: 0, max: 50, step: 1 }
    ]
  },
  {
    slug: 'card-installment',
    group: 'living',
    title: '카드 할부 월납입 계산기',
    shortTitle: '카드 할부',
    description: '할부 원금, 기간, 수수료율로 월 납입액과 총 부담액을 계산합니다.',
    intent: '무이자 아닌 할부 비용',
    inputs: [
      { key: 'price', label: '결제금액', suffix: '원', value: 1200000, min: 0, step: 10000 },
      { key: 'months', label: '할부 기간', suffix: '개월', value: 12, min: 1, max: 60, step: 1 },
      { key: 'annualRate', label: '연 수수료율', suffix: '%', value: 8.5, min: 0, max: 30, step: 0.1 },
      { key: 'upfrontFee', label: '초기 수수료', suffix: '원', value: 0, min: 0, step: 1000 }
    ]
  },
  {
    slug: 'commute-fuel-cost',
    group: 'living',
    title: '출퇴근 유류비 계산기',
    shortTitle: '출퇴근 유류비',
    description: '왕복 거리, 출근일, 연비, 유가로 월 출퇴근 기름값을 계산합니다.',
    intent: '차로 출근할 때 월비용',
    inputs: [
      { key: 'distance', label: '왕복 거리', suffix: 'km', value: 36, min: 0, step: 1 },
      { key: 'days', label: '월 출근일', suffix: '일', value: 22, min: 0, max: 31, step: 1 },
      { key: 'fuelEconomy', label: '연비', suffix: 'km/L', value: 11, min: 1, step: 0.1 },
      { key: 'fuelPrice', label: '유가', suffix: '원/L', value: 1680, min: 0, step: 10 },
      { key: 'parking', label: '월 주차비', suffix: '원', value: 0, min: 0, step: 1000 }
    ]
  },
  {
    slug: 'savings-maturity',
    group: 'living',
    title: '적금 만기 수령액 계산기',
    shortTitle: '적금 만기액',
    description: '월 납입액, 기간, 금리, 이자세금을 반영해 만기 수령액을 계산합니다.',
    intent: '매달 모을 때 만기액',
    inputs: [
      { key: 'monthlyDeposit', label: '월 납입액', suffix: '원', value: 300000, min: 0, step: 10000 },
      { key: 'months', label: '납입 기간', suffix: '개월', value: 24, min: 1, max: 120, step: 1 },
      { key: 'annualRate', label: '연 이율', suffix: '%', value: 3.8, min: 0, max: 20, step: 0.1 },
      { key: 'taxRate', label: '이자 과세율', suffix: '%', value: 15.4, min: 0, max: 30, step: 0.1 }
    ]
  },
  {
    slug: 'loan-interest',
    group: 'utility',
    title: '대출 이자 계산기',
    shortTitle: '대출 이자',
    description: '대출금액, 기간, 금리, 상환방식으로 월 납입액과 총이자를 계산합니다.',
    intent: '월 납입액과 총이자',
    inputs: [
      { key: 'principal', label: '대출금액', suffix: '원', value: 100000000, min: 0, step: 1000000 },
      { key: 'annualRate', label: '연이자율', suffix: '%', value: 4.5, min: 0, max: 30, step: 0.1 },
      { key: 'years', label: '대출기간', suffix: '년', value: 30, min: 1, max: 50, step: 1 },
      {
        key: 'repaymentType',
        label: '상환방식',
        type: 'select',
        value: 'equal-payment',
        options: [
          { label: '원리금균등', value: 'equal-payment' },
          { label: '원금균등', value: 'equal-principal' },
          { label: '만기일시', value: 'bullet' }
        ]
      }
    ]
  },
  {
    slug: 'deposit-interest',
    group: 'utility',
    title: '예금 이자 계산기',
    shortTitle: '예금 이자',
    description: '예치금, 기간, 금리, 이자세금을 반영해 만기 이자와 수령액을 계산합니다.',
    intent: '예금 만기 수령액',
    inputs: [
      { key: 'principal', label: '예치금', suffix: '원', value: 10000000, min: 0, step: 100000 },
      { key: 'months', label: '예치 기간', suffix: '개월', value: 12, min: 1, max: 120, step: 1 },
      { key: 'annualRate', label: '연 이율', suffix: '%', value: 3.6, min: 0, max: 20, step: 0.1 },
      { key: 'taxRate', label: '이자 과세율', suffix: '%', value: 15.4, min: 0, max: 30, step: 0.1 }
    ]
  },
  {
    slug: 'loan-affordability',
    group: 'utility',
    title: '월 납입액 기준 대출금 계산기',
    shortTitle: '대출 가능액',
    description: '감당 가능한 월 납입액에서 금리와 기간을 반영해 대출 원금을 역산합니다.',
    intent: '월 부담에서 대출 규모 역산',
    inputs: [
      { key: 'monthlyPayment', label: '감당 가능한 월 납입액', suffix: '원', value: 700000, min: 0, step: 10000 },
      { key: 'annualRate', label: '연이자율', suffix: '%', value: 4.5, min: 0, max: 30, step: 0.1 },
      { key: 'years', label: '대출기간', suffix: '년', value: 30, min: 1, max: 50, step: 1 },
      { key: 'income', label: '월 실수령 소득', suffix: '원', value: 3500000, min: 0, step: 10000 }
    ]
  },
  {
    slug: 'payback-period',
    group: 'utility',
    title: '투자 회수기간 계산기',
    shortTitle: '회수기간',
    description: '초기 투자비와 월 순현금흐름으로 원금 회수까지 걸리는 기간을 계산합니다.',
    intent: '투자비 회수 시점',
    inputs: [
      { key: 'initialCost', label: '초기 투자비', suffix: '원', value: 5000000, min: 0, step: 100000 },
      { key: 'monthlyRevenue', label: '월 추가 매출', suffix: '원', value: 900000, min: 0, step: 10000 },
      { key: 'monthlyCost', label: '월 추가 비용', suffix: '원', value: 350000, min: 0, step: 10000 },
      { key: 'resaleValue', label: '잔존/회수 가치', suffix: '원', value: 500000, min: 0, step: 10000 }
    ]
  },
  {
    slug: 'hourly-rate',
    group: 'utility',
    title: '시간당 실제 수익 계산기',
    shortTitle: '시간당 수익',
    description: '월 매출, 비용, 투입 시간을 넣어 내 일이 시간당 얼마를 남기는지 계산합니다.',
    intent: '시간당 남는 돈',
    inputs: [
      { key: 'revenue', label: '월 매출', suffix: '원', value: 3000000, min: 0, step: 10000 },
      { key: 'expense', label: '월 비용', suffix: '원', value: 1200000, min: 0, step: 10000 },
      { key: 'hours', label: '월 투입 시간', suffix: '시간', value: 120, min: 1, step: 1 },
      { key: 'taxRate', label: '세금/보험 여유율', suffix: '%', value: 10, min: 0, max: 60, step: 1 }
    ]
  }
];

export function getCalculator(slug: string) {
  return calculators.find((calculator) => calculator.slug === slug);
}

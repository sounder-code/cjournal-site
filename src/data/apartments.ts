import { generatedApartmentComplexes } from './apartments.generated';

export type ApartmentMetricKey =
  | 'totalFeePerM2'
  | 'commonFeePerM2'
  | 'securityFee'
  | 'cleaningFee'
  | 'repairMaintenanceFee'
  | 'heatingFee'
  | 'reserveFee';

export interface ApartmentMetric {
  key: ApartmentMetricKey;
  label: string;
  unit: string;
  shortLabel: string;
}

export interface MonthlyFee {
  month: string;
  totalFeePerM2: number;
  commonFeePerM2: number;
  individualFeePerM2: number;
  reserveFee: number;
  generalManagementFee: number;
  securityFee: number;
  cleaningFee: number;
  repairMaintenanceFee: number;
  elevatorFee: number;
  electricityFee: number;
  waterFee: number;
  heatingFee: number;
  hotWaterFee: number;
}

export interface ApartmentInsight {
  metric: ApartmentMetricKey;
  percentile: number;
  title: string;
  body: string;
}

export interface ApartmentComplex {
  slug: string;
  name: string;
  sido: string;
  sigungu: string;
  dong: string;
  address: string;
  households: number;
  buildings: number;
  approvalYear: number;
  heatingType: string;
  managementType: string;
  latitude?: number;
  longitude?: number;
  peerGroup: string;
  percentileByMetric: Record<ApartmentMetricKey, number>;
  headline: string;
  summary: string;
  insights: ApartmentInsight[];
  monthlyFees: MonthlyFee[];
  nearbySlugs: string[];
}

export const apartmentMetrics: ApartmentMetric[] = [
  { key: 'totalFeePerM2', label: '총 관리비', unit: '원/m2', shortLabel: '총액' },
  { key: 'commonFeePerM2', label: '공용관리비', unit: '원/m2', shortLabel: '공용' },
  { key: 'securityFee', label: '경비비', unit: '원/m2', shortLabel: '경비' },
  { key: 'cleaningFee', label: '청소비', unit: '원/m2', shortLabel: '청소' },
  { key: 'repairMaintenanceFee', label: '수선유지비', unit: '원/m2', shortLabel: '수선' },
  { key: 'heatingFee', label: '난방비', unit: '원/m2', shortLabel: '난방' },
  { key: 'reserveFee', label: '장기수선충당금', unit: '원/m2', shortLabel: '충당금' }
];

const makeFees = (
  base: Omit<MonthlyFee, 'month'>,
  drift: Partial<Record<keyof Omit<MonthlyFee, 'month'>, number>> = {}
): MonthlyFee[] => {
  const months = [
    '2025-07',
    '2025-08',
    '2025-09',
    '2025-10',
    '2025-11',
    '2025-12',
    '2026-01',
    '2026-02',
    '2026-03',
    '2026-04',
    '2026-05',
    '2026-06'
  ];

  return months.map((month, index) => {
    const winter = month.endsWith('-12') || month.endsWith('-01') || month.endsWith('-02');
    const summer = month.endsWith('-07') || month.endsWith('-08');
    const ratio = 0.94 + index * 0.012;
    const seasonalHeat = winter ? 1.42 : summer ? 0.76 : 0.92;
    const seasonalElectric = summer ? 1.2 : winter ? 1.04 : 0.96;
    const row = {} as MonthlyFee;

    for (const key of Object.keys(base) as Array<keyof Omit<MonthlyFee, 'month'>>) {
      let multiplier = ratio + (drift[key] ?? 0);
      if (key === 'heatingFee') multiplier *= seasonalHeat;
      if (key === 'electricityFee') multiplier *= seasonalElectric;
      row[key] = Math.round(base[key] * multiplier);
    }

    row.month = month;
    row.totalFeePerM2 =
      row.commonFeePerM2 + row.individualFeePerM2 + row.reserveFee;
    return row;
  });
};

const sampleApartmentComplexes: ApartmentComplex[] = [
  {
    slug: 'mapo-riverview-sample',
    name: '마포 리버뷰 샘플단지',
    sido: '서울',
    sigungu: '마포구',
    dong: '아현동',
    address: '서울 마포구 아현동 샘플로 12',
    households: 1120,
    buildings: 14,
    approvalYear: 2014,
    heatingType: '지역난방',
    managementType: '위탁관리',
    peerGroup: '서울 마포구 · 1000세대 이상 · 지역난방 · 10~20년차',
    percentileByMetric: {
      totalFeePerM2: 78,
      commonFeePerM2: 84,
      securityFee: 88,
      cleaningFee: 61,
      repairMaintenanceFee: 69,
      heatingFee: 72,
      reserveFee: 46
    },
    headline: '공용관리비와 경비비가 비교군보다 높은 편',
    summary:
      '총 관리비는 비교군 상위권에 가깝고, 특히 경비비와 공용관리비가 차이를 만드는 항목으로 보입니다.',
    insights: [
      {
        metric: 'securityFee',
        percentile: 88,
        title: '경비비 확인 필요',
        body: '경비비가 비슷한 단지 대비 높은 구간입니다. 근무 형태와 위탁 계약 조건을 확인해볼 만합니다.'
      },
      {
        metric: 'reserveFee',
        percentile: 46,
        title: '충당금은 평균권',
        body: '장기수선충당금은 비교군 중간 수준입니다. 월 부담을 볼 때 수선 적립 항목도 함께 봐야 합니다.'
      }
    ],
    monthlyFees: makeFees({
      totalFeePerM2: 0,
      commonFeePerM2: 1840,
      individualFeePerM2: 1380,
      reserveFee: 210,
      generalManagementFee: 520,
      securityFee: 450,
      cleaningFee: 210,
      repairMaintenanceFee: 170,
      elevatorFee: 95,
      electricityFee: 360,
      waterFee: 130,
      heatingFee: 440,
      hotWaterFee: 120
    }),
    nearbySlugs: ['seongsu-forest-sample', 'yeouido-central-sample', 'eunpyeong-hill-sample']
  },
  {
    slug: 'seongsu-forest-sample',
    name: '성수 포레스트 샘플단지',
    sido: '서울',
    sigungu: '성동구',
    dong: '성수동',
    address: '서울 성동구 성수동 샘플길 8',
    households: 720,
    buildings: 9,
    approvalYear: 2021,
    heatingType: '개별난방',
    managementType: '위탁관리',
    peerGroup: '서울 성동구 · 500~999세대 · 개별난방 · 0~5년차',
    percentileByMetric: {
      totalFeePerM2: 64,
      commonFeePerM2: 58,
      securityFee: 63,
      cleaningFee: 55,
      repairMaintenanceFee: 42,
      heatingFee: 39,
      reserveFee: 68
    },
    headline: '신축 단지 평균권, 충당금은 다소 높은 편',
    summary:
      '총 관리비는 평균보다 약간 높은 수준이며, 신축 단지 특성상 장기수선충당금 비중을 같이 보는 것이 좋습니다.',
    insights: [
      {
        metric: 'reserveFee',
        percentile: 68,
        title: '충당금 비중 점검',
        body: '장기수선충당금이 비교군 평균보다 높습니다. 낮은 월 관리비만 비교할 때 놓치기 쉬운 항목입니다.'
      },
      {
        metric: 'heatingFee',
        percentile: 39,
        title: '난방비는 낮은 구간',
        body: '난방비는 비교군 하위권입니다. 개별난방 단지는 세대 사용량에 따라 실제 청구액 차이가 커질 수 있습니다.'
      }
    ],
    monthlyFees: makeFees({
      totalFeePerM2: 0,
      commonFeePerM2: 1620,
      individualFeePerM2: 1280,
      reserveFee: 260,
      generalManagementFee: 470,
      securityFee: 360,
      cleaningFee: 190,
      repairMaintenanceFee: 120,
      elevatorFee: 110,
      electricityFee: 420,
      waterFee: 120,
      heatingFee: 250,
      hotWaterFee: 90
    }),
    nearbySlugs: ['mapo-riverview-sample', 'songpa-lake-sample', 'gwacheon-green-sample']
  },
  {
    slug: 'songpa-lake-sample',
    name: '송파 레이크 샘플단지',
    sido: '서울',
    sigungu: '송파구',
    dong: '잠실동',
    address: '서울 송파구 잠실동 샘플대로 55',
    households: 1860,
    buildings: 21,
    approvalYear: 2008,
    heatingType: '지역난방',
    managementType: '자치관리',
    peerGroup: '서울 송파구 · 1500세대 이상 · 지역난방 · 11~20년차',
    percentileByMetric: {
      totalFeePerM2: 82,
      commonFeePerM2: 77,
      securityFee: 73,
      cleaningFee: 68,
      repairMaintenanceFee: 86,
      heatingFee: 79,
      reserveFee: 74
    },
    headline: '수선유지비와 겨울 난방비 변동이 큰 편',
    summary:
      '대단지임에도 총 관리비가 높은 편이며, 수선유지비와 난방비가 월별 변동의 핵심입니다.',
    insights: [
      {
        metric: 'repairMaintenanceFee',
        percentile: 86,
        title: '수선유지비 상위권',
        body: '준공연차가 있는 단지는 수선유지비가 올라갈 수 있습니다. 최근 보수 공사 여부를 함께 확인해야 합니다.'
      },
      {
        metric: 'heatingFee',
        percentile: 79,
        title: '난방비 상승폭 주의',
        body: '겨울철 난방비가 비교군보다 높은 구간입니다. 같은 난방방식의 작년 동월과 비교하는 것이 유효합니다.'
      }
    ],
    monthlyFees: makeFees(
      {
        totalFeePerM2: 0,
        commonFeePerM2: 1780,
        individualFeePerM2: 1510,
        reserveFee: 300,
        generalManagementFee: 510,
        securityFee: 390,
        cleaningFee: 230,
        repairMaintenanceFee: 240,
        elevatorFee: 120,
        electricityFee: 430,
        waterFee: 150,
        heatingFee: 520,
        hotWaterFee: 150
      },
      { repairMaintenanceFee: 0.04, heatingFee: 0.06 }
    ),
    nearbySlugs: ['seongsu-forest-sample', 'gwacheon-green-sample', 'bundang-park-sample']
  },
  {
    slug: 'eunpyeong-hill-sample',
    name: '은평 힐 샘플단지',
    sido: '서울',
    sigungu: '은평구',
    dong: '진관동',
    address: '서울 은평구 진관동 샘플로 31',
    households: 540,
    buildings: 7,
    approvalYear: 2010,
    heatingType: '개별난방',
    managementType: '위탁관리',
    peerGroup: '서울 은평구 · 500~999세대 · 개별난방 · 11~20년차',
    percentileByMetric: {
      totalFeePerM2: 43,
      commonFeePerM2: 48,
      securityFee: 44,
      cleaningFee: 51,
      repairMaintenanceFee: 55,
      heatingFee: 36,
      reserveFee: 31
    },
    headline: '총액은 평균권 아래, 충당금은 낮은 편',
    summary:
      '월 부담은 상대적으로 낮지만 준공연차를 고려하면 장기수선충당금 적립 수준을 같이 봐야 합니다.',
    insights: [
      {
        metric: 'reserveFee',
        percentile: 31,
        title: '충당금 낮은 구간',
        body: '준공 10년 이상 단지에서 충당금이 낮으면 향후 보수 계획과 적립 기준을 확인하는 것이 좋습니다.'
      },
      {
        metric: 'totalFeePerM2',
        percentile: 43,
        title: '총액은 부담 낮음',
        body: '총 관리비는 비교군 중간보다 낮은 편입니다. 낮은 총액의 원인이 어떤 항목인지 분해해 봐야 합니다.'
      }
    ],
    monthlyFees: makeFees({
      totalFeePerM2: 0,
      commonFeePerM2: 1450,
      individualFeePerM2: 1160,
      reserveFee: 150,
      generalManagementFee: 430,
      securityFee: 290,
      cleaningFee: 175,
      repairMaintenanceFee: 145,
      elevatorFee: 80,
      electricityFee: 330,
      waterFee: 110,
      heatingFee: 240,
      hotWaterFee: 70
    }),
    nearbySlugs: ['mapo-riverview-sample', 'ilsan-river-sample', 'bundang-park-sample']
  },
  {
    slug: 'bundang-park-sample',
    name: '분당 파크 샘플단지',
    sido: '경기',
    sigungu: '성남시 분당구',
    dong: '정자동',
    address: '경기 성남시 분당구 정자동 샘플길 44',
    households: 980,
    buildings: 12,
    approvalYear: 2002,
    heatingType: '지역난방',
    managementType: '위탁관리',
    peerGroup: '경기 성남시 분당구 · 500~999세대 · 지역난방 · 21~30년차',
    percentileByMetric: {
      totalFeePerM2: 71,
      commonFeePerM2: 66,
      securityFee: 62,
      cleaningFee: 57,
      repairMaintenanceFee: 82,
      heatingFee: 74,
      reserveFee: 69
    },
    headline: '노후도 영향으로 수선유지비 비중이 커짐',
    summary:
      '총액은 높은 편이며, 준공연차 대비 수선유지비와 난방비를 함께 해석해야 하는 단지입니다.',
    insights: [
      {
        metric: 'repairMaintenanceFee',
        percentile: 82,
        title: '수선유지비 높은 편',
        body: '준공 20년 이상 단지는 수선유지비가 관리비를 끌어올릴 수 있습니다. 일시적 공사비인지 추세인지 봐야 합니다.'
      },
      {
        metric: 'reserveFee',
        percentile: 69,
        title: '충당금은 보통보다 높음',
        body: '장기수선충당금은 비교군 평균보다 높습니다. 낮은 단지보다 월 부담은 커도 향후 보수 재원 측면에서는 확인 가치가 있습니다.'
      }
    ],
    monthlyFees: makeFees({
      totalFeePerM2: 0,
      commonFeePerM2: 1710,
      individualFeePerM2: 1410,
      reserveFee: 280,
      generalManagementFee: 490,
      securityFee: 350,
      cleaningFee: 200,
      repairMaintenanceFee: 260,
      elevatorFee: 90,
      electricityFee: 370,
      waterFee: 135,
      heatingFee: 470,
      hotWaterFee: 125
    }),
    nearbySlugs: ['songpa-lake-sample', 'gwacheon-green-sample', 'eunpyeong-hill-sample']
  },
  {
    slug: 'ilsan-river-sample',
    name: '일산 리버 샘플단지',
    sido: '경기',
    sigungu: '고양시 일산동구',
    dong: '장항동',
    address: '경기 고양시 일산동구 장항동 샘플로 19',
    households: 1340,
    buildings: 15,
    approvalYear: 2017,
    heatingType: '지역난방',
    managementType: '위탁관리',
    peerGroup: '경기 고양시 일산동구 · 1000세대 이상 · 지역난방 · 6~10년차',
    percentileByMetric: {
      totalFeePerM2: 34,
      commonFeePerM2: 32,
      securityFee: 38,
      cleaningFee: 41,
      repairMaintenanceFee: 35,
      heatingFee: 33,
      reserveFee: 52
    },
    headline: '대단지 효과로 공용관리비가 낮은 편',
    summary:
      '총 관리비와 공용관리비 모두 비교군보다 낮습니다. 대단지 규모 효과가 나타나는 샘플입니다.',
    insights: [
      {
        metric: 'commonFeePerM2',
        percentile: 32,
        title: '공용관리비 낮음',
        body: '비슷한 단지 대비 공용관리비가 낮은 구간입니다. 세대수가 많을수록 세대당 공용비가 분산될 수 있습니다.'
      },
      {
        metric: 'reserveFee',
        percentile: 52,
        title: '충당금은 평균권',
        body: '장기수선충당금은 비교군 중간 수준이라 총액이 낮아도 적립 항목이 과도하게 낮지는 않습니다.'
      }
    ],
    monthlyFees: makeFees({
      totalFeePerM2: 0,
      commonFeePerM2: 1320,
      individualFeePerM2: 1120,
      reserveFee: 210,
      generalManagementFee: 390,
      securityFee: 270,
      cleaningFee: 160,
      repairMaintenanceFee: 115,
      elevatorFee: 70,
      electricityFee: 310,
      waterFee: 110,
      heatingFee: 330,
      hotWaterFee: 90
    }),
    nearbySlugs: ['eunpyeong-hill-sample', 'mapo-riverview-sample', 'bundang-park-sample']
  },
  {
    slug: 'gwacheon-green-sample',
    name: '과천 그린 샘플단지',
    sido: '경기',
    sigungu: '과천시',
    dong: '원문동',
    address: '경기 과천시 원문동 샘플대로 7',
    households: 430,
    buildings: 6,
    approvalYear: 1999,
    heatingType: '개별난방',
    managementType: '자치관리',
    peerGroup: '경기 과천시 · 300~499세대 · 개별난방 · 21~30년차',
    percentileByMetric: {
      totalFeePerM2: 91,
      commonFeePerM2: 89,
      securityFee: 84,
      cleaningFee: 81,
      repairMaintenanceFee: 93,
      heatingFee: 62,
      reserveFee: 77
    },
    headline: '소규모 노후 단지 특성상 공용·수선 비용이 높음',
    summary:
      '총 관리비가 매우 높은 구간이며, 세대수 규모와 준공연차를 고려한 공용비·수선비 해석이 필요합니다.',
    insights: [
      {
        metric: 'repairMaintenanceFee',
        percentile: 93,
        title: '수선유지비 매우 높음',
        body: '수선유지비가 비교군 최상위권입니다. 특정 월 공사비인지, 반복적 추세인지 확인해야 합니다.'
      },
      {
        metric: 'commonFeePerM2',
        percentile: 89,
        title: '공용관리비 높음',
        body: '소규모 단지는 공용 인력과 설비 비용이 세대당 높게 배분될 수 있습니다.'
      }
    ],
    monthlyFees: makeFees(
      {
        totalFeePerM2: 0,
        commonFeePerM2: 2050,
        individualFeePerM2: 1340,
        reserveFee: 330,
        generalManagementFee: 590,
        securityFee: 460,
        cleaningFee: 260,
        repairMaintenanceFee: 320,
        elevatorFee: 115,
        electricityFee: 390,
        waterFee: 125,
        heatingFee: 310,
        hotWaterFee: 95
      },
      { repairMaintenanceFee: 0.08 }
    ),
    nearbySlugs: ['bundang-park-sample', 'songpa-lake-sample', 'seongsu-forest-sample']
  },
  {
    slug: 'yeouido-central-sample',
    name: '여의도 센트럴 샘플단지',
    sido: '서울',
    sigungu: '영등포구',
    dong: '여의도동',
    address: '서울 영등포구 여의도동 샘플로 2',
    households: 620,
    buildings: 8,
    approvalYear: 2016,
    heatingType: '중앙난방',
    managementType: '위탁관리',
    peerGroup: '서울 영등포구 · 500~999세대 · 중앙난방 · 6~10년차',
    percentileByMetric: {
      totalFeePerM2: 87,
      commonFeePerM2: 72,
      securityFee: 67,
      cleaningFee: 59,
      repairMaintenanceFee: 61,
      heatingFee: 92,
      reserveFee: 58
    },
    headline: '총액 상승의 핵심은 난방비',
    summary:
      '총 관리비가 높은 편이며, 중앙난방 특성상 겨울철 난방비가 결과를 크게 좌우합니다.',
    insights: [
      {
        metric: 'heatingFee',
        percentile: 92,
        title: '난방비 최상위권',
        body: '난방비가 비교군 최상위권입니다. 월별 사용량보다 공급 방식과 단지 배분 기준이 영향을 줄 수 있습니다.'
      },
      {
        metric: 'commonFeePerM2',
        percentile: 72,
        title: '공용비도 평균보다 높음',
        body: '공용관리비도 평균보다 높아 총액 부담을 함께 키우는 구조입니다.'
      }
    ],
    monthlyFees: makeFees(
      {
        totalFeePerM2: 0,
        commonFeePerM2: 1740,
        individualFeePerM2: 1670,
        reserveFee: 235,
        generalManagementFee: 500,
        securityFee: 380,
        cleaningFee: 205,
        repairMaintenanceFee: 175,
        elevatorFee: 100,
        electricityFee: 410,
        waterFee: 145,
        heatingFee: 710,
        hotWaterFee: 155
      },
      { heatingFee: 0.09 }
    ),
    nearbySlugs: ['mapo-riverview-sample', 'songpa-lake-sample', 'seongsu-forest-sample']
  }
];

export const apartmentComplexes: ApartmentComplex[] =
  generatedApartmentComplexes.length > 0 ? generatedApartmentComplexes : sampleApartmentComplexes;

export const apartmentRegions = Array.from(
  new Set(apartmentComplexes.map((apartment) => `${apartment.sido} ${apartment.sigungu}`))
).sort();

export const findApartment = (slug: string) =>
  apartmentComplexes.find((apartment) => apartment.slug === slug);

export const getLatestFee = (apartment: ApartmentComplex) =>
  apartment.monthlyFees[apartment.monthlyFees.length - 1];

export const getMetric = (key: ApartmentMetricKey) =>
  apartmentMetrics.find((metric) => metric.key === key) ?? apartmentMetrics[0];

export const getTopInsightMetrics = (apartment: ApartmentComplex, limit = 3) =>
  apartmentMetrics
    .map((metric) => ({
      ...metric,
      percentile: apartment.percentileByMetric[metric.key],
      value: getLatestFee(apartment)[metric.key]
    }))
    .filter((metric) => metric.value > 0)
    .sort((a, b) => b.percentile - a.percentile)
    .slice(0, limit);

export const getNearbyApartments = (apartment: ApartmentComplex) =>
  apartment.nearbySlugs
    .map((slug) => findApartment(slug))
    .filter((item): item is ApartmentComplex => Boolean(item));

export const getHouseholdBand = (households: number) => {
  if (households < 300) return '300세대 미만';
  if (households < 500) return '300~499세대';
  if (households < 1000) return '500~999세대';
  if (households < 1500) return '1000~1499세대';
  return '1500세대 이상';
};

export const getFeeBand = (percentile: number) => {
  if (percentile >= 85) return 'very-high';
  if (percentile >= 65) return 'high';
  if (percentile <= 35) return 'low';
  return 'average';
};

export const feeBandLabels: Record<ReturnType<typeof getFeeBand>, string> = {
  'very-high': '매우 높은 편',
  high: '높은 편',
  average: '평균권',
  low: '낮은 편'
};

export const formatWon = (value: number) => `${value.toLocaleString('ko-KR')}원`;

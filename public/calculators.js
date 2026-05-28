const formatWon = (value) =>
  `${Math.round(Number.isFinite(value) ? value : 0).toLocaleString('ko-KR')}원`;

const formatPercent = (value) =>
  `${(Number.isFinite(value) ? value : 0).toLocaleString('ko-KR', {
    maximumFractionDigits: 1
  })}%`;

const clampRate = (value) => Math.max(0, Math.min(95, value));

function readInputs(root) {
  const values = {};
  root.querySelectorAll('[data-calc-input]').forEach((input) => {
    values[input.name] = Number(input.value || 0);
  });
  return values;
}

function sellerMargin(v) {
  const fee = v.price * ((v.platformFee + v.paymentFee) / 100);
  const returnLoss = v.price * (v.returnRate / 100) * 0.35;
  const net = v.price - v.cost - fee - v.shipping - v.adCost - returnLoss;
  const margin = v.price > 0 ? (net / v.price) * 100 : 0;
  const breakEven = (v.cost + v.shipping + v.adCost + returnLoss) / (1 - clampRate(v.platformFee + v.paymentFee) / 100);
  const maxAd = Math.max(0, v.price - v.cost - fee - v.shipping - returnLoss);
  return {
    primary: net,
    primaryLabel: '주문당 순이익',
    metrics: [
      ['마진율', formatPercent(margin)],
      ['손익분기 판매가', formatWon(breakEven)],
      ['광고비 최대치', formatWon(maxAd)],
      ['주문당 수수료', formatWon(fee)]
    ],
    status: net > 5000 ? '좋음' : net > 0 ? '주의' : '손실',
    note: net > 0 ? '이 구조는 이익이 남지만 광고비와 반품률이 오르면 바로 흔들릴 수 있습니다.' : '현재 입력값에서는 팔수록 손실이 납니다. 판매가나 비용 구조를 다시 잡아야 합니다.'
  };
}

function breakEvenPrice(v) {
  const denominator = 1 - clampRate(v.feeRate + v.targetMargin) / 100;
  const targetPrice = denominator > 0 ? (v.cost + v.fixedCost) / denominator : 0;
  const minPrice = (v.cost + v.fixedCost) / (1 - clampRate(v.feeRate) / 100);
  return {
    primary: targetPrice,
    primaryLabel: '목표 마진 판매가',
    metrics: [
      ['최소 손익분기', formatWon(minPrice)],
      ['목표 마진', formatPercent(v.targetMargin)],
      ['주문당 비용 합계', formatWon(v.cost + v.fixedCost)],
      ['총 수수료율', formatPercent(v.feeRate)]
    ],
    status: targetPrice > minPrice ? '계산 완료' : '주의',
    note: '목표 마진율을 올릴수록 필요한 판매가는 비선형으로 올라갑니다.'
  };
}

function adRoasLimit(v) {
  const fee = v.price * (v.feeRate / 100);
  const maxAd = Math.max(0, v.price - v.cost - fee - v.shipping - v.targetProfit);
  const roas = maxAd > 0 ? (v.price / maxAd) * 100 : 0;
  return {
    primary: maxAd,
    primaryLabel: '주문당 광고비 한도',
    metrics: [
      ['필요 ROAS', formatPercent(roas)],
      ['광고 전 이익', formatWon(v.price - v.cost - fee - v.shipping)],
      ['목표 순이익', formatWon(v.targetProfit)],
      ['수수료', formatWon(fee)]
    ],
    status: maxAd > 0 ? '광고 가능' : '광고 위험',
    note: maxAd <= 0 ? '광고비를 쓰기 전에 판매가 또는 원가 구조를 먼저 고쳐야 합니다.' : '실제 운영에서는 클릭 단가보다 주문당 광고비 기준으로 보는 편이 안전합니다.'
  };
}

function returnLoss(v) {
  const returned = v.orders * (v.returnRate / 100);
  const gross = v.orders * v.profitPerOrder;
  const loss = returned * v.lossPerReturn;
  const net = gross - loss;
  return {
    primary: net,
    primaryLabel: '반품 반영 월 순이익',
    metrics: [
      ['월 반품 예상', `${returned.toFixed(1)}건`],
      ['반품 손실', formatWon(loss)],
      ['반품 전 이익', formatWon(gross)],
      ['이익 감소율', formatPercent(gross > 0 ? (loss / gross) * 100 : 0)]
    ],
    status: net > 0 ? '유지 가능' : '손실',
    note: '반품률이 높은 상품은 주문당 이익보다 반품 1건 손실을 먼저 줄여야 합니다.'
  };
}

function platformCompare(v) {
  const costA = v.price * v.orders * (v.feeA / 100);
  const costB = v.price * v.orders * (v.feeB / 100) + v.fixedB;
  const diff = costA - costB;
  return {
    primary: Math.abs(diff),
    primaryLabel: diff >= 0 ? '채널 B가 더 절감' : '채널 A가 더 절감',
    metrics: [
      ['채널 A 월 수수료', formatWon(costA)],
      ['채널 B 월 비용', formatWon(costB)],
      ['월 주문 수', `${v.orders.toLocaleString('ko-KR')}건`],
      ['차이', formatWon(diff)]
    ],
    status: diff >= 0 ? 'B 유리' : 'A 유리',
    note: '고정비가 있는 채널은 주문 수가 늘어날수록 유리해질 수 있습니다.'
  };
}

function vatProfit(v) {
  const supply = v.grossPrice / (1 + v.vatRate / 100);
  const vat = v.grossPrice - supply;
  const profit = supply - v.cost - v.expense;
  return {
    primary: profit,
    primaryLabel: '부가세 제외 실이익',
    metrics: [
      ['공급가', formatWon(supply)],
      ['부가세', formatWon(vat)],
      ['비용 합계', formatWon(v.cost + v.expense)],
      ['실마진율', formatPercent(supply > 0 ? (profit / supply) * 100 : 0)]
    ],
    status: profit > 0 ? '이익' : '손실',
    note: '부가세 포함 입금액을 그대로 이익으로 보면 마진을 과대평가하기 쉽습니다.'
  };
}

function subscriptionCut(v) {
  const cut = Math.max(0, v.monthlyTotal * (v.cutRate / 100) - v.newService);
  return {
    primary: cut,
    primaryLabel: '월 절감액',
    metrics: [
      ['연 절감액', formatWon(cut * 12)],
      ['3년 누적', formatWon(cut * 36)],
      ['남기는 구독', formatWon(v.monthlyTotal - cut)],
      ['절감 비율', formatPercent(v.monthlyTotal > 0 ? (cut / v.monthlyTotal) * 100 : 0)]
    ],
    status: cut > 0 ? '절감 가능' : '효과 낮음',
    note: '구독비는 월 단위보다 1년, 3년 누적으로 볼 때 줄일 이유가 더 선명해집니다.'
  };
}

function internetSwitch(v) {
  const monthlySaving = v.oldMonthly - v.newMonthly;
  const benefit = v.reward - v.penalty + monthlySaving * v.months;
  return {
    primary: benefit,
    primaryLabel: '갈아타기 순이익',
    metrics: [
      ['월요금 차이', formatWon(monthlySaving)],
      ['기간 절감액', formatWon(monthlySaving * v.months)],
      ['사은품 반영', formatWon(v.reward)],
      ['위약금', formatWon(v.penalty)]
    ],
    status: benefit > 0 ? '갈아타기 유리' : '유지 유리',
    note: benefit > 0 ? '숫자상으로는 변경이 유리합니다. 설치비와 결합할인 변화도 확인하세요.' : '현재 조건에서는 위약금과 월요금 차이를 감안하면 유지가 나을 수 있습니다.'
  };
}

function rentalTotalCost(v) {
  const total = v.monthly * v.months + v.install - v.reward;
  return {
    primary: total,
    primaryLabel: '약정 실부담 총액',
    metrics: [
      ['약정 총 렌탈료', formatWon(v.monthly * v.months)],
      ['월 실부담', formatWon(total / Math.max(1, v.months))],
      ['설치/등록비', formatWon(v.install)],
      ['할인/사은품', formatWon(v.reward)]
    ],
    status: '총액 확인',
    note: '월요금이 낮아도 약정 기간과 등록비를 합치면 총액 순위가 바뀔 수 있습니다.'
  };
}

function electricityCost(v) {
  const kwh = (v.watt * v.hours * v.days) / 1000;
  const cost = kwh * v.rate;
  return {
    primary: cost,
    primaryLabel: '월 예상 전기요금',
    metrics: [
      ['월 사용량', `${kwh.toFixed(1)}kWh`],
      ['하루 비용', formatWon(cost / Math.max(1, v.days))],
      ['연속 3개월', formatWon(cost * 3)],
      ['적용 단가', `${v.rate.toLocaleString('ko-KR')}원/kWh`]
    ],
    status: cost > 50000 ? '사용량 큼' : '보통',
    note: '실제 전기요금은 누진 구간과 기본요금에 따라 달라질 수 있습니다.'
  };
}

function movingCost(v) {
  const subtotal = v.base + v.options + v.cleaning + v.brokerage;
  const buffer = subtotal * (v.bufferRate / 100);
  return {
    primary: subtotal + buffer,
    primaryLabel: '이사 총예산',
    metrics: [
      ['확정 비용 합계', formatWon(subtotal)],
      ['예비비', formatWon(buffer)],
      ['옵션/청소', formatWon(v.options + v.cleaning)],
      ['중개/계약', formatWon(v.brokerage)]
    ],
    status: '예산 확보',
    note: '이사비는 당일 옵션과 폐기 비용이 붙기 쉬워 예비비를 따로 잡는 편이 안전합니다.'
  };
}

function loanInterest(v) {
  const monthlyInterest = v.principal * (v.annualRate / 100 / 12);
  return {
    primary: monthlyInterest,
    primaryLabel: '월 이자 부담',
    metrics: [
      ['연 이자', formatWon(monthlyInterest * 12)],
      ['기간 총이자', formatWon(monthlyInterest * v.months)],
      ['월 이율', formatPercent(v.annualRate / 12)],
      ['원금', formatWon(v.principal)]
    ],
    status: monthlyInterest > 100000 ? '부담 큼' : '확인',
    note: '원리금균등 상환액이 아니라 단순 월 이자 부담을 빠르게 보는 계산입니다.'
  };
}

function hourlyRate(v) {
  const net = (v.revenue - v.expense) * (1 - v.taxRate / 100);
  const hourly = net / Math.max(1, v.hours);
  return {
    primary: hourly,
    primaryLabel: '시간당 실제 수익',
    metrics: [
      ['월 순수익', formatWon(net)],
      ['비용 차감 전', formatWon(v.revenue - v.expense)],
      ['일 8시간 기준', `${(v.hours / 8).toFixed(1)}일`],
      ['여유율', formatPercent(v.taxRate)]
    ],
    status: hourly > 20000 ? '유지 가능' : '개선 필요',
    note: '매출보다 시간당 실제 수익을 보면 상품 가격이나 업무 방식을 바꿔야 할지 보입니다.'
  };
}

const calculators = {
  'seller-margin': sellerMargin,
  'break-even-price': breakEvenPrice,
  'ad-roas-limit': adRoasLimit,
  'return-loss': returnLoss,
  'platform-fee-compare': platformCompare,
  'vat-profit': vatProfit,
  'subscription-cut': subscriptionCut,
  'internet-switch': internetSwitch,
  'rental-total-cost': rentalTotalCost,
  'electricity-cost': electricityCost,
  'moving-cost': movingCost,
  'loan-interest': loanInterest,
  'hourly-rate': hourlyRate
};

function render(root, result) {
  const primary = root.querySelector('[data-result-primary]');
  const primaryLabel = root.querySelector('[data-result-primary-label]');
  const metrics = root.querySelector('[data-result-metrics]');
  const status = root.querySelector('[data-result-status]');
  const note = root.querySelector('[data-result-note]');

  if (primary) primary.textContent = formatWon(result.primary);
  if (primaryLabel) primaryLabel.textContent = result.primaryLabel;
  if (status) status.textContent = result.status;
  if (note) note.textContent = result.note;
  if (metrics) {
    metrics.innerHTML = result.metrics
      .map(([label, value]) => `<div class="metric-row"><span>${label}</span><strong>${value}</strong></div>`)
      .join('');
  }
}

function setupCalculator(root) {
  const slug = root.dataset.calculator;
  const calculate = calculators[slug] || sellerMargin;
  const update = () => render(root, calculate(readInputs(root)));
  root.addEventListener('input', update);
  root.querySelector('[data-reset]')?.addEventListener('click', () => {
    root.querySelectorAll('[data-calc-input]').forEach((input) => {
      input.value = input.dataset.default || input.value;
    });
    update();
  });
  update();
}

document.querySelectorAll('[data-calculator]').forEach(setupCalculator);

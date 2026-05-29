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
    values[input.name] = input.tagName === 'SELECT' ? input.value : Number(input.value || 0);
  });
  return values;
}

function repaymentTypeLabel(value) {
  if (value === 'equal-principal') return '원금균등';
  if (value === 'bullet') return '만기일시';
  return '원리금균등';
}

function summarizeSchedule(rows, months) {
  if (rows.length <= 13) return rows;
  return [...rows.slice(0, 12), rows[months - 1]];
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

function discountMargin(v) {
  const salePrice = v.regularPrice * (1 - clampRate(v.discountRate) / 100);
  const fee = salePrice * (v.feeRate / 100);
  const net = salePrice - v.cost - fee - v.shipping - v.adCost;
  const margin = salePrice > 0 ? (net / salePrice) * 100 : 0;
  return {
    primary: net,
    primaryLabel: '할인 후 주문당 순이익',
    metrics: [
      ['할인 판매가', formatWon(salePrice)],
      ['마진율', formatPercent(margin)],
      ['수수료', formatWon(fee)],
      ['할인액', formatWon(v.regularPrice - salePrice)]
    ],
    status: net > 3000 ? '판매 가능' : net > 0 ? '주의' : '손실',
    note: net > 0 ? '할인 후에도 이익은 남지만 광고비나 반품이 붙으면 마진이 더 줄어듭니다.' : '현재 할인율에서는 판매할수록 손실이 납니다. 할인율이나 원가 구조를 다시 확인하세요.'
  };
}

function couponBurden(v) {
  const sellerCoupon = v.coupon * (v.sellerBurdenRate / 100);
  const customerPrice = Math.max(0, v.price - v.coupon);
  const settlement = Math.max(0, v.price - sellerCoupon);
  const fee = settlement * (v.feeRate / 100);
  const net = settlement - v.cost - fee - v.shipping;
  const margin = settlement > 0 ? (net / settlement) * 100 : 0;
  return {
    primary: net,
    primaryLabel: '쿠폰 반영 순이익',
    metrics: [
      ['고객 결제 예상', formatWon(customerPrice)],
      ['판매자 쿠폰 부담', formatWon(sellerCoupon)],
      ['정산 기준 매출', formatWon(settlement)],
      ['마진율', formatPercent(margin)]
    ],
    status: net > 3000 ? '참여 가능' : net > 0 ? '주의' : '손실',
    note: '플랫폼 쿠폰은 부담 주체에 따라 정산액이 달라집니다. 실제 정산 정책을 확인하고 입력값을 맞추세요.'
  };
}

function bundleShippingProfit(v) {
  const quantity = Math.max(1, Math.round(v.quantity));
  const revenue = v.price * quantity + v.shippingCharge;
  const productRevenue = v.price * quantity;
  const productCost = v.cost * quantity;
  const fee = productRevenue * (v.feeRate / 100);
  const net = revenue - productCost - fee - v.actualShipping;
  return {
    primary: net,
    primaryLabel: '묶음 주문 순이익',
    metrics: [
      ['개당 환산 이익', formatWon(net / quantity)],
      ['상품 매출', formatWon(productRevenue)],
      ['상품 원가', formatWon(productCost)],
      ['배송비 차이', formatWon(v.shippingCharge - v.actualShipping)]
    ],
    status: net > 5000 ? '좋음' : net > 0 ? '주의' : '손실',
    note: '묶음배송은 객단가가 올라가지만 중량 증가로 실제 배송비가 올라가면 이익이 줄 수 있습니다.'
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

function cardInstallment(v) {
  const months = Math.max(1, Math.round(v.months));
  const monthlyRate = Math.max(0, v.annualRate) / 100 / 12;
  const payment =
    monthlyRate === 0
      ? v.price / months
      : v.price * ((monthlyRate * (1 + monthlyRate) ** months) / ((1 + monthlyRate) ** months - 1));
  const totalInstallment = payment * months;
  const total = totalInstallment + v.upfrontFee;
  return {
    primary: payment,
    primaryLabel: '예상 월 납입액',
    metrics: [
      ['총 납입액', formatWon(total)],
      ['할부 수수료', formatWon(totalInstallment - v.price)],
      ['초기 수수료', formatWon(v.upfrontFee)],
      ['할부 기간', `${months.toLocaleString('ko-KR')}개월`]
    ],
    status: totalInstallment > v.price ? '수수료 확인' : '무이자',
    note: '카드사별 할부 수수료율과 청구 방식은 다를 수 있으니 실제 청구 조건과 비교하세요.'
  };
}

function commuteFuelCost(v) {
  const monthlyKm = v.distance * v.days;
  const liters = monthlyKm / Math.max(1, v.fuelEconomy);
  const fuelCost = liters * v.fuelPrice;
  const total = fuelCost + v.parking;
  return {
    primary: total,
    primaryLabel: '월 출퇴근 차량비',
    metrics: [
      ['월 주행거리', `${monthlyKm.toLocaleString('ko-KR')}km`],
      ['예상 주유량', `${liters.toFixed(1)}L`],
      ['순수 유류비', formatWon(fuelCost)],
      ['일 평균 비용', formatWon(total / Math.max(1, v.days))]
    ],
    status: total > 250000 ? '비용 큼' : '계산 완료',
    note: '보험료, 정비비, 감가상각까지 넣으면 실제 차량 유지비는 더 커질 수 있습니다.'
  };
}

function savingsMaturity(v) {
  const months = Math.max(1, Math.round(v.months));
  const principal = v.monthlyDeposit * months;
  const monthlyRate = Math.max(0, v.annualRate) / 100 / 12;
  const interest = v.monthlyDeposit * monthlyRate * ((months * (months + 1)) / 2);
  const tax = interest * (v.taxRate / 100);
  const afterTaxInterest = interest - tax;
  return {
    primary: principal + afterTaxInterest,
    primaryLabel: '예상 만기 수령액',
    metrics: [
      ['납입 원금', formatWon(principal)],
      ['세전 이자', formatWon(interest)],
      ['이자세금', formatWon(tax)],
      ['세후 이자', formatWon(afterTaxInterest)]
    ],
    status: '만기액 확인',
    note: '일반적인 월 납입 적금의 단리 계산입니다. 실제 상품은 납입일과 우대금리에 따라 달라질 수 있습니다.'
  };
}

function loanInterest(v) {
  const principal = Math.max(0, v.principal);
  const months = Math.max(1, Math.round(v.years * 12));
  const monthlyRate = Math.max(0, v.annualRate) / 100 / 12;
  let firstPayment = 0;
  let lastPayment = 0;
  let totalPayment = 0;
  let totalInterest = 0;
  let scheduleRows = [];

  if (v.repaymentType === 'bullet') {
    const monthlyInterest = principal * monthlyRate;
    firstPayment = monthlyInterest;
    lastPayment = principal + monthlyInterest;
    totalInterest = monthlyInterest * months;
    totalPayment = principal + totalInterest;
    scheduleRows = Array.from({ length: months }, (_, index) => {
      const isLast = index === months - 1;
      return {
        month: index + 1,
        payment: isLast ? lastPayment : monthlyInterest,
        principal: isLast ? principal : 0,
        interest: monthlyInterest,
        balance: isLast ? 0 : principal
      };
    });
  } else if (v.repaymentType === 'equal-principal') {
    const monthlyPrincipal = principal / months;
    firstPayment = monthlyPrincipal + principal * monthlyRate;
    lastPayment = monthlyPrincipal + monthlyPrincipal * monthlyRate;
    totalInterest = 0;
    scheduleRows = [];
    for (let i = 0; i < months; i += 1) {
      const remaining = principal - monthlyPrincipal * i;
      const interest = remaining * monthlyRate;
      const payment = monthlyPrincipal + interest;
      const balance = Math.max(0, principal - monthlyPrincipal * (i + 1));
      totalInterest += interest;
      scheduleRows.push({
        month: i + 1,
        payment,
        principal: monthlyPrincipal,
        interest,
        balance
      });
    }
    totalPayment = principal + totalInterest;
  } else {
    if (monthlyRate === 0) {
      firstPayment = principal / months;
    } else {
      const factor = (monthlyRate * (1 + monthlyRate) ** months) / ((1 + monthlyRate) ** months - 1);
      firstPayment = principal * factor;
    }
    lastPayment = firstPayment;
    totalPayment = firstPayment * months;
    totalInterest = totalPayment - principal;
    let balance = principal;
    scheduleRows = [];
    for (let i = 0; i < months; i += 1) {
      const interest = balance * monthlyRate;
      const principalPaid = i === months - 1 ? balance : Math.max(0, firstPayment - interest);
      balance = Math.max(0, balance - principalPaid);
      scheduleRows.push({
        month: i + 1,
        payment: firstPayment,
        principal: principalPaid,
        interest,
        balance
      });
    }
  }

  return {
    primary: firstPayment,
    primaryLabel: v.repaymentType === 'bullet' ? '월 이자 납입액' : '예상 월 납입액',
    metrics: [
      ['총 이자', formatWon(totalInterest)],
      ['총 상환액', formatWon(totalPayment)],
      ['상환 기간', `${months.toLocaleString('ko-KR')}개월`],
      ['상환 방식', repaymentTypeLabel(v.repaymentType)],
      ...(v.repaymentType === 'equal-principal' ? [['마지막 월 납입액', formatWon(lastPayment)]] : []),
      ...(v.repaymentType === 'bullet' ? [['만기월 납입액', formatWon(lastPayment)]] : [])
    ],
    status: totalInterest > principal * 0.5 ? '이자 부담 큼' : '계산 완료',
    schedule: {
      title: '상환 흐름',
      note: months > 13 ? '1~12개월과 마지막 회차를 표시합니다. 이자와 원금 비중은 매월 달라집니다.' : '전체 회차를 표시합니다. 이자와 원금 비중은 매월 달라집니다.',
      rows: summarizeSchedule(scheduleRows, months)
    },
    note:
      v.repaymentType === 'equal-payment'
        ? '원리금균등은 매월 납입액은 같지만, 초반에는 이자 비중이 크고 시간이 갈수록 원금 상환 비중이 커집니다.'
        : v.repaymentType === 'equal-principal'
          ? '원금균등은 초반 납입액이 크지만 시간이 갈수록 월 납입액이 줄어듭니다.'
          : '만기일시는 기간 중 이자만 내고 만기월에 원금을 함께 갚는 방식입니다.'
  };
}

function depositInterest(v) {
  const months = Math.max(1, Math.round(v.months));
  const interest = v.principal * (Math.max(0, v.annualRate) / 100) * (months / 12);
  const tax = interest * (v.taxRate / 100);
  const afterTaxInterest = interest - tax;
  return {
    primary: v.principal + afterTaxInterest,
    primaryLabel: '예상 만기 수령액',
    metrics: [
      ['세전 이자', formatWon(interest)],
      ['이자세금', formatWon(tax)],
      ['세후 이자', formatWon(afterTaxInterest)],
      ['예치 기간', `${months.toLocaleString('ko-KR')}개월`]
    ],
    status: '이자 확인',
    note: '단리 예금 기준 계산입니다. 월복리, 중도해지, 우대금리는 실제 상품 조건에 맞춰 다시 확인하세요.'
  };
}

function loanAffordability(v) {
  const months = Math.max(1, Math.round(v.years * 12));
  const monthlyRate = Math.max(0, v.annualRate) / 100 / 12;
  const principal =
    monthlyRate === 0
      ? v.monthlyPayment * months
      : v.monthlyPayment * ((1 - (1 + monthlyRate) ** -months) / monthlyRate);
  const totalPayment = v.monthlyPayment * months;
  const paymentRatio = v.income > 0 ? (v.monthlyPayment / v.income) * 100 : 0;
  return {
    primary: principal,
    primaryLabel: '역산 대출 원금',
    metrics: [
      ['총 납입액', formatWon(totalPayment)],
      ['예상 총이자', formatWon(totalPayment - principal)],
      ['상환 기간', `${months.toLocaleString('ko-KR')}개월`],
      ['소득 대비 납입률', formatPercent(paymentRatio)]
    ],
    status: paymentRatio > 35 ? '부담 큼' : '계산 완료',
    note: '월 납입액을 기준으로 원리금균등 대출 원금을 역산합니다. 실제 한도는 DSR, 신용, 담보 조건에 따라 달라집니다.'
  };
}

function paybackPeriod(v) {
  const netInvestment = Math.max(0, v.initialCost - v.resaleValue);
  const monthlyCashflow = v.monthlyRevenue - v.monthlyCost;
  const months = monthlyCashflow > 0 ? netInvestment / monthlyCashflow : Infinity;
  return {
    primary: Number.isFinite(months) ? months : 0,
    primaryLabel: '예상 회수기간',
    metrics: [
      ['월 순현금흐름', formatWon(monthlyCashflow)],
      ['회수 대상 투자비', formatWon(netInvestment)],
      ['연 순현금흐름', formatWon(monthlyCashflow * 12)],
      ['회수 후 월 이익', formatWon(Math.max(0, monthlyCashflow))]
    ],
    status: monthlyCashflow <= 0 ? '회수 불가' : months <= 12 ? '빠른 회수' : months <= 36 ? '검토 가능' : '부담 큼',
    note: monthlyCashflow <= 0 ? '월 순현금흐름이 0원 이하라 투자비를 회수할 수 없습니다.' : `약 ${months.toFixed(1)}개월 뒤 초기 투자비를 회수하는 구조입니다.`
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
  'discount-margin': discountMargin,
  'coupon-burden': couponBurden,
  'bundle-shipping-profit': bundleShippingProfit,
  'subscription-cut': subscriptionCut,
  'internet-switch': internetSwitch,
  'rental-total-cost': rentalTotalCost,
  'electricity-cost': electricityCost,
  'moving-cost': movingCost,
  'card-installment': cardInstallment,
  'commute-fuel-cost': commuteFuelCost,
  'savings-maturity': savingsMaturity,
  'loan-interest': loanInterest,
  'deposit-interest': depositInterest,
  'loan-affordability': loanAffordability,
  'payback-period': paybackPeriod,
  'hourly-rate': hourlyRate
};

function render(root, result) {
  const primary = root.querySelector('[data-result-primary]');
  const primaryLabel = root.querySelector('[data-result-primary-label]');
  const metrics = root.querySelector('[data-result-metrics]');
  const status = root.querySelector('[data-result-status]');
  const note = root.querySelector('[data-result-note]');
  const schedule = root.querySelector('[data-result-schedule]');
  const panel = root.querySelector('.result-panel');
  const displayPrimary = result.primaryLabel.includes('회수기간') ? `${result.primary.toFixed(1)}개월` : formatWon(result.primary);
  const tone = /손실|위험|주의|부담 큼|개선 필요|효과 낮음|유지 유리/.test(result.status)
    ? /손실|위험|개선 필요/.test(result.status)
      ? 'bad'
      : 'warn'
    : 'good';

  if (primary) primary.textContent = displayPrimary;
  if (primaryLabel) primaryLabel.textContent = result.primaryLabel;
  if (status) status.textContent = result.status;
  if (note) note.textContent = result.note;
  if (panel) panel.dataset.tone = tone;
  root.dataset.resultSummary = [
    `${result.primaryLabel}: ${displayPrimary}`,
    `상태: ${result.status}`,
    ...result.metrics.map(([label, value]) => `${label}: ${value}`),
    result.note
  ].join('\n');
  if (metrics) {
    metrics.innerHTML = result.metrics
      .map(([label, value]) => `<div class="metric-row"><span>${label}</span><strong>${value}</strong></div>`)
      .join('');
  }
  if (schedule) {
    if (!result.schedule?.rows?.length) {
      schedule.hidden = true;
      schedule.innerHTML = '';
    } else {
      schedule.hidden = false;
      schedule.innerHTML = `
        <h3>${result.schedule.title}</h3>
        <table class="schedule-table">
          <thead>
            <tr>
              <th>회차</th>
              <th>납입액</th>
              <th>원금</th>
              <th>이자</th>
              <th>잔금</th>
            </tr>
          </thead>
          <tbody>
            ${result.schedule.rows
              .map(
                (row) => `
                  <tr>
                    <td>${row.month}개월</td>
                    <td>${formatWon(row.payment)}</td>
                    <td>${formatWon(row.principal)}</td>
                    <td>${formatWon(row.interest)}</td>
                    <td>${formatWon(row.balance)}</td>
                  </tr>
                `
              )
              .join('')}
          </tbody>
        </table>
        <p class="schedule-note">${result.schedule.note}</p>
      `;
    }
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
  root.querySelector('[data-result-copy]')?.addEventListener('click', async () => {
    const feedback = root.querySelector('[data-result-feedback]');
    const summary = root.dataset.resultSummary || '';
    try {
      await navigator.clipboard.writeText(summary);
      if (feedback) feedback.textContent = '복사했습니다';
    } catch {
      if (feedback) feedback.textContent = '복사할 수 없습니다';
    }
    window.setTimeout(() => {
      if (feedback) feedback.textContent = '';
    }, 1800);
  });
  update();
}

document.querySelectorAll('[data-calculator]').forEach(setupCalculator);

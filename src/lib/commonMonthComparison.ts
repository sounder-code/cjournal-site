type Comparable = { comparisonMonths?: Array<[string, number, number, number]> };

export function commonMonthComparison<T extends Comparable>(items: T[]) {
  if (!items.length) return { month: null, items: [] };
  const month = (items[0].comparisonMonths || []).map((fee) => fee[0])
    .filter((month) => items.every((item) => item.comparisonMonths?.some((fee) => fee[0] === month)))
    .sort().at(-1);
  if (!month) return { month: null, items: [] };
  return { month, items: items.map((item) => {
    const fee = item.comparisonMonths!.find((fee) => fee[0] === month)!;
    return { ...item, lm: month, tf: fee[1], cf: fee[2], rf: fee[3] };
  }) };
}

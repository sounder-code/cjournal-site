/** Match the bulk validator: signed detail adjustments remain allowed. */
export const hasNegativeFeeAggregate = (total: number, common: number) =>
  total < 0 || common < 0;

import type { ApartmentEntry } from './apartmentBulk';

export const districtSegment = (district: string) => district || '전체';

export const regionHubPath = (province: string) =>
  `/apartments/regions/${province}/`;

export const districtHubPath = (province: string, district: string) =>
  `/apartments/regions/${province}/${districtSegment(district)}/`;

export const median = (values: number[]) => {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

export const latestTotal = (apartment: ApartmentEntry) =>
  Number(apartment.f.at(-1)?.[1] ?? apartment.tf ?? 0);

export const apartmentMedian = (apartments: ApartmentEntry[]) =>
  median(apartments.map(latestTotal));

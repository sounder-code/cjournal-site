export interface ApartmentLocation {
  code: string;
  sido: string;
  sigungu: string;
}

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface AdminCenter {
  province: string;
  district: string;
  latitude: number;
  longitude: number;
}

export interface CoordinateValidationStats {
  thresholdKm: number;
  sourceCoordinates: number;
  validCoordinates: number;
  missingCoordinates: number;
  malformedCoordinates: number;
  outOfBoundsCoordinates: number;
  districtCenterMissing: number;
  distanceInvalidCoordinates: number;
  invalidCoordinates: number;
  excludedFromMap: number;
  repeatedCoordinateGroups: number;
  repeatedCoordinateComplexes: number;
  suspiciousRepeatedCoordinateGroups: number;
  suspiciousRepeatedCoordinates: number;
  suspiciousRepeatedInvalidCoordinates: number;
  orphanCoordinates: number;
}

export interface CoordinateValidationResult {
  validCoordinates: Map<string, Coordinate>;
  invalidReasons: Map<string, string[]>;
  stats: CoordinateValidationStats;
}

const gwangjuDistricts = new Set(['광산구', '남구', '동구', '북구', '서구']);

export const normalizeAdminProvince = (province: string, district: string) => {
  if (province !== '전남광주통합특별시') return province;
  return gwangjuDistricts.has(district) ? '광주광역시' : '전라남도';
};

export const normalizeAdminDistrict = (district: string) =>
  String(district || '').replace(/시/g, '').replace(/\s+/g, '');

export const adminDistrictKey = (province: string, district: string) =>
  `${province}|${normalizeAdminDistrict(district)}`;

export const distanceKm = (origin: Coordinate, destination: Coordinate) => {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(destination.latitude - origin.latitude);
  const longitudeDelta = radians(destination.longitude - origin.longitude);
  const latitudeArc = Math.sin(latitudeDelta / 2);
  const longitudeArc = Math.sin(longitudeDelta / 2);
  const haversine =
    latitudeArc * latitudeArc +
    Math.cos(radians(origin.latitude)) *
      Math.cos(radians(destination.latitude)) *
      longitudeArc *
      longitudeArc;
  return 12742 * Math.asin(Math.sqrt(haversine));
};

const coordinateKey = (coordinate: Coordinate) =>
  `${coordinate.latitude.toFixed(5)},${coordinate.longitude.toFixed(5)}`;

const isFiniteCoordinate = (coordinate: Coordinate | undefined): coordinate is Coordinate =>
  Boolean(
    coordinate &&
      Number.isFinite(Number(coordinate.latitude)) &&
      Number.isFinite(Number(coordinate.longitude))
  );

const isInsideKoreaBounds = (coordinate: Coordinate) =>
  coordinate.latitude >= 32 &&
  coordinate.latitude <= 40 &&
  coordinate.longitude >= 123 &&
  coordinate.longitude <= 133;

export const validateApartmentCoordinates = ({
  apartments,
  coordinates,
  adminCenters,
  thresholdKm = 80
}: {
  apartments: ApartmentLocation[];
  coordinates: Record<string, Coordinate>;
  adminCenters: AdminCenter[];
  thresholdKm?: number;
}): CoordinateValidationResult => {
  const apartmentCodes = new Set(apartments.map((apartment) => apartment.code));
  const centers = new Map<string, Coordinate>();
  for (const center of adminCenters) {
    const province = normalizeAdminProvince(center.province, center.district);
    centers.set(adminDistrictKey(province, center.district), {
      latitude: Number(center.latitude),
      longitude: Number(center.longitude)
    });
  }

  const repeated = new Map<string, ApartmentLocation[]>();
  let sourceCoordinates = 0;
  let missingCoordinates = 0;
  let malformedCoordinates = 0;
  for (const apartment of apartments) {
    const coordinate = coordinates[apartment.code];
    if (!coordinate) {
      missingCoordinates += 1;
      continue;
    }
    sourceCoordinates += 1;
    if (!isFiniteCoordinate(coordinate)) {
      malformedCoordinates += 1;
      continue;
    }
    const key = coordinateKey(coordinate);
    repeated.set(key, [...(repeated.get(key) ?? []), apartment]);
  }

  const repeatedGroups = [...repeated.values()].filter((group) => group.length > 1);
  const suspiciousRepeatedKeys = new Set(
    [...repeated.entries()]
      .filter(([, group]) => {
        if (group.length < 2) return false;
        return new Set(group.map((item) => adminDistrictKey(item.sido, item.sigungu))).size > 1;
      })
      .map(([key]) => key)
  );
  const suspiciousRepeatedCoordinates = [...suspiciousRepeatedKeys].reduce(
    (sum, key) => sum + (repeated.get(key)?.length ?? 0),
    0
  );

  const validCoordinates = new Map<string, Coordinate>();
  const invalidReasons = new Map<string, string[]>();
  let outOfBoundsCoordinates = 0;
  let districtCenterMissing = 0;
  let distanceInvalidCoordinates = 0;

  for (const apartment of apartments) {
    const rawCoordinate = coordinates[apartment.code];
    if (!rawCoordinate || !isFiniteCoordinate(rawCoordinate)) continue;
    const coordinate = {
      latitude: Number(rawCoordinate.latitude),
      longitude: Number(rawCoordinate.longitude)
    };
    const reasons: string[] = [];
    if (!isInsideKoreaBounds(coordinate)) {
      reasons.push('out-of-bounds');
      outOfBoundsCoordinates += 1;
    }

    let center = centers.get(adminDistrictKey(apartment.sido, apartment.sigungu));
    if (!center && apartment.sido === '세종특별자치시' && !apartment.sigungu) {
      center = centers.get(adminDistrictKey(apartment.sido, '세종시'));
    }
    if (!center) {
      reasons.push('district-center-missing');
      districtCenterMissing += 1;
    } else if (distanceKm(coordinate, center) >= thresholdKm) {
      reasons.push('district-distance');
      distanceInvalidCoordinates += 1;
    }

    if (reasons.length) invalidReasons.set(apartment.code, reasons);
    else validCoordinates.set(apartment.code, coordinate);
  }

  const invalidCoordinates = invalidReasons.size + malformedCoordinates;
  const suspiciousRepeatedInvalidCoordinates = [...invalidReasons.keys()].filter((code) => {
    const coordinate = coordinates[code];
    return isFiniteCoordinate(coordinate) && suspiciousRepeatedKeys.has(coordinateKey(coordinate));
  }).length;
  return {
    validCoordinates,
    invalidReasons,
    stats: {
      thresholdKm,
      sourceCoordinates,
      validCoordinates: validCoordinates.size,
      missingCoordinates,
      malformedCoordinates,
      outOfBoundsCoordinates,
      districtCenterMissing,
      distanceInvalidCoordinates,
      invalidCoordinates,
      excludedFromMap: missingCoordinates + invalidCoordinates,
      repeatedCoordinateGroups: repeatedGroups.length,
      repeatedCoordinateComplexes: repeatedGroups.reduce((sum, group) => sum + group.length, 0),
      suspiciousRepeatedCoordinateGroups: suspiciousRepeatedKeys.size,
      suspiciousRepeatedCoordinates,
      suspiciousRepeatedInvalidCoordinates,
      orphanCoordinates: Object.keys(coordinates).filter((code) => !apartmentCodes.has(code)).length
    }
  };
};

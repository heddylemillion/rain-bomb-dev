export const DEFAULT_INITIAL_POINT = {
  lat: 13.7563,
  lon: 100.5018,
} as const;

export function haversineDistanceKm(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number
): number {
  const radians = (degrees: number): number => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(latitude2 - latitude1);
  const longitudeDelta = radians(longitude2 - longitude1);
  const angle = 2 * Math.asin(
    Math.sqrt(
      Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(radians(latitude1)) *
          Math.cos(radians(latitude2)) *
          Math.sin(longitudeDelta / 2) ** 2
    )
  );
  return 6371 * angle;
}

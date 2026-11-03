import type { WeatherApiClient } from '../../services/openMeteoSdk.js';

export type WeatherApiResponses = Awaited<ReturnType<WeatherApiClient>>;

export interface MockHourlySeriesInput {
  startUnixSec: number;
  intervalSec?: number;
  count: number;
  variables: ReadonlyArray<ReadonlyArray<number | null>>;
  latitude?: number;
  longitude?: number;
  elevation?: number;
  utcOffsetSeconds?: number;
}

export function buildMockWeatherApiResponses(input: MockHourlySeriesInput): WeatherApiResponses {
  const interval = input.intervalSec ?? 3600;
  const startSec = BigInt(Math.floor(input.startUnixSec));
  const endSec = startSec + BigInt(input.count * interval);
  const variableArrays = input.variables.map((series) =>
    Float32Array.from(series.map((v) => (v === null ? Number.NaN : v)))
  );

  const mockResponse = {
    latitude: () => input.latitude ?? 13.75,
    longitude: () => input.longitude ?? 100.5,
    elevation: () => input.elevation ?? 4,
    utcOffsetSeconds: () => input.utcOffsetSeconds ?? 25200,
    hourly: () => ({
      interval: () => interval,
      time: () => startSec,
      timeEnd: () => endSec,
      variablesLength: () => variableArrays.length,
      variables: (index: number) => {
        const arr = variableArrays[index];
        return arr ? { valuesArray: () => arr } : null;
      },
    }),
  };

  return [mockResponse as unknown as WeatherApiResponses[number]];
}

export interface MockForecastOptions {
  temperature?: (hourOffset: number) => number | null;
  precipitation?: (hourOffset: number) => number | null;
  precipitationProbability?: (hourOffset: number) => number | null;
  humidity?: (hourOffset: number) => number | null;
  pressureMsl?: (hourOffset: number) => number | null;
  windSpeed?: (hourOffset: number) => number | null;
  latitude?: number;
  longitude?: number;
  elevation?: number;
}

/**
 * Builds 28 hourly slots (-3h through +24h relative to currentHourFloor)
 * matching fetchOpenMeteoForecast(past_hours: 3, forecast_hours: 25).
 */
export function buildMockForecastResponses(
  nowMs: number,
  options: MockForecastOptions = {}
): WeatherApiResponses {
  const currentHourSec = Math.floor(nowMs / 3_600_000) * 3600;
  const startUnixSec = currentHourSec - 3 * 3600;
  const count = 28;
  const offsets = Array.from({ length: count }, (_, idx) => idx - 3);

  return buildMockWeatherApiResponses({
    startUnixSec,
    count,
    ...(options.latitude !== undefined ? { latitude: options.latitude } : {}),
    ...(options.longitude !== undefined ? { longitude: options.longitude } : {}),
    ...(options.elevation !== undefined ? { elevation: options.elevation } : {}),
    variables: [
      offsets.map((h) => (options.temperature ? options.temperature(h) : 29.5)),
      offsets.map((h) => (options.precipitation ? options.precipitation(h) : h >= 0 && h < 3 ? 2 : 0.2)),
      offsets.map((h) => (options.precipitationProbability ? options.precipitationProbability(h) : h >= 0 && h < 3 ? 80 : 10)),
      offsets.map((h) => (options.humidity ? options.humidity(h) : 85)),
      offsets.map((h) => (options.pressureMsl ? options.pressureMsl(h) : 1010 - (h + 3) * 0.5)),
      offsets.map((h) => (options.windSpeed ? options.windSpeed(h) : 12)),
    ],
  });
}

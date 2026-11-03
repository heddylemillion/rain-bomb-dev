import { fetchWeatherApi } from 'openmeteo';

export type WeatherApiClient = typeof fetchWeatherApi;

export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';

export const FORECAST_HOURLY_VARIABLES = [
  'temperature_2m',
  'precipitation',
  'precipitation_probability',
  'relative_humidity_2m',
  'pressure_msl',
  'wind_speed_10m',
] as const;

export const MARINE_HOURLY_VARIABLES = [
  'sea_level_height_msl',
  'wave_height',
] as const;

export interface OpenMeteoForecastData {
  latitude: number;
  longitude: number;
  elevationM: number | null;
  utcOffsetSeconds: number;
  hourly: {
    time: string[];
    temperature_2m: Array<number | null>;
    precipitation: Array<number | null>;
    precipitation_probability: Array<number | null>;
    relative_humidity_2m: Array<number | null>;
    pressure_msl: Array<number | null>;
    wind_speed_10m: Array<number | null>;
  };
}

export interface OpenMeteoMarineData {
  latitude: number;
  longitude: number;
  elevationM: number | null;
  utcOffsetSeconds: number;
  hourly: {
    time: string[];
    sea_level_height_msl: Array<number | null>;
    wave_height: Array<number | null>;
  };
}

export interface OpenMeteoCallOptions {
  weatherApi?: WeatherApiClient;
  timeoutMs?: number;
  retries?: number;
}

function cleanFloat32(values: Float32Array | null | undefined, index: number): number | null {
  const raw = values?.[index];
  if (raw === undefined || !Number.isFinite(raw)) return null;
  return Math.round(raw * 100) / 100;
}

function normalizeOpenMeteoError(error: unknown, serviceLabel: string): Error {
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return new Error(`หมดเวลารอข้อมูลจาก ${serviceLabel}`);
    }
    if (/limit|quota|too many|429/iu.test(error.message)) {
      return new Error(`โควตาการเรียก ${serviceLabel} อาจเต็มแล้ว`);
    }
    if (/[\u0E00-\u0E7F]/u.test(error.message)) {
      return error;
    }
  }
  return new Error(`เชื่อมต่อ ${serviceLabel} ไม่สำเร็จ`);
}

export async function fetchOpenMeteoForecast(
  lat: number,
  lon: number,
  options: OpenMeteoCallOptions = {}
): Promise<OpenMeteoForecastData> {
  const weatherApi = options.weatherApi ?? fetchWeatherApi;
  const timeoutMs = options.timeoutMs ?? 8000;
  const retries = options.retries ?? 1;
  const params = {
    latitude: lat,
    longitude: lon,
    hourly: FORECAST_HOURLY_VARIABLES.join(','),
    past_hours: 3,
    forecast_hours: 25,
    timezone: 'Asia/Bangkok',
  };

  let responses;
  try {
    responses = await weatherApi(
      OPEN_METEO_FORECAST_URL,
      params,
      retries,
      0.2,
      2,
      { signal: AbortSignal.timeout(timeoutMs) }
    );
  } catch (error: unknown) {
    throw normalizeOpenMeteoError(error, 'Open-Meteo');
  }

  const response = responses[0];
  const hourly = response?.hourly();
  if (!response || !hourly) {
    throw new Error('รูปแบบข้อมูลพยากรณ์จาก Open-Meteo ไม่ถูกต้อง');
  }

  const interval = hourly.interval();
  const startSec = Number(hourly.time());
  const endSec = Number(hourly.timeEnd());
  const count = interval > 0 ? Math.max(0, Math.floor((endSec - startSec) / interval)) : 0;

  // Variable indices strictly match FORECAST_HOURLY_VARIABLES order
  const temperatureArr = hourly.variables(0)?.valuesArray();
  const precipitationArr = hourly.variables(1)?.valuesArray();
  const popArr = hourly.variables(2)?.valuesArray();
  const humidityArr = hourly.variables(3)?.valuesArray();
  const pressureArr = hourly.variables(4)?.valuesArray();
  const windArr = hourly.variables(5)?.valuesArray();

  const time = Array.from(
    { length: count },
    (_, i) => new Date((startSec + i * interval) * 1000).toISOString()
  );

  const rawElevation = response.elevation();

  return {
    latitude: response.latitude(),
    longitude: response.longitude(),
    elevationM: Number.isFinite(rawElevation) ? Math.round(rawElevation * 100) / 100 : null,
    utcOffsetSeconds: response.utcOffsetSeconds(),
    hourly: {
      time,
      temperature_2m: Array.from({ length: count }, (_, i) => cleanFloat32(temperatureArr, i)),
      precipitation: Array.from({ length: count }, (_, i) => cleanFloat32(precipitationArr, i)),
      precipitation_probability: Array.from({ length: count }, (_, i) => cleanFloat32(popArr, i)),
      relative_humidity_2m: Array.from({ length: count }, (_, i) => cleanFloat32(humidityArr, i)),
      pressure_msl: Array.from({ length: count }, (_, i) => cleanFloat32(pressureArr, i)),
      wind_speed_10m: Array.from({ length: count }, (_, i) => cleanFloat32(windArr, i)),
    },
  };
}

export async function fetchOpenMeteoMarine(
  lat: number,
  lon: number,
  options: OpenMeteoCallOptions = {}
): Promise<OpenMeteoMarineData> {
  const weatherApi = options.weatherApi ?? fetchWeatherApi;
  const timeoutMs = options.timeoutMs ?? 8000;
  const retries = options.retries ?? 1;
  const params = {
    latitude: lat,
    longitude: lon,
    hourly: MARINE_HOURLY_VARIABLES.join(','),
    forecast_days: 7,
    timezone: 'Asia/Bangkok',
  };

  let responses;
  try {
    responses = await weatherApi(
      OPEN_METEO_MARINE_URL,
      params,
      retries,
      0.2,
      2,
      { signal: AbortSignal.timeout(timeoutMs) }
    );
  } catch (error: unknown) {
    throw normalizeOpenMeteoError(error, 'Open-Meteo Marine');
  }

  const response = responses[0];
  const hourly = response?.hourly();
  if (!response || !hourly) {
    throw new Error('รูปแบบพยากรณ์จาก Open-Meteo Marine ไม่ถูกต้อง');
  }

  const interval = hourly.interval();
  const startSec = Number(hourly.time());
  const endSec = Number(hourly.timeEnd());
  const count = interval > 0 ? Math.max(0, Math.floor((endSec - startSec) / interval)) : 0;

  // Variable indices strictly match MARINE_HOURLY_VARIABLES order
  const seaLevelArr = hourly.variables(0)?.valuesArray();
  const waveHeightArr = hourly.variables(1)?.valuesArray();

  const time = Array.from(
    { length: count },
    (_, i) => new Date((startSec + i * interval) * 1000).toISOString()
  );

  const rawElevation = response.elevation();

  return {
    latitude: response.latitude(),
    longitude: response.longitude(),
    elevationM: Number.isFinite(rawElevation) ? Math.round(rawElevation * 100) / 100 : null,
    utcOffsetSeconds: response.utcOffsetSeconds(),
    hourly: {
      time,
      sea_level_height_msl: Array.from({ length: count }, (_, i) => cleanFloat32(seaLevelArr, i)),
      wave_height: Array.from({ length: count }, (_, i) => cleanFloat32(waveHeightArr, i)),
    },
  };
}

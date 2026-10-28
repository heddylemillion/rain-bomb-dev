import type {
  XweatherConditionEnvelope,
  XweatherForecastEnvelope,
  XweatherObservationEnvelope,
} from '../schemas/xweather.schema.js';
import type {
  CommunityConfig,
  CommunityWeatherBundle,
  NormalizedCurrentWeather,
  NormalizedDailyForecastPoint,
  NormalizedHourlyForecastPoint,
} from '../types/weather.js';

export const DECISION_SUPPORT_DISCLAIMER_TH =
  'ข้อมูลความเสี่ยงนี้ใช้เพื่อประกอบการตัดสินใจเบื้องต้นของชุมชนเท่านั้น ไม่ใช่ประกาศเตือนภัยอย่างเป็นทางการจากทางราชการ';

export function normalizeHourlyForecast(
  envelope: XweatherForecastEnvelope
): NormalizedHourlyForecastPoint[] {
  const firstLocation = envelope.response[0];
  if (!firstLocation) {
    return [];
  }

  return firstLocation.periods.map((p) => ({
    timestamp: p.timestamp,
    dateTimeISO: p.dateTimeISO,
    tempC: p.tempC ?? p.avgTempC ?? null,
    feelslikeC: p.feelslikeC ?? p.avgFeelslikeC ?? null,
    dewpointC: p.dewpointC ?? p.avgDewpointC ?? null,
    humidity: p.humidity ?? null,
    pressureMB: p.pressureMB ?? null,
    pop: p.pop,
    precipMM: p.precipMM,
    windSpeedKPH: p.windSpeedKPH ?? null,
    windGustKPH: p.windGustKPH ?? null,
    windDir: p.windDir ?? null,
    sky: p.sky ?? null,
    weather: p.weatherPrimary ?? p.weather ?? null,
    weatherPrimaryCoded: p.weatherPrimaryCoded ?? null,
    icon: p.icon ?? null,
    isDay: p.isDay ?? null,
  }));
}

export function normalizeDailyForecast(
  envelope: XweatherForecastEnvelope
): NormalizedDailyForecastPoint[] {
  const firstLocation = envelope.response[0];
  if (!firstLocation) {
    return [];
  }

  return firstLocation.periods.map((p) => ({
    timestamp: p.timestamp,
    dateTimeISO: p.dateTimeISO,
    maxTempC: p.maxTempC ?? null,
    minTempC: p.minTempC ?? null,
    avgTempC: p.avgTempC ?? null,
    maxFeelslikeC: p.maxFeelslikeC ?? p.feelslikeC ?? null,
    dewpointC: p.dewpointC ?? p.avgDewpointC ?? null,
    humidity: p.humidity ?? null,
    maxHumidity: p.maxHumidity ?? null,
    minHumidity: p.minHumidity ?? null,
    pressureMB: p.pressureMB ?? null,
    pop: p.pop,
    precipMM: p.precipMM,
    windSpeedMaxKPH: p.windSpeedMaxKPH ?? p.windSpeedKPH ?? null,
    windGustKPH: p.windGustKPH ?? null,
    windDir: p.windDir ?? null,
    sky: p.sky ?? null,
    weather: p.weatherPrimary ?? p.weather ?? null,
    weatherPrimaryCoded: p.weatherPrimaryCoded ?? null,
    icon: p.icon ?? null,
    sunriseISO: p.sunriseISO ?? null,
    sunsetISO: p.sunsetISO ?? null,
  }));
}

/**
 * รวมข้อมูลสภาพอากาศปัจจุบันจาก /conditions (พิกัดชุมชนโดยตรง มี precipRateMM)
 * และ /observations (สถานีตรวจวัดจริงใกล้เคียง เช่น VTBD ดอนเมือง)
 */
export function normalizeCurrentWeather(
  conditionsEnvelope: XweatherConditionEnvelope | null,
  observationsEnvelope: XweatherObservationEnvelope | null
): NormalizedCurrentWeather {
  const condItem = conditionsEnvelope?.response[0];
  const condPeriod = condItem?.periods[0];
  const obsItem = observationsEnvelope?.response[0];
  const obsBlock = obsItem?.ob;

  const stationObservation =
    obsItem && obsBlock
      ? {
          stationId: obsItem.id,
          dataSource: obsItem.dataSource ?? null,
          placeName: obsItem.place?.name ?? obsItem.place?.city ?? null,
          distanceKM: obsItem.relativeTo?.distanceKM ?? null,
          obDateTimeISO: obsBlock.dateTimeISO,
          tempC: obsBlock.tempC,
          humidity: obsBlock.humidity,
          pressureMB: obsBlock.pressureMB,
          precipMM: obsBlock.precipMM,
          rawMetar: obsItem.raw ?? null,
        }
      : null;

  if (condPeriod) {
    return {
      timestamp: condPeriod.timestamp,
      dateTimeISO: condPeriod.dateTimeISO,
      tempC: condPeriod.tempC ?? obsBlock?.tempC ?? null,
      feelslikeC: condPeriod.feelslikeC ?? obsBlock?.feelslikeC ?? null,
      dewpointC: condPeriod.dewpointC ?? obsBlock?.dewpointC ?? null,
      humidity: condPeriod.humidity ?? obsBlock?.humidity ?? null,
      pressureMB: condPeriod.pressureMB ?? obsBlock?.pressureMB ?? null,
      rainRateMmPerHr: condPeriod.precipRateMM ?? null,
      recentPrecipMm: condPeriod.precipMM ?? obsBlock?.precipMM ?? null,
      pop: condPeriod.pop ?? null,
      windSpeedKPH: condPeriod.windSpeedKPH ?? obsBlock?.windSpeedKPH ?? null,
      windGustKPH: condPeriod.windGustKPH ?? obsBlock?.windGustKPH ?? null,
      windDir: condPeriod.windDir ?? obsBlock?.windDir ?? null,
      sky: condPeriod.sky ?? obsBlock?.sky ?? null,
      visibilityKM: condPeriod.visibilityKM ?? obsBlock?.visibilityKM ?? null,
      weather: condPeriod.weatherPrimary ?? condPeriod.weather ?? obsBlock?.weather ?? null,
      weatherPrimaryCoded:
        condPeriod.weatherPrimaryCoded ?? obsBlock?.weatherPrimaryCoded ?? null,
      icon: condPeriod.icon ?? obsBlock?.icon ?? null,
      isDay: condPeriod.isDay ?? obsBlock?.isDay ?? null,
      stationObservation,
    };
  }

  if (obsBlock) {
    return {
      timestamp: obsBlock.timestamp,
      dateTimeISO: obsBlock.dateTimeISO,
      tempC: obsBlock.tempC,
      feelslikeC: obsBlock.feelslikeC,
      dewpointC: obsBlock.dewpointC,
      humidity: obsBlock.humidity,
      pressureMB: obsBlock.pressureMB,
      rainRateMmPerHr: null,
      recentPrecipMm: obsBlock.precipMM,
      pop: null,
      windSpeedKPH: obsBlock.windSpeedKPH,
      windGustKPH: obsBlock.windGustKPH,
      windDir: obsBlock.windDir,
      sky: obsBlock.sky ?? null,
      visibilityKM: obsBlock.visibilityKM ?? null,
      weather: obsBlock.weatherPrimary ?? obsBlock.weather,
      weatherPrimaryCoded: obsBlock.weatherPrimaryCoded,
      icon: obsBlock.icon,
      isDay: obsBlock.isDay ?? null,
      stationObservation,
    };
  }

  throw new Error('Both /conditions and /observations returned no usable current weather period.');
}

export interface BuildWeatherBundleParams {
  community: CommunityConfig;
  hourlyEnvelope: XweatherForecastEnvelope;
  dailyEnvelope: XweatherForecastEnvelope;
  conditionsEnvelope: XweatherConditionEnvelope | null;
  observationsEnvelope: XweatherObservationEnvelope | null;
  fetchedAtISO?: string;
  isMock: boolean;
  isStale: boolean;
  staleReason?: string | null;
  sourceLabel?: string;
}

export function buildCommunityWeatherBundle(
  params: BuildWeatherBundleParams
): CommunityWeatherBundle {
  const hourly = normalizeHourlyForecast(params.hourlyEnvelope);
  const daily = normalizeDailyForecast(params.dailyEnvelope);
  const current = normalizeCurrentWeather(params.conditionsEnvelope, params.observationsEnvelope);

  const timezone =
    params.hourlyEnvelope.response[0]?.profile.tz ??
    params.conditionsEnvelope?.response[0]?.profile.tz ??
    'Asia/Bangkok';

  return {
    community: params.community,
    current,
    hourly,
    daily,
    meta: {
      source: params.sourceLabel ?? (params.isMock ? 'Xweather Sample (ข้อมูลจำลอง)' : 'Xweather API'),
      fetchedAtISO: params.fetchedAtISO ?? new Date().toISOString(),
      timezone,
      isMock: params.isMock,
      isStale: params.isStale,
      staleReason: params.staleReason ?? null,
      disclaimerTh: DECISION_SUPPORT_DISCLAIMER_TH,
    },
  };
}

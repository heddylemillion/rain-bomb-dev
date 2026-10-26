import fs from 'node:fs/promises';
import path from 'node:path';
import { SAMPLES_DIR_PATH } from '../config.js';
import type { WeatherCacheStore } from '../cache/cacheStore.js';
import { logger, redactSecretsInText } from '../logger.js';
import { buildCommunityWeatherBundle } from '../normalizers/weatherNormalizer.js';
import {
  XweatherConditionEnvelopeSchema,
  XweatherForecastEnvelopeSchema,
  XweatherObservationEnvelopeSchema,
} from '../schemas/xweather.schema.js';
import type { CommunityConfig, CommunityWeatherBundle } from '../types/weather.js';
import { XweatherClient, XweatherClientError } from './xweatherClient.js';

export interface WeatherServiceOptions {
  xweatherClient: XweatherClient;
  cacheStore: WeatherCacheStore<CommunityWeatherBundle>;
  allowMockFallback: boolean;
  samplesDirPath?: string;
}

export class WeatherService {
  private readonly xweatherClient: XweatherClient;
  private readonly cacheStore: WeatherCacheStore<CommunityWeatherBundle>;
  private readonly allowMockFallback: boolean;
  private readonly samplesDirPath: string;

  constructor(options: WeatherServiceOptions) {
    this.xweatherClient = options.xweatherClient;
    this.cacheStore = options.cacheStore;
    this.allowMockFallback = options.allowMockFallback;
    this.samplesDirPath = options.samplesDirPath ?? SAMPLES_DIR_PATH;
  }

  /**
   * ดึงข้อมูลพยากรณ์และสภาพอากาศปัจจุบันของชุมชน:
   * 1. หากมีใน fresh cache (10 นาที) -> คืนค่าจาก cache ทันที
   * 2. หากไม่มี -> เรียก Xweather API (/forecasts 1hr, /forecasts day, /conditions, /observations)
   * 3. หากเกิดข้อผิดพลาดเรื่อง Auth/Namespace -> โยน XweatherClientError ทันทีเพื่อให้ผู้ดูแลระบบเห็นชัดเจน
   * 4. หากเกิดข้อผิดพลาดเครือข่าย/timeout -> ใช้ stale cache ล่าสุด (stale-while-error fallback)
   * 5. หากไม่มี stale cache และเปิด allowMockFallback -> โหลดจาก samples/*.json พร้อมตั้งค่า isMock: true ("ข้อมูลจำลอง")
   */
  public async getCommunityWeather(community: CommunityConfig): Promise<CommunityWeatherBundle> {
    const cacheKey = `weather:${community.id}`;

    const fresh = this.cacheStore.getFresh(cacheKey);
    if (fresh) {
      return fresh.value;
    }

    try {
      const [hourlyEnvelope, dailyEnvelope, conditionsResult, observationsResult] =
        await Promise.all([
          this.xweatherClient.fetchHourlyForecast(community.lat, community.lon, 24),
          this.xweatherClient.fetchDailyForecast(community.lat, community.lon, 3),
          this.xweatherClient.fetchConditions(community.lat, community.lon).catch((err: unknown) => {
            if (err instanceof XweatherClientError && err.kind === 'AUTH_OR_NAMESPACE') {
              throw err;
            }
            logger.warn(
              { communityId: community.id, err: err instanceof Error ? err.message : String(err) },
              'Optional /conditions call failed; will fall back to /observations if available'
            );
            return null;
          }),
          this.xweatherClient.fetchObservations(community.lat, community.lon).catch((err: unknown) => {
            if (err instanceof XweatherClientError && err.kind === 'AUTH_OR_NAMESPACE') {
              throw err;
            }
            logger.warn(
              { communityId: community.id, err: err instanceof Error ? err.message : String(err) },
              'Optional /observations call failed; will rely on /conditions if available'
            );
            return null;
          }),
        ]);

      if (!conditionsResult && !observationsResult) {
        throw new XweatherClientError({
          message: 'Both /conditions and /observations failed to return current weather data.',
          kind: 'API_ERROR',
          redactedUrl: `/conditions & /observations (${community.lat},${community.lon})`,
        });
      }

      const bundle = buildCommunityWeatherBundle({
        community,
        hourlyEnvelope,
        dailyEnvelope,
        conditionsEnvelope: conditionsResult,
        observationsEnvelope: observationsResult,
        fetchedAtISO: new Date().toISOString(),
        isMock: false,
        isStale: false,
        staleReason: null,
        sourceLabel: 'Xweather API',
      });

      this.cacheStore.set(cacheKey, bundle);
      return bundle;
    } catch (err: unknown) {
      const safeErrorMsg = redactSecretsInText(
        err instanceof Error ? err.message : String(err)
      );

      // หากเป็นข้อผิดพลาดด้าน Auth หรือ Namespace และไม่ได้เปิดใช้ Mock Fallback ให้โยนออกทันที
      if (
        err instanceof XweatherClientError &&
        err.kind === 'AUTH_OR_NAMESPACE' &&
        this.xweatherClient.hasCredentials()
      ) {
        logger.error(
          { communityId: community.id, kind: err.kind, error: safeErrorMsg },
          'Xweather Auth/Namespace failure'
        );
        throw err;
      }

      // Stale-while-error fallback: ใช้ข้อมูลจริงล่าสุดที่เคยแคชไว้ก่อนหน้า
      const stale = this.cacheStore.getStale(cacheKey);
      if (stale) {
        logger.warn(
          { communityId: community.id, cachedAt: stale.storedAtISO, error: safeErrorMsg },
          'Serving stale cached weather bundle due to upstream Xweather error'
        );
        return {
          ...stale.value,
          meta: {
            ...stale.value.meta,
            isStale: true,
            staleReason: `ไม่สามารถดึงข้อมูลล่าสุดจาก Xweather ได้ชั่วคราว (${safeErrorMsg}) ระบบจึงแสดงข้อมูลล่าสุดที่บันทึกไว้เมื่อ ${stale.storedAtISO}`,
          },
        };
      }

      // หากไม่มี stale cache และอนุญาตให้ใช้ข้อมูลจำลองจาก samples/*.json เพื่อการสาธิต
      if (this.allowMockFallback) {
        logger.warn(
          { communityId: community.id, error: safeErrorMsg },
          'No stale cache available; falling back to verified Phase 0 samples with isMock: true'
        );
        return this.loadSampleMockBundle(community, safeErrorMsg);
      }

      throw err;
    }
  }

  private async loadSampleMockBundle(
    community: CommunityConfig,
    reason: string
  ): Promise<CommunityWeatherBundle> {
    const [raw1hr, rawDay, rawCond, rawObs] = await Promise.all([
      fs.readFile(path.join(this.samplesDirPath, 'forecasts-1hr.json'), 'utf-8'),
      fs.readFile(path.join(this.samplesDirPath, 'forecasts-day.json'), 'utf-8'),
      fs.readFile(path.join(this.samplesDirPath, 'conditions.json'), 'utf-8'),
      fs.readFile(path.join(this.samplesDirPath, 'observations.json'), 'utf-8'),
    ]);

    const hourlyEnvelope = XweatherForecastEnvelopeSchema.parse(JSON.parse(raw1hr));
    const dailyEnvelope = XweatherForecastEnvelopeSchema.parse(JSON.parse(rawDay));
    const conditionsEnvelope = XweatherConditionEnvelopeSchema.parse(JSON.parse(rawCond));
    const observationsEnvelope = XweatherObservationEnvelopeSchema.parse(JSON.parse(rawObs));

    return buildCommunityWeatherBundle({
      community,
      hourlyEnvelope,
      dailyEnvelope,
      conditionsEnvelope,
      observationsEnvelope,
      fetchedAtISO: new Date().toISOString(),
      isMock: true,
      isStale: true,
      staleReason: `ข้อมูลจำลอง (ใช้ไฟล์ตัวอย่างที่บันทึกไว้ เนื่องจาก: ${reason})`,
      sourceLabel: 'ข้อมูลจำลอง (Xweather Saved Sample)',
    });
  }
}

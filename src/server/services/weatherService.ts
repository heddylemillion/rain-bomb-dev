import type { WeatherCacheStore } from '../cache/cacheStore.js';
import { logger, redactSecretsInText } from '../logger.js';
import { buildCommunityWeatherBundle } from '../normalizers/weatherNormalizer.js';
import type { CommunityConfig, CommunityWeatherBundle } from '../types/weather.js';
import { XweatherClient, XweatherClientError } from './xweatherClient.js';

export interface WeatherServiceOptions {
  xweatherClient: XweatherClient;
  cacheStore: WeatherCacheStore<CommunityWeatherBundle>;
}

export class WeatherService {
  private readonly xweatherClient: XweatherClient;
  private readonly cacheStore: WeatherCacheStore<CommunityWeatherBundle>;
  private readonly inFlight = new Map<string, Promise<CommunityWeatherBundle>>();

  constructor(options: WeatherServiceOptions) {
    this.xweatherClient = options.xweatherClient;
    this.cacheStore = options.cacheStore;
  }

  public async getCommunityWeather(community: CommunityConfig): Promise<CommunityWeatherBundle> {
    const cacheKey = `weather:${community.id}`;
    const fresh = this.cacheStore.getFresh(cacheKey);
    if (fresh) return fresh.value;
    const pending = this.inFlight.get(cacheKey);
    if (pending) return pending;

    const request = this.fetchCommunityWeather(community, cacheKey);
    this.inFlight.set(cacheKey, request);
    try {
      return await request;
    } catch (error: unknown) {
      const safeMessage = redactSecretsInText(
        error instanceof Error ? error.message : String(error)
      );
      const stale = this.cacheStore.getStale(cacheKey);
      if (stale && Date.now() - new Date(stale.storedAtISO).getTime() <= 30 * 60 * 1000) {
        logger.warn(
          { communityId: community.id, cachedAt: stale.storedAtISO, error: safeMessage },
          'Serving stale Xweather data within the 30-minute limit'
        );
        return {
          ...stale.value,
          meta: {
            ...stale.value.meta,
            isStale: true,
            staleReason: `ข้อมูลล่าสุดยังไม่พร้อม (${error instanceof XweatherClientError ? error.kind : 'error'}) · อัปเดตล่าสุด ${stale.storedAtISO}`,
          },
        };
      }
      logger.warn(
        { communityId: community.id, error: safeMessage },
        'Xweather data unavailable and no recent successful cache exists'
      );
      throw error;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  private async fetchCommunityWeather(
    community: CommunityConfig,
    cacheKey: string
  ): Promise<CommunityWeatherBundle> {
    const [hourlyEnvelope, dailyEnvelope, conditionsEnvelope, observationsEnvelope] =
      await Promise.all([
        this.xweatherClient.fetchHourlyForecast(community.lat, community.lon, 24),
        this.xweatherClient.fetchDailyForecast(community.lat, community.lon, 3),
        this.xweatherClient.fetchConditions(community.lat, community.lon),
        this.xweatherClient.fetchObservations(community.lat, community.lon),
      ]);
    const bundle = buildCommunityWeatherBundle({
      community,
      hourlyEnvelope,
      dailyEnvelope,
      conditionsEnvelope,
      observationsEnvelope,
      fetchedAtISO: new Date().toISOString(),
      isMock: false,
      isStale: false,
      staleReason: null,
      sourceLabel: 'Xweather API',
    });
    this.cacheStore.set(cacheKey, bundle, 300);
    return bundle;
  }
}

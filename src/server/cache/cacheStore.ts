import NodeCache from 'node-cache';

/**
 * อินเทอร์เฟซ Cache ที่พร้อมเปลี่ยนไปใช้ Redis ในอนาคตได้ทันที
 * เก็บทั้งค่าที่ยังไม่หมดอายุ (fresh) และสำเนาล่าสุด (stale backup) สำหรับ stale-while-error fallback
 */
export interface CacheEntry<T> {
  value: T;
  storedAtISO: string;
}

export interface WeatherCacheStore<T> {
  getFresh(key: string): CacheEntry<T> | null;
  getStale(key: string): CacheEntry<T> | null;
  set(key: string, value: T, ttlSeconds?: number): void;
  clear(): void;
  stats(): { freshKeys: number; staleKeys: number };
}

export class InMemoryWeatherCache<T> implements WeatherCacheStore<T> {
  private readonly freshCache: NodeCache;
  private readonly staleStore: Map<string, CacheEntry<T>>;
  private readonly defaultTtlSeconds: number;

  constructor(defaultTtlSeconds = 600) {
    this.defaultTtlSeconds = defaultTtlSeconds;
    this.freshCache = new NodeCache({
      stdTTL: defaultTtlSeconds,
      checkperiod: Math.max(30, Math.floor(defaultTtlSeconds / 5)),
      useClones: true,
    });
    this.staleStore = new Map<string, CacheEntry<T>>();
  }

  public getFresh(key: string): CacheEntry<T> | null {
    const entry = this.freshCache.get<CacheEntry<T>>(key);
    return entry ?? null;
  }

  public getStale(key: string): CacheEntry<T> | null {
    const entry = this.staleStore.get(key);
    if (!entry) return null;
    return structuredClone(entry);
  }

  public set(key: string, value: T, ttlSeconds?: number): void {
    const entry: CacheEntry<T> = {
      value: structuredClone(value),
      storedAtISO: new Date().toISOString(),
    };
    this.freshCache.set(key, entry, ttlSeconds ?? this.defaultTtlSeconds);
    this.staleStore.set(key, entry);
  }

  public clear(): void {
    this.freshCache.flushAll();
    this.staleStore.clear();
  }

  public stats(): { freshKeys: number; staleKeys: number } {
    return {
      freshKeys: this.freshCache.keys().length,
      staleKeys: this.staleStore.size,
    };
  }
}

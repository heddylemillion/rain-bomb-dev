import { z } from 'zod';

export interface GeocodingResult {
  lat: number;
  lon: number;
  name: string;
  district: string;
  province: string;
  displayName: string;
}

export interface GeocodingProvider {
  search(query: string, language: string): Promise<GeocodingResult[]>;
  reverse(lat: number, lon: number, language: string): Promise<GeocodingResult | null>;
}

const NominatimResultSchema = z.object({
  lat: z.string().transform(Number).pipe(z.number().finite()),
  lon: z.string().transform(Number).pipe(z.number().finite()),
  display_name: z.string(),
  name: z.string().optional(),
  address: z.record(z.string()).optional(),
});

const NominatimResponseSchema = z.array(NominatimResultSchema);
const NominatimReverseSchema = NominatimResultSchema.extend({}).nullable();

function toGeocodingResult(
  result: z.infer<typeof NominatimResultSchema>
): GeocodingResult {
  const address = result.address ?? {};
  const name =
    result.name ??
    address['suburb'] ??
    address['town'] ??
    address['village'] ??
    address['city'] ??
    result.display_name.split(',')[0] ??
    'ตำแหน่งที่เลือก';
  const district =
    address['city_district'] ?? address['county'] ?? address['municipality'] ?? '';
  const province = address['state'] ?? address['province'] ?? '';
  const placeParts = [name, district, province].filter(
    (part, index, parts) => part.length > 0 && parts.indexOf(part) === index
  );
  return {
    lat: Number(result.lat.toFixed(2)),
    lon: Number(result.lon.toFixed(2)),
    name,
    district,
    province,
    displayName: placeParts.join(' · ') || result.display_name,
  };
}

export class NominatimGeocodingProvider implements GeocodingProvider {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly countryCodes: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, { expiresAt: number; value: GeocodingResult[] }>();
  private lastRequestAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: {
    baseUrl: string;
    userAgent: string;
    countryCodes?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.userAgent = options.userAgent;
    this.countryCodes = options.countryCodes ?? 'th';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async search(query: string, language: string): Promise<GeocodingResult[]> {
    const key = `search:${language}:${query.trim().toLocaleLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '5');
    url.searchParams.set('accept-language', language);
    if (this.countryCodes) {
      url.searchParams.set('countrycodes', this.countryCodes);
    }
    const raw = await this.request(url);
    const results = NominatimResponseSchema.parse(raw).map(toGeocodingResult);
    this.cache.set(key, { value: results, expiresAt: Date.now() + 10 * 60_000 });
    return results;
  }

  public async reverse(lat: number, lon: number, language: string): Promise<GeocodingResult | null> {
    const key = `reverse:${language}:${lat.toFixed(2)}:${lon.toFixed(2)}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value[0] ?? null;
    }
    const url = new URL(`${this.baseUrl}/reverse`);
    url.searchParams.set('lat', lat.toFixed(2));
    url.searchParams.set('lon', lon.toFixed(2));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', language);
    const raw = await this.request(url);
    const parsed = NominatimReverseSchema.parse(raw);
    const result = parsed ? toGeocodingResult(parsed) : null;
    this.cache.set(key, { value: result ? [result] : [], expiresAt: Date.now() + 10 * 60_000 });
    return result;
  }

  private async request(url: URL): Promise<unknown> {
    const waitForPrevious = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await waitForPrevious;
    try {
      const delay = Math.max(0, 1000 - (Date.now() - this.lastRequestAt));
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      this.lastRequestAt = Date.now();
      const response = await this.fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': this.userAgent,
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        throw new Error(`Geocoding provider returned HTTP ${response.status}`);
      }
      return await response.json() as unknown;
    } finally {
      release();
    }
  }
}

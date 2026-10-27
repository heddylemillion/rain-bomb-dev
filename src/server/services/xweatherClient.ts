import { z, type ZodType, type ZodTypeDef } from 'zod';
import { logger, redactSecretsInText } from '../logger.js';
import {
  XweatherConditionEnvelopeSchema,
  XweatherForecastEnvelopeSchema,
  XweatherObservationEnvelopeSchema,
  type XweatherConditionEnvelope,
  type XweatherForecastEnvelope,
  type XweatherObservationEnvelope,
} from '../schemas/xweather.schema.js';

export type XweatherErrorKind =
  | 'AUTH_OR_NAMESPACE'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'API_ERROR'
  | 'EMPTY_RESPONSE'
  | 'VALIDATION_ERROR'
  | 'NETWORK_ERROR';

export class XweatherClientError extends Error {
  public readonly kind: XweatherErrorKind;
  public readonly statusCode: number | null;
  public readonly apiErrorCode: string | null;
  public readonly redactedUrl: string;

  constructor(params: {
    message: string;
    kind: XweatherErrorKind;
    statusCode?: number | null;
    apiErrorCode?: string | null;
    redactedUrl: string;
  }) {
    super(redactSecretsInText(params.message));
    this.name = 'XweatherClientError';
    this.kind = params.kind;
    this.statusCode = params.statusCode ?? null;
    this.apiErrorCode = params.apiErrorCode ?? null;
    this.redactedUrl = redactSecretsInText(params.redactedUrl);
  }
}

const CapabilityProbeSchema = z.object({
  success: z.boolean(),
  error: z
    .object({
      code: z.string().optional(),
      description: z.string().optional(),
    })
    .nullable()
    .optional(),
  response: z.union([z.array(z.unknown()), z.record(z.unknown())]),
});

export interface XweatherClientOptions {
  baseUrl: string;
  /** Raster Maps host. UNVERIFIED default: https://maps.api.xweather.com */
  mapsBaseUrl?: string;
  clientId: string;
  clientSecret: string;
  namespace?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type RasterTileResult =
  | { ok: true; body: Buffer; contentType: string }
  | { ok: false; status: number | null };

export class XweatherClient {
  private readonly baseUrl: string;
  private readonly mapsBaseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly namespace: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: XweatherClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.mapsBaseUrl = (options.mapsBaseUrl ?? 'https://maps.api.xweather.com').replace(/\/$/, '');
    this.clientId = options.clientId.trim();
    this.clientSecret = options.clientSecret.trim();
    this.namespace = (options.namespace ?? '').trim();
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public hasCredentials(): boolean {
    return (
      this.clientId.length > 0 &&
      this.clientSecret.length > 0 &&
      this.clientId !== 'your_client_id_here' &&
      this.clientSecret !== 'your_client_secret_here'
    );
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'RainBomb-Backend/0.1.0',
    };

    if (this.namespace.length > 0) {
      const origin =
        this.namespace.startsWith('http://') || this.namespace.startsWith('https://')
          ? this.namespace
          : `https://${this.namespace}`;
      headers['Origin'] = origin;
      headers['Referer'] = `${origin}/`;
    }

    return headers;
  }

  private async requestAndValidate<T extends { success: boolean; error?: { code?: string; description?: string } | null }>(
    endpointPath: string,
    queryParams: Record<string, string>,
    schema: ZodType<T, ZodTypeDef, unknown>,
    allowEmptyResponse = false
  ): Promise<T> {
    if (!this.hasCredentials()) {
      throw new XweatherClientError({
        message: 'Xweather credentials (XWEATHER_CLIENT_ID / XWEATHER_CLIENT_SECRET) are not configured.',
        kind: 'AUTH_OR_NAMESPACE',
        redactedUrl: `${this.baseUrl}${endpointPath}`,
      });
    }

    const url = new URL(`${this.baseUrl}${endpointPath}`);
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, v);
    }
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('client_secret', this.clientSecret);

    const fullUrl = url.toString();
    const safeUrl = redactSecretsInText(fullUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(fullUrl, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: controller.signal,
      });

      const rawText = await res.text();
      let rawJson: unknown;
      try {
        rawJson = JSON.parse(rawText);
      } catch {
        throw new XweatherClientError({
          message: `Xweather returned non-JSON response (HTTP ${res.status})`,
          kind: 'HTTP_ERROR',
          statusCode: res.status,
          redactedUrl: safeUrl,
        });
      }

      const envelopeObj = rawJson as {
        success?: boolean;
        error?: { code?: string; description?: string } | null;
        response?: unknown;
      };

      const errCode = envelopeObj?.error?.code ?? null;
      const errDesc = envelopeObj?.error?.description ?? null;

      if (
        res.status === 401 ||
        res.status === 403 ||
        (errCode && /invalid_client|unauthorized|forbidden|access_denied|namespace/i.test(errCode)) ||
        (errDesc && /not authorized|unauthorized|namespace|invalid client/i.test(errDesc))
      ) {
        throw new XweatherClientError({
          message: `Xweather authorization or namespace failure: [${errCode ?? res.status}] ${errDesc ?? 'Unauthorized'}`,
          kind: 'AUTH_OR_NAMESPACE',
          statusCode: res.status,
          apiErrorCode: errCode,
          redactedUrl: safeUrl,
        });
      }

      if (!res.ok) {
        throw new XweatherClientError({
          message: `Xweather HTTP ${res.status}: [${errCode ?? 'HTTP_ERROR'}] ${errDesc ?? res.statusText}`,
          kind: 'HTTP_ERROR',
          statusCode: res.status,
          apiErrorCode: errCode,
          redactedUrl: safeUrl,
        });
      }

      if (envelopeObj.success === false) {
        throw new XweatherClientError({
          message: `Xweather API returned success:false [${errCode ?? 'UNKNOWN'}]: ${errDesc ?? 'Unknown error'}`,
          kind: 'API_ERROR',
          statusCode: res.status,
          apiErrorCode: errCode,
          redactedUrl: safeUrl,
        });
      }

      const hasResponse =
        Array.isArray(envelopeObj.response)
          ? envelopeObj.response.length > 0
          : envelopeObj.response !== null && typeof envelopeObj.response === 'object';
      if (!hasResponse && !allowEmptyResponse) {
        throw new XweatherClientError({
          message: `Xweather returned an empty response for ${endpointPath}`,
          kind: 'EMPTY_RESPONSE',
          statusCode: res.status,
          apiErrorCode: errCode,
          redactedUrl: safeUrl,
        });
      }

      const parsed = schema.safeParse(rawJson);
      if (!parsed.success) {
        logger.error(
          {
            endpoint: safeUrl,
            zodIssues: parsed.error.issues,
          },
          'Xweather response failed Zod schema validation'
        );
        throw new XweatherClientError({
          message: `Xweather response schema validation failed: ${parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`,
          kind: 'VALIDATION_ERROR',
          statusCode: res.status,
          redactedUrl: safeUrl,
        });
      }

      return parsed.data;
    } catch (err: unknown) {
      if (err instanceof XweatherClientError) {
        throw err;
      }

      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (isAbort) {
        throw new XweatherClientError({
          message: `Xweather request timed out after ${this.timeoutMs}ms`,
          kind: 'TIMEOUT',
          redactedUrl: safeUrl,
        });
      }

      const message = err instanceof Error ? err.message : String(err);
      throw new XweatherClientError({
        message: `Xweather network error: ${redactSecretsInText(message)}`,
        kind: 'NETWORK_ERROR',
        redactedUrl: safeUrl,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  public async probeEndpoint(endpointPath: string): Promise<void> {
    await this.requestAndValidate(
      endpointPath,
      {},
      CapabilityProbeSchema,
      true
    );
  }

  /**
   * Fetches one Xweather Raster Maps PNG tile.
   * URL pattern (UNVERIFIED against the live plan): {mapsBase}/{id}_{secret}/{layer}/{z}/{x}/{y}/{offset}.png
   * The credentialed URL is never logged or returned; callers only get bytes or a status code.
   * Callers must pass already-validated layer/offset values.
   */
  public async fetchRasterTile(params: {
    layer: string;
    z: number;
    x: number;
    y: number;
    offset: string;
  }): Promise<RasterTileResult> {
    if (!this.hasCredentials()) {
      return { ok: false, status: null };
    }
    const { layer, z, x, y, offset } = params;
    const url = `${this.mapsBaseUrl}/${encodeURIComponent(this.clientId)}_${encodeURIComponent(
      this.clientSecret
    )}/${layer}/${z}/${x}/${y}/${offset}.png`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: 'image/png', 'User-Agent': 'RainBomb-Backend/0.1.0' };
      if (this.namespace.length > 0) {
        const origin =
          this.namespace.startsWith('http://') || this.namespace.startsWith('https://')
            ? this.namespace
            : `https://${this.namespace}`;
        headers['Origin'] = origin;
        headers['Referer'] = `${origin}/`;
      }
      const res = await this.fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
      const contentType = res.headers.get('content-type') ?? '';
      if (!res.ok || !contentType.toLowerCase().startsWith('image/')) {
        return { ok: false, status: res.status };
      }
      return { ok: true, body: Buffer.from(await res.arrayBuffer()), contentType };
    } catch {
      return { ok: false, status: null };
    } finally {
      clearTimeout(timer);
    }
  }

  public async fetchHourlyForecast(lat: number, lon: number, limit = 24): Promise<XweatherForecastEnvelope> {
    return this.requestAndValidate(
      `/forecasts/${lat},${lon}`,
      {
        filter: '1hr',
        limit: String(limit),
        tz: 'Asia/Bangkok',
      },
      XweatherForecastEnvelopeSchema
    );
  }

  public async fetchDailyForecast(lat: number, lon: number, limit = 3): Promise<XweatherForecastEnvelope> {
    return this.requestAndValidate(
      `/forecasts/${lat},${lon}`,
      {
        filter: 'day',
        limit: String(limit),
        tz: 'Asia/Bangkok',
      },
      XweatherForecastEnvelopeSchema
    );
  }

  public async fetchObservations(lat: number, lon: number): Promise<XweatherObservationEnvelope> {
    return this.requestAndValidate(
      `/observations/${lat},${lon}`,
      {},
      XweatherObservationEnvelopeSchema
    );
  }

  public async fetchConditions(lat: number, lon: number): Promise<XweatherConditionEnvelope> {
    return this.requestAndValidate(
      `/conditions/${lat},${lon}`,
      {
        tz: 'Asia/Bangkok',
      },
      XweatherConditionEnvelopeSchema
    );
  }
}

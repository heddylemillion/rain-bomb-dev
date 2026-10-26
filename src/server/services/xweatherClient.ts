import type { ZodType } from 'zod';
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

export interface XweatherClientOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  namespace?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class XweatherClient {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly namespace: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: XweatherClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
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

  private async requestAndValidate<T extends { success: boolean; error?: { code?: string; description?: string } | null; response: unknown[] }>(
    endpointPath: string,
    queryParams: Record<string, string>,
    schema: ZodType<T>
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

      if (!Array.isArray(envelopeObj.response) || envelopeObj.response.length === 0) {
        throw new XweatherClientError({
          message: `Xweather returned an empty response array for ${endpointPath}`,
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

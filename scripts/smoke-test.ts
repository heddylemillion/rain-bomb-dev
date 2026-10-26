import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SAMPLES_DIR = path.join(ROOT_DIR, 'samples');
const COMMUNITIES_PATH = path.join(ROOT_DIR, 'config', 'communities.json');

const REQUEST_TIMEOUT_MS = 8000;

interface CommunityConfig {
  id: string;
  name_th: string;
  name_en: string;
  lat: number;
  lon: number;
  elevation_m: number;
  soil_group: 'A' | 'B' | 'C' | 'D';
  drainage_capacity_mm_hr: number;
  canal_station_id: string | null;
  calibration_status: string;
}

interface CommunitiesFile {
  _comment: string;
  communities: CommunityConfig[];
}

interface XweatherErrorObject {
  code?: string;
  description?: string;
}

interface XweatherRawEnvelope {
  success?: boolean;
  error?: XweatherErrorObject | null;
  response?: unknown;
}

type EndpointCategory =
  | 'OK_DATA'
  | 'NOT_AUTHORIZED_OR_NAMESPACE'
  | 'NO_COVERAGE_EMPTY'
  | 'API_ERROR_OTHER'
  | 'NETWORK_OR_TIMEOUT';

interface EndpointCheckSpec {
  key: string;
  label: string;
  endpointPath: string;
  queryParams: Record<string, string>;
  sampleFilename: string;
}

interface EndpointCheckSummary {
  key: string;
  label: string;
  redactedUrl: string;
  httpStatus: number | null;
  successFlag: boolean | null;
  errorCode: string | null;
  errorDescription: string | null;
  category: EndpointCategory;
  sampleSavedTo: string | null;
}

/**
 * ปิดบัง client_id และ client_secret ใน URL ทุกครั้งก่อนพิมพ์ลง console หรือบันทึกไฟล์
 */
function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.searchParams.has('client_id')) {
      parsed.searchParams.set('client_id', '***REDACTED***');
    }
    if (parsed.searchParams.has('client_secret')) {
      parsed.searchParams.set('client_secret', '***REDACTED***');
    }
    return parsed.toString();
  } catch {
    return rawUrl
      .replace(/client_id=[^&]+/gi, 'client_id=***REDACTED***')
      .replace(/client_secret=[^&]+/gi, 'client_secret=***REDACTED***');
  }
}

/**
 * สร้าง HTTP headers สำหรับกรณีที่คีย์ Xweather ผูกกับ Web Namespace (Origin / Referer)
 */
function buildRequestHeaders(namespace: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'RainBomb-SmokeTest/0.1.0',
  };

  if (namespace && namespace.trim().length > 0) {
    const trimmed = namespace.trim();
    const originUrl =
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://${trimmed}`;
    headers['Origin'] = originUrl;
    headers['Referer'] = `${originUrl}/`;
  }

  return headers;
}

/**
 * จำแนกผลลัพธ์ของแต่ละ endpoint เพื่อสรุปว่าใช้งานได้ / ติดสิทธิ์แพ็กเกจหรือ namespace / ไม่มีข้อมูลในพื้นที่
 */
function classifyResult(
  httpStatus: number | null,
  envelope: XweatherRawEnvelope | null
): EndpointCategory {
  if (httpStatus === null || envelope === null) {
    return 'NETWORK_OR_TIMEOUT';
  }

  const errCode = (envelope.error?.code ?? '').toLowerCase();
  const errDesc = (envelope.error?.description ?? '').toLowerCase();

  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    errCode.includes('invalid_client') ||
    errCode.includes('unauthorized') ||
    errCode.includes('forbidden') ||
    errCode.includes('access_denied') ||
    errCode.includes('namespace') ||
    errDesc.includes('not authorized') ||
    errDesc.includes('unauthorized') ||
    errDesc.includes('namespace') ||
    errDesc.includes('invalid client') ||
    errDesc.includes('plan') ||
    errDesc.includes('subscription')
  ) {
    return 'NOT_AUTHORIZED_OR_NAMESPACE';
  }

  if (envelope.success === false) {
    if (
      errCode.includes('warn_no_data') ||
      errCode.includes('no_data') ||
      errDesc.includes('no data') ||
      errDesc.includes('no results')
    ) {
      return 'NO_COVERAGE_EMPTY';
    }
    return 'API_ERROR_OTHER';
  }

  if (envelope.success === true) {
    if (Array.isArray(envelope.response)) {
      return envelope.response.length > 0 ? 'OK_DATA' : 'NO_COVERAGE_EMPTY';
    }
    if (envelope.response && typeof envelope.response === 'object') {
      return 'OK_DATA';
    }
    return 'NO_COVERAGE_EMPTY';
  }

  return 'API_ERROR_OTHER';
}

function extractFirstItem(responseField: unknown): unknown {
  if (Array.isArray(responseField)) {
    return responseField.length > 0 ? responseField[0] : null;
  }
  if (responseField && typeof responseField === 'object') {
    return responseField;
  }
  return null;
}

async function loadFirstCommunity(): Promise<CommunityConfig> {
  const raw = await fs.readFile(COMMUNITIES_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as CommunitiesFile;
  const first = parsed.communities[0];
  if (!first) {
    throw new Error(`No communities found in ${COMMUNITIES_PATH}`);
  }
  return first;
}

async function runEndpointCheck(
  spec: EndpointCheckSpec,
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  namespace: string | undefined
): Promise<EndpointCheckSummary> {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}${spec.endpointPath}`);
  for (const [k, v] of Object.entries(spec.queryParams)) {
    url.searchParams.set(k, v);
  }
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);

  const fullUrl = url.toString();
  const safeUrl = redactUrl(fullUrl);

  console.log('\n================================================================================');
  console.log(`[ENDPOINT] ${spec.label}`);
  console.log(`[URL]      ${safeUrl}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: buildRequestHeaders(namespace),
      signal: controller.signal,
    });

    const httpStatus = response.status;
    const rawText = await response.text();

    let parsedJson: XweatherRawEnvelope | null = null;
    try {
      parsedJson = JSON.parse(rawText) as XweatherRawEnvelope;
    } catch {
      console.error(`[ERROR] Response is not valid JSON (HTTP ${httpStatus})`);
      console.error(rawText.slice(0, 500));
      return {
        key: spec.key,
        label: spec.label,
        redactedUrl: safeUrl,
        httpStatus,
        successFlag: null,
        errorCode: 'INVALID_JSON',
        errorDescription: 'Response body could not be parsed as JSON',
        category: 'API_ERROR_OTHER',
        sampleSavedTo: null,
      };
    }

    await fs.mkdir(SAMPLES_DIR, { recursive: true });
    const sampleFilePath = path.join(SAMPLES_DIR, spec.sampleFilename);
    await fs.writeFile(sampleFilePath, JSON.stringify(parsedJson, null, 2) + '\n', 'utf-8');

    const successFlag = typeof parsedJson.success === 'boolean' ? parsedJson.success : null;
    const errorCode = parsedJson.error?.code ?? null;
    const errorDescription = parsedJson.error?.description ?? null;
    const category = classifyResult(httpStatus, parsedJson);

    console.log(`[HTTP STATUS]       ${httpStatus}`);
    console.log(`[SUCCESS FLAG]      ${String(successFlag)}`);
    console.log(`[ERROR CODE]        ${errorCode ?? '(none)'}`);
    console.log(`[ERROR DESCRIPTION] ${errorDescription ?? '(none)'}`);
    console.log(`[SAVED SAMPLE]      samples/${spec.sampleFilename}`);

    if (category === 'NOT_AUTHORIZED_OR_NAMESPACE') {
      console.warn(
        `[AUTH / NAMESPACE WARNING] Endpoint returned an authorization/plan/namespace failure. ` +
          `Verify XWEATHER_CLIENT_ID, XWEATHER_CLIENT_SECRET, XWEATHER_NAMESPACE (${namespace ?? 'unset'}), and your plan's included endpoints.`
      );
    }

    const firstItem = extractFirstItem(parsedJson.response);
    console.log('[FIRST ITEM OF response]:');
    console.log(JSON.stringify(firstItem, null, 2));

    return {
      key: spec.key,
      label: spec.label,
      redactedUrl: safeUrl,
      httpStatus,
      successFlag,
      errorCode,
      errorDescription,
      category,
      sampleSavedTo: `samples/${spec.sampleFilename}`,
    };
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const message = isAbort
      ? `Request timed out after ${REQUEST_TIMEOUT_MS}ms`
      : err instanceof Error
        ? err.message
        : String(err);

    console.error(`[REQUEST FAILED] ${message}`);
    return {
      key: spec.key,
      label: spec.label,
      redactedUrl: safeUrl,
      httpStatus: null,
      successFlag: null,
      errorCode: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR',
      errorDescription: message,
      category: 'NETWORK_OR_TIMEOUT',
      sampleSavedTo: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const clientId = process.env['XWEATHER_CLIENT_ID']?.trim();
  const clientSecret = process.env['XWEATHER_CLIENT_SECRET']?.trim();
  const namespace = process.env['XWEATHER_NAMESPACE']?.trim();
  const baseUrl = process.env['XWEATHER_BASE_URL']?.trim() || 'https://data.api.xweather.com';

  if (
    !clientId ||
    !clientSecret ||
    clientId === 'your_client_id_here' ||
    clientSecret === 'your_client_secret_here'
  ) {
    console.error('================================================================================');
    console.error('[CONFIG ERROR] Missing XWEATHER_CLIENT_ID or XWEATHER_CLIENT_SECRET in .env');
    console.error('Please copy .env.example to .env and fill in your real Xweather credentials.');
    console.error('================================================================================');
    process.exit(1);
  }

  const community = await loadFirstCommunity();
  const coordQuery = `${community.lat},${community.lon}`;

  console.log('================================================================================');
  console.log('RainBomb — Phase 0: Xweather API Smoke Test');
  console.log(`Target Community : ${community.name_th} (${community.id})`);
  console.log(`Coordinates (:id): ${coordQuery}`);
  console.log(`Base URL         : ${baseUrl}`);
  console.log(`Namespace Header : ${namespace ? namespace : '(none set in XWEATHER_NAMESPACE)'}`);
  console.log(`Timeout          : ${REQUEST_TIMEOUT_MS}ms`);
  console.log('================================================================================');

  const specs: EndpointCheckSpec[] = [
    {
      key: 'forecasts_1hr',
      label: '1) /forecasts (hourly: filter=1hr, limit=24, tz=Asia/Bangkok)',
      endpointPath: `/forecasts/${coordQuery}`,
      queryParams: {
        filter: '1hr',
        limit: '24',
        tz: 'Asia/Bangkok',
      },
      sampleFilename: 'forecasts-1hr.json',
    },
    {
      key: 'forecasts_day',
      label: '2) /forecasts (daily: filter=day, limit=3, tz=Asia/Bangkok)',
      endpointPath: `/forecasts/${coordQuery}`,
      queryParams: {
        filter: 'day',
        limit: '3',
        tz: 'Asia/Bangkok',
      },
      sampleFilename: 'forecasts-day.json',
    },
    {
      key: 'observations',
      label: '3) /observations (current station observation)',
      endpointPath: `/observations/${coordQuery}`,
      queryParams: {},
      sampleFilename: 'observations.json',
    },
    {
      key: 'conditions',
      label: '4) /conditions (current gridded/interpolated conditions)',
      endpointPath: `/conditions/${coordQuery}`,
      queryParams: {
        tz: 'Asia/Bangkok',
      },
      sampleFilename: 'conditions.json',
    },
  ];

  const summaries: EndpointCheckSummary[] = [];
  for (const spec of specs) {
    const summary = await runEndpointCheck(spec, baseUrl, clientId, clientSecret, namespace);
    summaries.push(summary);
  }

  const withData = summaries.filter((s) => s.category === 'OK_DATA');
  const unauthorized = summaries.filter((s) => s.category === 'NOT_AUTHORIZED_OR_NAMESPACE');
  const noCoverage = summaries.filter((s) => s.category === 'NO_COVERAGE_EMPTY');
  const otherErrors = summaries.filter(
    (s) => s.category === 'API_ERROR_OTHER' || s.category === 'NETWORK_OR_TIMEOUT'
  );

  console.log('\n================================================================================');
  console.log('PHASE 0 SMOKE TEST SUMMARY');
  console.log('================================================================================');

  console.log(`\n[A] Returned Data (${withData.length}):`);
  for (const item of withData) {
    console.log(`  - ${item.label} -> saved to ${item.sampleSavedTo}`);
  }

  console.log(`\n[B] Not Authorized for Plan / Namespace Failure (${unauthorized.length}):`);
  for (const item of unauthorized) {
    console.log(
      `  - ${item.label} -> HTTP ${item.httpStatus}, code=${item.errorCode}, desc="${item.errorDescription}"`
    );
  }

  console.log(`\n[C] No Coverage / Empty Response (${noCoverage.length}):`);
  for (const item of noCoverage) {
    console.log(
      `  - ${item.label} -> HTTP ${item.httpStatus}, code=${item.errorCode ?? 'none'}, desc="${item.errorDescription ?? 'empty response'}"`
    );
  }

  if (otherErrors.length > 0) {
    console.log(`\n[D] Other API / Network / Timeout Errors (${otherErrors.length}):`);
    for (const item of otherErrors) {
      console.log(
        `  - ${item.label} -> HTTP ${item.httpStatus ?? 'N/A'}, code=${item.errorCode}, desc="${item.errorDescription}"`
      );
    }
  }

  console.log('\n================================================================================');
}

main().catch((err: unknown) => {
  console.error('[FATAL ERROR]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

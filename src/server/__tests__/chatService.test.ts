import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { ChatRequestSchema, ChatService } from '../services/chatService.js';
import { EnvironmentDataService } from '../services/environmentDataService.js';
import { RiskDataService } from '../services/riskDataService.js';
import { XweatherClient } from '../services/xweatherClient.js';

function makeChatService(
  fetcher: typeof fetch,
  now = Date.now()
): ChatService {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_MODE: 'mock',
    CHAT_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'test-server-key',
    OPENROUTER_MODEL: 'provider/test-model',
    OPENROUTER_FALLBACK_MODELS: 'provider/backup',
    CHAT_DAILY_BUDGET_REQUESTS: '5',
    REQUIRE_APPROVED_ADVISORIES: 'false',
  });
  const xweatherClient = new XweatherClient({
    baseUrl: 'https://data.api.xweather.com',
    clientId: '',
    clientSecret: '',
    timeoutMs: 1000,
  });
  return new ChatService({
    dataMode: 'mock',
    config: config.chat,
    riskDataService: new RiskDataService(xweatherClient, 'mock'),
    environmentDataService: new EnvironmentDataService({ mode: 'mock' }),
    fetcher,
    now: () => now,
  });
}

const requestBody = {
  lat: 13.75,
  lon: 100.5,
  areaName: 'ตำแหน่งทดสอบ',
  messages: [{ role: 'user' as const, content: 'ตอนนี้ควรเตรียมอะไร' }],
};

describe('chat request schema and service', () => {
  it('accepts only coordinates, area name, and a bounded conversation history', () => {
    expect(ChatRequestSchema.safeParse(requestBody).success).toBe(true);
    expect(ChatRequestSchema.safeParse({ ...requestBody, context: 'client supplied risk' }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({
      ...requestBody,
      messages: Array.from({ length: 7 }, () => ({ role: 'user', content: 'ถาม' })),
    }).success).toBe(false);
  });

  it('sends server-built area context and privacy routing to OpenRouter without PII', async () => {
    let captured: { body?: string; headers?: Headers } = {};
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      captured = { body: String(init?.body), headers: new Headers(init?.headers) };
      return new Response(JSON.stringify({
        model: 'provider/test-model',
        choices: [{ message: { content: 'ความเสี่ยงเป็นการประเมินจากข้อมูลที่มี โปรดติดตามประกาศทางการ [A1]' } }],
        usage: { total_tokens: 42 },
      }), { status: 200 });
    });
    const service = makeChatService(fetcher);
    const answer = await service.respond({
      ...requestBody,
      messages: [{ role: 'user', content: 'ช่วยสรุป โทร 081-234-5678 test@example.com' }],
    });

    const payload = JSON.parse(captured.body ?? '{}') as {
      messages: Array<{ role: string; content: string }>;
      models: string[];
      provider: { data_collection: string };
    };
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(captured.headers?.get('authorization')).toBe('Bearer test-server-key');
    expect(payload.provider.data_collection).toBe('deny');
    expect(payload.models).toEqual(['provider/test-model', 'provider/backup']);
    expect(payload.messages[0]?.content).toContain('ชื่อพื้นที่ ตำแหน่งทดสอบ');
    expect(payload.messages[0]?.content).toContain('13.750, 100.500');
    expect(payload.messages[0]?.content).toContain('สรุปการประเมินความเสี่ยง');
    expect(payload.messages[0]?.content).toContain('assistant-role history');
    expect(payload.messages.at(-1)?.content).not.toContain('081-234-5678');
    expect(payload.messages.at(-1)?.content).not.toContain('test@example.com');
    expect(answer.fallback).toBe(false);
    expect(answer.citations).toContain('A1');
  });

  it('bypasses the model for emergency phrases and does not invent contact numbers', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const service = makeChatService(fetcher);
    const answer = await service.respond({
      ...requestBody,
      messages: [{ role: 'user', content: 'ช่วยด้วย น้ำเข้าบ้านและไฟดูด' }],
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(answer.answer).toContain('โทรหาหน่วยงานฉุกเฉินในพื้นที่');
    expect(answer.answer).not.toMatch(/\d/u);
  });

  it('falls back when the model invents a number', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      model: 'provider/test-model',
      choices: [{ message: { content: 'ความเสี่ยงคือ 999999 โปรดระวัง [A1]' } }],
    }), { status: 200 }));
    const answer = await makeChatService(fetcher).respond(requestBody);
    expect(answer.fallback).toBe(true);
    expect(answer.answer).toContain('สถานการณ์:');
  });

  it.each([401, 402, 429, 502, 503])('falls back on OpenRouter HTTP %s', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status }));
    const answer = await makeChatService(fetcher).respond(requestBody);
    expect(answer.fallback).toBe(true);
    expect(answer.answer).toContain('สถานการณ์:');
  });

  it('falls back on timeouts and malformed OpenRouter responses', async () => {
    const timeoutFetcher = vi.fn<typeof fetch>().mockRejectedValue(
      new DOMException('request timed out', 'TimeoutError')
    );
    const malformedFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{', { status: 200 })
    );
    expect((await makeChatService(timeoutFetcher).respond(requestBody)).fallback).toBe(true);
    expect((await makeChatService(malformedFetcher).respond(requestBody)).fallback).toBe(true);
  });

  it('makes no outbound OpenRouter calls when CHAT_PROVIDER is none', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const config = loadConfig({
      NODE_ENV: 'test',
      DATA_MODE: 'cache',
      CHAT_PROVIDER: 'none',
    });
    const xweatherClient = new XweatherClient({
      baseUrl: 'https://data.api.xweather.com',
      clientId: '',
      clientSecret: '',
      timeoutMs: 1000,
    });
    const service = new ChatService({
      dataMode: 'cache',
      config: config.chat,
      riskDataService: new RiskDataService(xweatherClient, 'cache'),
      environmentDataService: new EnvironmentDataService({ mode: 'cache' }),
      fetcher,
    });
    const answer = await service.respond(requestBody);
    expect(answer.fallback).toBe(true);
    expect(answer.mode).toBe('cache');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('chat endpoint', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a deterministic fallback answer when OpenRouter is disabled and never publishes the configured key', async () => {
    const app = createApp({
      config: loadConfig({
        NODE_ENV: 'test',
        DATA_MODE: 'cache',
        CHAT_PROVIDER: 'none',
        OPENROUTER_API_KEY: 'server-only-secret',
      }),
    });
    const response = await request(app).post('/api/chat').send(requestBody).expect(200);
    expect(response.body.fallback).toBe(true);
    expect(response.body.mode).toBe('cache');
    await request(app).post('/api/chat').send({ ...requestBody, context: 'fake' }).expect(400);

    const runtime = await request(app).get('/api/runtime-config').expect(200);
    expect(JSON.stringify(runtime.body)).not.toContain('server-only-secret');
  });
});

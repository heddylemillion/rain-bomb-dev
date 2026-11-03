const baseUrl = process.env['API_BASE_URL'] ?? 'http://localhost:3001';

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(new URL(path, baseUrl));
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

const health = await getJson('/api/health');
if (
  typeof health !== 'object' ||
  health === null ||
  !('status' in health) ||
  health.status !== 'ok'
) {
  throw new Error('API health check did not return status=ok.');
}

const config = await getJson('/api/runtime-config');
if (
  typeof config !== 'object' ||
  config === null ||
  !('dataMode' in config) ||
  !('lightningProvider' in config) ||
  typeof config.lightningProvider !== 'object' ||
  config.lightningProvider === null ||
  !('id' in config.lightningProvider) ||
  (config.lightningProvider.id !== 'none' && config.lightningProvider.id !== 'mock')
) {
  throw new Error('Runtime configuration reports an unknown lightning provider.');
}

await getJson('/api/providers/status');
console.log(`API smoke checks passed at ${baseUrl}`);

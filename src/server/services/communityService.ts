import fs from 'node:fs/promises';
import { COMMUNITIES_CONFIG_PATH } from '../config.js';
import { CommunitiesFileSchema, type CommunityConfig } from '../types/weather.js';

let cachedCommunities: CommunityConfig[] | null = null;

export async function loadCommunities(
  configPath: string = COMMUNITIES_CONFIG_PATH,
  forceReload = false
): Promise<CommunityConfig[]> {
  if (cachedCommunities && !forceReload && configPath === COMMUNITIES_CONFIG_PATH) {
    return cachedCommunities;
  }

  const rawText = await fs.readFile(configPath, 'utf-8');
  const rawJson: unknown = JSON.parse(rawText);
  const validated = CommunitiesFileSchema.parse(rawJson);

  if (configPath === COMMUNITIES_CONFIG_PATH) {
    cachedCommunities = validated.communities;
  }

  return validated.communities;
}

export async function findCommunityById(
  communityId: string,
  configPath: string = COMMUNITIES_CONFIG_PATH
): Promise<CommunityConfig | null> {
  const communities = await loadCommunities(configPath);
  return communities.find((c) => c.id === communityId) ?? null;
}

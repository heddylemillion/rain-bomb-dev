import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { DATA_DIR_PATH } from '../config.js';

export interface ElevationCell {
  key: string;
  latitude: number;
  longitude: number;
}

const ElevationCacheSchema = z.object({
  values: z.record(z.number()),
});

interface ElevationCacheFile {
  values: Record<string, number>;
}

export function elevationCell(latitude: number, longitude: number): ElevationCell {
  const roundedLatitude = Math.round(latitude * 1000) / 1000;
  const longitudeStep = 0.001 / Math.cos((roundedLatitude * Math.PI) / 180);
  const roundedLongitude = Math.round(longitude / longitudeStep) * longitudeStep;
  const normalizedLongitude = Math.round(roundedLongitude * 100000) / 100000;
  return {
    key: `${roundedLatitude.toFixed(3)},${normalizedLongitude.toFixed(5)}`,
    latitude: roundedLatitude,
    longitude: normalizedLongitude,
  };
}

export class PermanentElevationCache {
  private readonly filePath: string;
  private values: Map<string, number> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath = path.join(DATA_DIR_PATH, 'elevation-cache.json')) {
    this.filePath = filePath;
  }

  public async get(key: string): Promise<number | null> {
    const values = await this.load();
    return values.get(key) ?? null;
  }

  public async setMany(entries: ReadonlyArray<{ key: string; value: number }>): Promise<void> {
    const values = await this.load();
    for (const entry of entries) {
      if (Number.isFinite(entry.value)) values.set(entry.key, entry.value);
    }
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
      const payload: ElevationCacheFile = { values: Object.fromEntries(values) };
      await fs.writeFile(temporaryPath, JSON.stringify(payload), 'utf8');
      await fs.rename(temporaryPath, this.filePath);
    });
    await this.writeQueue;
  }

  private async load(): Promise<Map<string, number>> {
    if (this.values) return this.values;
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(content);
      this.values = new Map(Object.entries(ElevationCacheSchema.parse(parsed).values));
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        this.values = new Map();
      } else {
        throw error;
      }
    }
    return this.values;
  }
}

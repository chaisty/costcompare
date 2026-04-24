import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';

const CACHE_DIR = join(process.cwd(), 'cache');

export function cachePath(filename: string): string {
  return join(CACHE_DIR, filename);
}

// Download a URL to a local cache path, skipping if already present and
// `refresh` is false. Returns the local path. Streams through pipeline so
// large files (the POS CSV is ~175MB) don't buffer in memory.
export async function downloadCached(
  url: string,
  filename: string,
  options: { refresh?: boolean } = {},
): Promise<string> {
  const target = cachePath(filename);

  if (!options.refresh && existsSync(target)) {
    return target;
  }

  mkdirSync(dirname(target), { recursive: true });

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Download failed: ${url} returned ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error(`Download failed: ${url} returned no body`);
  }

  // response.body is the DOM-flavored ReadableStream; Readable.fromWeb wants
  // node:stream/web's. The two are runtime-identical in recent Node versions.
  await pipeline(
    Readable.fromWeb(response.body as unknown as NodeWebReadableStream<Uint8Array>),
    createWriteStream(target),
  );
  return target;
}

export async function readCachedText(filename: string): Promise<string> {
  return readFile(cachePath(filename), 'utf-8');
}

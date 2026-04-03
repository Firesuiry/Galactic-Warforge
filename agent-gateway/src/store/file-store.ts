import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

export async function writeJsonFile(dir: string, fileName: string, value: unknown) {
  await ensureDir(dir);
  await writeFile(path.join(dir, fileName), JSON.stringify(value, null, 2), 'utf8');
}

export async function readJsonFile<T>(dir: string, fileName: string): Promise<T | null> {
  try {
    const raw = await readFile(path.join(dir, fileName), 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function listJsonFiles<T>(dir: string): Promise<T[]> {
  await ensureDir(dir);
  const names = (await readdir(dir)).filter((name) => name.endsWith('.json'));
  const values = await Promise.all(names.map((name) => readJsonFile<T>(dir, name)));
  return values.filter((value): value is T => Boolean(value));
}

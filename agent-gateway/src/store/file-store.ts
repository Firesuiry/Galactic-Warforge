import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

export async function writeJsonFile(dir: string, fileName: string, value: unknown) {
  await ensureDir(dir);
  const targetPath = path.join(dir, fileName);
  const tempPath = path.join(dir, `.${fileName}.${randomUUID()}.tmp`);
  await writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  await rename(tempPath, targetPath);
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
  const existingValues: T[] = [];
  for (const value of values) {
    if (value !== null) {
      existingValues.push(value);
    }
  }
  return existingValues;
}

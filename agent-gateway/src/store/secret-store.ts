import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface SecretEntry {
  id: string;
  encryptedValue: string;
  createdAt: string;
  updatedAt: string;
}

async function ensureRoot(root: string) {
  await mkdir(root, { recursive: true });
}

async function loadOrCreateMasterKey(root: string): Promise<Buffer> {
  await ensureRoot(root);
  const keyPath = path.join(root, 'master.key');

  try {
    return Buffer.from(await readFile(keyPath, 'utf8'), 'base64');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    const key = randomBytes(32);
    await writeFile(keyPath, key.toString('base64'), { encoding: 'utf8', mode: 0o600 });
    return key;
  }
}

function encrypt(key: Buffer, value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function decrypt(key: Buffer, payload: string) {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function createSecretStore(root: string) {
  async function filePath(id: string) {
    await ensureRoot(root);
    return path.join(root, `${id}.json`);
  }

  return {
    async save(id: string, value: string) {
      const key = await loadOrCreateMasterKey(root);
      const now = new Date().toISOString();
      const record: SecretEntry = {
        id,
        encryptedValue: encrypt(key, value),
        createdAt: now,
        updatedAt: now,
      };
      await writeFile(await filePath(id), JSON.stringify(record, null, 2), 'utf8');
    },
    async readValue(id: string) {
      const key = await loadOrCreateMasterKey(root);
      const raw = JSON.parse(await readFile(await filePath(id), 'utf8')) as SecretEntry;
      return decrypt(key, raw.encryptedValue);
    },
    async readRaw(id: string) {
      return readFile(await filePath(id), 'utf8');
    },
  };
}

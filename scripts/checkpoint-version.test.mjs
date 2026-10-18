// scripts/checkpoint-version.mjs 的最小自测：node --test scripts/checkpoint-version.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseGoConst } from './checkpoint-version.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'checkpoint-version.mjs');

test('解析字面整数常量（带/不带 const）', () => {
  assert.equal(parseGoConst('const CurrentVersion = 5\n', 'CurrentVersion'), 5);
  assert.equal(parseGoConst('CurrentFormatVersion = 3\n', 'CurrentFormatVersion'), 3);
  assert.equal(parseGoConst('\tCurrentVersion = 7 // 行尾注释\n', 'CurrentVersion'), 7);
  assert.equal(parseGoConst('const CurrentVersion int = 6\n', 'CurrentVersion'), 6);
});

test('表达式常量解析失败', () => {
  assert.throws(() => parseGoConst('const CurrentVersion = 5 + 1\n', 'CurrentVersion'), /读不到常量/);
});

test('注释行里的假常量被跳过', () => {
  assert.equal(
    parseGoConst('// const CurrentVersion = 4\nconst CurrentVersion = 5\n', 'CurrentVersion'),
    5,
  );
});

test('前缀相似的常量不算命中', () => {
  assert.throws(
    () => parseGoConst('const LegacyCurrentVersion = 4\n', 'CurrentVersion'),
    /读不到常量/,
  );
});

test('同名常量多个不同取值报错', () => {
  assert.throws(
    () => parseGoConst('const CurrentVersion = 4\nconst CurrentVersion = 5\n', 'CurrentVersion'),
    /多个不同取值/,
  );
});

// ---- CLI 级：MISSING manifest / 缺 world ----
function currentVersions() {
  const read = (rel, name) =>
    parseGoConst(fs.readFileSync(path.join(HERE, '..', rel), 'utf8'), name, rel);
  return {
    format: read('server/internal/gamedir/files.go', 'CurrentFormatVersion'),
    snapshot: read('server/internal/snapshot/snapshot.go', 'CurrentVersion'),
  };
}

function makeCheckpoint(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-version-test-'));
  const dir = path.join(root, 'cp-x');
  fs.mkdirSync(dir);
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return { root, dir };
}

function runCli(root) {
  const r = spawnSync(process.execPath, [SCRIPT, root, 'cp-x'], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '').trim() };
}

function validSave(versions, overrides = {}) {
  return {
    format_version: versions.format,
    tick: 10,
    snapshot: { version: versions.snapshot, tick: 10, world: { tick: 10 }, ...overrides },
  };
}

test('CLI：缺 manifest.json → MISSING', () => {
  const v = currentVersions();
  const { root } = makeCheckpoint({
    'meta.json': { format_version: v.format },
    'save.json': validSave(v),
  });
  try {
    assert.deepEqual(runCli(root), { status: 3, out: 'MISSING' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI：save 缺 world 状态 → UNREADABLE', () => {
  const v = currentVersions();
  const save = validSave(v, { world: undefined });
  const { root } = makeCheckpoint({
    'manifest.json': { format_version: 1, name: 'cp-x' },
    'meta.json': { format_version: v.format },
    'save.json': save,
  });
  try {
    const r = runCli(root);
    assert.equal(r.status, 5);
    assert.match(r.out, /^UNREADABLE /);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI：完整存档 → OK', () => {
  const v = currentVersions();
  const { root } = makeCheckpoint({
    'manifest.json': { format_version: 1, name: 'cp-x' },
    'meta.json': { format_version: v.format },
    'save.json': validSave(v),
  });
  try {
    const r = runCli(root);
    assert.equal(r.status, 0);
    assert.match(r.out, /^OK /);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// 存档点版本检查：判断 .run/checkpoints/<名> 能否被**当前 worktree 的服务端**读取。
//
// 服务端判版本的逻辑（server/internal/gamedir/files.go / server/internal/snapshot/snapshot.go）：
//   meta.json  format_version === gamedir.CurrentFormatVersion
//   save.json  format_version === gamedir.CurrentFormatVersion
//              snapshot.version === snapshot.CurrentVersion
//              debug_state.base_snapshot.version === snapshot.CurrentVersion（若有）
// 这里直接读当前 worktree 的 Go 源码常量，跟着二进制一起变，不手抄版本号。
//
// 用法：
//   node scripts/checkpoint-version.mjs <checkpoint_dir> <name>
// 输出（stdout 一行）与退出码：
//   OK                        0  可读
//   MISSING                   3  目录/文件缺失
//   MISMATCH <原因>           4  版本不符
//   UNREADABLE <原因>         5  文件损坏/解压失败等
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function goConst(file, name) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = src.match(new RegExp(`(?:const\\s+)?${name}\\s*=\\s*(\\d+)`));
  if (!m) throw new Error(`读不到常量 ${name}（${file}）`);
  return Number(m[1]);
}

const [, , dirArg, name] = process.argv;
if (!dirArg || !name) {
  console.error('用法: node scripts/checkpoint-version.mjs <checkpoint_dir> <name>');
  process.exit(2);
}

let current;
try {
  current = {
    format: goConst('server/internal/gamedir/files.go', 'CurrentFormatVersion'),
    snapshot: goConst('server/internal/snapshot/snapshot.go', 'CurrentVersion'),
  };
} catch (e) {
  console.error(`UNREADABLE ${e.message}`);
  process.exit(5);
}

const dir = path.join(dirArg, name);
const metaPath = path.join(dir, 'meta.json');
const savePath = path.join(dir, 'save.json');
for (const p of [dir, metaPath, savePath]) {
  if (!fs.existsSync(p)) {
    console.log('MISSING');
    process.exit(3);
  }
}

try {
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (meta.format_version !== current.format) {
    console.log(`MISMATCH meta.format_version=${meta.format_version} 当前=${current.format}`);
    process.exit(4);
  }
  let raw = fs.readFileSync(savePath);
  if (raw[0] === 0x1f && raw[1] === 0x8b) raw = zlib.gunzipSync(raw);
  const save = JSON.parse(raw.toString('utf8'));
  if (save.format_version !== current.format) {
    console.log(`MISMATCH save.format_version=${save.format_version} 当前=${current.format}`);
    process.exit(4);
  }
  const snapVer = save.snapshot?.version;
  if (snapVer !== current.snapshot) {
    console.log(`MISMATCH save.snapshot.version=${snapVer} 当前=${current.snapshot}`);
    process.exit(4);
  }
  const baseVer = save.debug_state?.base_snapshot?.version;
  if (save.debug_state?.base_snapshot && baseVer !== current.snapshot) {
    console.log(`MISMATCH save.debug_state.base_snapshot.version=${baseVer} 当前=${current.snapshot}`);
    process.exit(4);
  }
  if (save.tick !== save.snapshot?.tick) {
    console.log(`UNREADABLE save.tick=${save.tick} snapshot.tick=${save.snapshot?.tick}`);
    process.exit(5);
  }
} catch (e) {
  console.log(`UNREADABLE ${e.message}`);
  process.exit(5);
}

console.log(`OK snapshot=${current.snapshot} format=${current.format}`);

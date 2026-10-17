/**
 * 起一个**新局**的试玩口径服务端（config-skirmish + map-skirmish + tick_rate_override=4），
 * 给 Playwright 的 webServer 用。每次都是全新临时 data_dir，不继承上一轮的存档。
 *
 *   node tests/support/start-scenario-server.mjs <port>
 *
 * 与 `scripts/playtest-up.sh` 的区别：这里只起服务端（Web 由 Playwright 的 vite dev 提供），
 * 所以 tick 速率、配置与地图都直接复用同一组默认值（见 ./scenario.ts）。改动时两边一起改。
 *
 * 端口由调用方传入（Playwright 配置里动态申请的空闲端口），脚本内不写死端口。
 * SIGTERM/SIGINT 时清理临时目录。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  console.error('[scenario-server] 用法: node tests/support/start-scenario-server.mjs <port>');
  process.exit(2);
}

const clientWebDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(clientWebDir, '..');
const configSource = path.resolve(repoRoot, process.env.SW_SERVER_CONFIG ?? 'server/config-skirmish.yaml');
const mapConfig = path.resolve(repoRoot, process.env.SW_SERVER_MAP_CONFIG ?? 'server/map-skirmish.yaml');
const tickRate = process.env.SW_TICK_RATE ?? '4';

const goBin = ['/home/firesuiry/sdk/go1.25.0/bin', '/mnt/wsl/data/home/firesuiry/sdk/go1.25.0/bin']
  .find(candidate => existsSync(path.join(candidate, 'go'))) ?? path.dirname(process.execPath);
const env = {
  ...process.env,
  PATH: `${goBin}:${process.env.PATH ?? ''}`,
  GOCACHE: process.env.GOCACHE ?? '/tmp/gw-go-cache',
  GOTOOLCHAIN: process.env.GOTOOLCHAIN ?? 'local',
};

const workDir = mkdtempSync(path.join(tmpdir(), 'sw-playwright-server-'));
const cleanup = () => rmSync(workDir, { recursive: true, force: true });
process.once('exit', cleanup);
process.once('SIGINT', () => { cleanup(); process.exit(130); });
process.once('SIGTERM', () => { cleanup(); process.exit(143); });

/** 只改运行参数（端口 / data_dir / checkpoint_dir / tick 速率 / 审计保留），其余字段原样保留。 */
function renderConfig(source) {
  const dataDir = path.join(workDir, 'data');
  let config = readFileSync(source, 'utf8')
    .replace(/^ {2}port: .*/m, `  port: ${port}`)
    .replace(/^ {2}data_dir: .*/m, `  data_dir: "${dataDir}"`);
  // 命名存档点目录也指到临时目录：否则会写进仓库的 server/checkpoints-skirmish，
  // 而且多轮用例共用同一批存档点（试玩速查 §起停：playtest-up 同样把 checkpoint_dir 指出去）。
  if (/^ {2}checkpoint_dir:/m.test(config)) {
    config = config.replace(/^ {2}checkpoint_dir: .*/m, `  checkpoint_dir: "${path.join(workDir, 'checkpoints')}"`);
  }
  if (/^ {2}tick_rate_override:/m.test(config)) {
    config = config.replace(/^ {2}tick_rate_override: .*/m, `  tick_rate_override: ${tickRate}`);
  } else {
    config = config.replace(/^server:/m, `server:\n  tick_rate_override: ${tickRate}`);
  }
  // 整局保留审计日志（与 playtest-up.sh 同口径，checkpointbuild -export 需要完整命令史）。
  if (/^ {2}audit_retention_ticks:/m.test(config)) {
    config = config.replace(/^ {2}audit_retention_ticks: .*/m, '  audit_retention_ticks: 0');
  } else {
    config = config.replace(/^server:/m, 'server:\n  audit_retention_ticks: 0');
  }
  return config;
}

const configPath = path.join(workDir, 'server-config.yaml');
writeFileSync(configPath, renderConfig(configSource));

const build = spawn(path.join(goBin, 'go'), ['build', '-o', path.join(workDir, 'server-bin'), './cmd/server'], {
  cwd: path.join(repoRoot, 'server'),
  env,
  stdio: 'inherit',
});
build.on('exit', code => {
  if (code !== 0) {
    console.error(`[scenario-server] go build 失败（exit ${code}）`);
    process.exit(code ?? 1);
  }
  console.log(`[scenario-server] 起服务端 :${port}（${path.relative(repoRoot, configSource)} + ${path.relative(repoRoot, mapConfig)}，tick_rate_override=${tickRate}）`);
  const server = spawn(path.join(workDir, 'server-bin'), ['-config', configPath, '-map-config', mapConfig], {
    cwd: path.join(repoRoot, 'server'),
    stdio: 'inherit',
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.kill(signal));
  }
  server.on('exit', code => process.exit(code ?? 0));
});

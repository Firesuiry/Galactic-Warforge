/**
 * 起一个**新局**的服务端，给 Playwright 的 webServer 用。场景由环境变量决定：
 * - skirmish（默认，与 `scripts/playtest-up.sh` 同口径）：config-skirmish + map-skirmish；
 * - war：config-war + map-war（官方战争场景）。
 * 两者都是 tick_rate_override=4、全新临时 data_dir。
 *
 *   SW_SERVER_CONFIG=server/config-war.yaml SW_SERVER_MAP_CONFIG=server/map-war.yaml \
 *     node tests/support/start-scenario-server.mjs <port>
 *
 * 与 `scripts/playtest-up.sh` 的区别：这里只起服务端（Web 由 Playwright 的 vite dev 提供），
 * 所以 tick 速率、配置与地图都直接复用同一组默认值（见 ./scenario-env.ts）。改动时两边一起改。
 *
 * 端口由调用方传入（Playwright 配置里动态申请的空闲端口），脚本内不写死端口。
 * SIGTERM/SIGINT 时清理临时目录；父进程（Playwright）被 SIGKILL 时靠 stdin 关闭退出：
 * Playwright 的 webServer 用 `stdio: 'stdin'` 起进程，父进程一死管道就关，这里 `end` 即自杀，
 * 不会留下占着端口的孤儿服务端（动态端口本身也不会和下一轮撞车，但进程不能泄漏）。
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
let child = null;
const cleanup = () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
  rmSync(workDir, { recursive: true, force: true });
};
process.once('exit', cleanup);
process.once('SIGINT', () => { cleanup(); process.exit(130); });
process.once('SIGTERM', () => { cleanup(); process.exit(143); });
// 父进程被 SIGKILL（测试服被强杀/终端关闭）时 stdin 关闭：Playwright 用 stdio:'stdin' 起
// webServer，管道断开即视为父进程已死，整组退出，不留孤儿。
process.stdin.once('end', () => { cleanup(); process.exit(0); });
process.stdin.once('close', () => { cleanup(); process.exit(0); });
process.stdin.resume();

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
  } else {
    config = config.replace(/^server:/m, `server:\n  checkpoint_dir: "${path.join(workDir, 'checkpoints')}"`);
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
  child = spawn(path.join(workDir, 'server-bin'), ['-config', configPath, '-map-config', mapConfig], {
    cwd: path.join(repoRoot, 'server'),
    stdio: 'inherit',
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => child.kill(signal));
  }
  child.on('exit', code => process.exit(code ?? 0));
});

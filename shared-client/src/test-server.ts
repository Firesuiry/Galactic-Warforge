/**
 * 集成测试起停真实服务端的小工具（client-cli / agent-gateway 共用）。
 *
 * 为什么需要：
 * - 端口写死（19482/19483）时，上一轮异常退出留下的服务端还占着端口，
 *   新测试会连到**旧进程的旧存档**上，表现为莫名其妙的回归失败。
 *   这里每次先向内核要一个空闲端口（listen :0 再关掉），测试永远连自己起的进程。
 * - 服务端是 `bash 脚本 → 服务端进程` 两层，`child.kill()` 只杀脚本。
 *   统一用 `detached: true` 起进程（自成进程组），清理时 `kill(-pid)` 整组带走。
 */
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

/** 向内核申请一个当前空闲的 loopback 端口（close 之后有小概率被抢占，可接受）。 */
export async function findFreePort(host = '127.0.0.1'): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!port) {
    throw new Error('failed to allocate a free port');
  }
  return port;
}

/** 整组发信号（子进程必须以 detached: true 启动，否则退化为单进程 kill）。 */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) {
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // 已经退出
    }
  }
}

/** 先 SIGTERM 等退出，超时再 SIGKILL；after/finally 里调用。 */
export async function stopProcessTree(child: ChildProcess | undefined, timeoutMs = 5_000): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = once(child, 'exit').then(() => true);
  signalGroup(child, 'SIGTERM');
  if (await Promise.race([exited, delay(timeoutMs).then(() => false)])) {
    return;
  }
  signalGroup(child, 'SIGKILL');
  await Promise.race([exited, delay(1_000)]);
}

/**
 * 兜底清理：测试进程正常结束、或收到 SIGINT/SIGTERM（Ctrl-C）时都整组杀掉服务端。
 * node:test 的 after 钩子在被信号打断时不保证执行，这里直接挂进程级钩子。
 */
export function registerProcessCleanup(child: ChildProcess): void {
  const kill = () => signalGroup(child, 'SIGKILL');
  process.once('exit', kill);
  const onSignal = (signal: NodeJS.Signals) => {
    kill();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
}

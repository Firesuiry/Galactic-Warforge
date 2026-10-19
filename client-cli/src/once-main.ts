import readline from 'readline';

import { createOnceRunner, onceConfigFromEnv } from './once.js';

async function readStdin(): Promise<string[]> {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }
  return lines;
}

async function main() {
  const args = process.argv.slice(2);
  const batch = args[0] === '--stdin';
  const config = onceConfigFromEnv();
  const runner = createOnceRunner({ config });

  let ok: boolean;
  if (batch) {
    ok = await runner.runLines(await readStdin());
  } else {
    ok = await runner.run(args.join(' '));
  }
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(`sw: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});

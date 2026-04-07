import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface RunCliCommandInput {
  command: string;
  args: string[];
  cwd?: string;
  envOverrides?: Record<string, string>;
}

function shellEscape(value: string) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

export async function runCliCommand(input: RunCliCommandInput) {
  const commandLine = [input.command, ...input.args]
    .map(shellEscape)
    .join(' ');
  const { stdout, stderr } = await execFileAsync(
    'bash',
    ['-lc', `${commandLine} </dev/null`],
    {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...(input.envOverrides ?? {}),
      },
      maxBuffer: 1024 * 1024,
    },
  );

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

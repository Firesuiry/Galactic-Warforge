export interface ParsedArgs {
  positionals: string[];
  options: Record<string, string | boolean>;
}

export function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--') || arg === '--') {
      positionals.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    i += 1;
  }

  return { positionals, options };
}

export function hasFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.options[name] === true;
}

export function getStringOption(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.options[name];
  return typeof value === 'string' ? value : undefined;
}

export function parseIntegerArg(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? undefined : value;
}

export function parseNumberArg(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isNaN(value) ? undefined : value;
}

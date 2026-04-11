export const GAME_COMMAND_NAMES = [
  'scan_galaxy',
  'scan_system',
  'scan_planet',
  'build',
  'start_research',
  'transfer_item',
  'switch_active_planet',
  'set_ray_receiver_mode',
] as const;

export type CanonicalGameCommandName = typeof GAME_COMMAND_NAMES[number];

export type CanonicalGameCommandAction =
  | { type: 'game.command'; command: 'scan_galaxy'; args: { galaxyId?: string } }
  | { type: 'game.command'; command: 'scan_system'; args: { systemId: string } }
  | { type: 'game.command'; command: 'scan_planet'; args: { planetId: string } }
  | {
      type: 'game.command';
      command: 'build';
      args: {
        x: number;
        y: number;
        z?: number;
        buildingType: string;
        direction?: 'north' | 'east' | 'south' | 'west' | 'auto';
        recipeId?: string;
      };
    }
  | { type: 'game.command'; command: 'start_research'; args: { techId: string } }
  | {
      type: 'game.command';
      command: 'transfer_item';
      args: { buildingId: string; itemId: string; quantity: number };
    }
  | { type: 'game.command'; command: 'switch_active_planet'; args: { planetId: string } }
  | {
      type: 'game.command';
      command: 'set_ray_receiver_mode';
      args: { buildingId: string; mode: 'power' | 'photon' | 'hybrid' };
    };

const OBSERVE_GAME_COMMANDS = new Set<CanonicalGameCommandName>([
  'scan_galaxy',
  'scan_system',
  'scan_planet',
]);

const BUILD_DIRECTIONS = new Set(['north', 'east', 'south', 'west', 'auto']);
const RAY_RECEIVER_MODES = new Set(['power', 'photon', 'hybrid']);

function asRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function asFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function requireArgsRecord(value: unknown, command: CanonicalGameCommandName) {
  const args = asRecord(value);
  if (!args) {
    throw new Error(`${command} requires args`);
  }
  return args;
}

function requireString(
  args: Record<string, unknown>,
  fieldName: string,
  command: CanonicalGameCommandName,
) {
  const value = asString(args[fieldName]);
  if (!value) {
    throw new Error(`${command} requires ${fieldName}`);
  }
  return value;
}

function requireInteger(
  args: Record<string, unknown>,
  fieldName: string,
  command: CanonicalGameCommandName,
) {
  const value = asFiniteNumber(args[fieldName]);
  if (value === undefined || !Number.isInteger(value)) {
    throw new Error(`${command} requires integer ${fieldName}`);
  }
  return value;
}

function optionalInteger(
  args: Record<string, unknown>,
  fieldName: string,
  command: CanonicalGameCommandName,
) {
  if (args[fieldName] === undefined) {
    return undefined;
  }
  return requireInteger(args, fieldName, command);
}

export function normalizeGameCommandAction(action: Record<string, unknown>): CanonicalGameCommandAction {
  const command = asString(action.command) as CanonicalGameCommandName;
  if (!GAME_COMMAND_NAMES.includes(command)) {
    throw new Error(`unsupported game.command ${String(action.command ?? '')}`);
  }

  if (command === 'scan_galaxy') {
    const args = asRecord(action.args) ?? {};
    const galaxyId = asString(args.galaxyId);
    return {
      type: 'game.command',
      command,
      args: galaxyId ? { galaxyId } : {},
    };
  }

  if (command === 'scan_system') {
    const args = requireArgsRecord(action.args, command);
    return {
      type: 'game.command',
      command,
      args: { systemId: requireString(args, 'systemId', command) },
    };
  }

  if (command === 'scan_planet') {
    const args = requireArgsRecord(action.args, command);
    return {
      type: 'game.command',
      command,
      args: { planetId: requireString(args, 'planetId', command) },
    };
  }

  if (command === 'build') {
    const args = requireArgsRecord(action.args, command);
    const direction = asString(args.direction);
    if (direction && !BUILD_DIRECTIONS.has(direction)) {
      throw new Error('build direction must be north/east/south/west/auto');
    }
    return {
      type: 'game.command',
      command,
      args: {
        x: requireInteger(args, 'x', command),
        y: requireInteger(args, 'y', command),
        ...(optionalInteger(args, 'z', command) !== undefined
          ? { z: optionalInteger(args, 'z', command) }
          : {}),
        buildingType: requireString(args, 'buildingType', command),
        ...(direction ? { direction: direction as 'north' | 'east' | 'south' | 'west' | 'auto' } : {}),
        ...(asString(args.recipeId) ? { recipeId: asString(args.recipeId) } : {}),
      },
    };
  }

  if (command === 'start_research') {
    const args = requireArgsRecord(action.args, command);
    return {
      type: 'game.command',
      command,
      args: { techId: requireString(args, 'techId', command) },
    };
  }

  if (command === 'transfer_item') {
    const args = requireArgsRecord(action.args, command);
    const quantity = requireInteger(args, 'quantity', command);
    if (quantity <= 0) {
      throw new Error('transfer_item requires positive quantity');
    }
    return {
      type: 'game.command',
      command,
      args: {
        buildingId: requireString(args, 'buildingId', command),
        itemId: requireString(args, 'itemId', command),
        quantity,
      },
    };
  }

  if (command === 'switch_active_planet') {
    const args = requireArgsRecord(action.args, command);
    return {
      type: 'game.command',
      command,
      args: { planetId: requireString(args, 'planetId', command) },
    };
  }

  const args = requireArgsRecord(action.args, command);
  const mode = requireString(args, 'mode', command);
  if (!RAY_RECEIVER_MODES.has(mode)) {
    throw new Error('set_ray_receiver_mode mode must be power/photon/hybrid');
  }
  return {
    type: 'game.command',
    command,
    args: {
      buildingId: requireString(args, 'buildingId', command),
      mode: mode as 'power' | 'photon' | 'hybrid',
    },
  };
}

export function serializeGameCommandAction(action: CanonicalGameCommandAction) {
  switch (action.command) {
    case 'scan_galaxy':
      return action.args.galaxyId ? `scan_galaxy ${action.args.galaxyId}` : 'scan_galaxy';
    case 'scan_system':
      return `scan_system ${action.args.systemId}`;
    case 'scan_planet':
      return `scan_planet ${action.args.planetId}`;
    case 'build': {
      const parts = [
        'build',
        String(action.args.x),
        String(action.args.y),
        action.args.buildingType,
      ];
      if (action.args.z !== undefined) {
        parts.push('--z', String(action.args.z));
      }
      if (action.args.direction) {
        parts.push('--direction', action.args.direction);
      }
      if (action.args.recipeId) {
        parts.push('--recipe', action.args.recipeId);
      }
      return parts.join(' ');
    }
    case 'start_research':
      return `start_research ${action.args.techId}`;
    case 'transfer_item':
      return `transfer ${action.args.buildingId} ${action.args.itemId} ${action.args.quantity}`;
    case 'switch_active_planet':
      return `switch_active_planet ${action.args.planetId}`;
    case 'set_ray_receiver_mode':
      return `set_ray_receiver_mode ${action.args.buildingId} ${action.args.mode}`;
    default:
      return action satisfies never;
  }
}

export function summarizeGameCommandAction(action: CanonicalGameCommandAction) {
  switch (action.command) {
    case 'scan_galaxy':
      return action.args.galaxyId ? `扫描星系群 ${action.args.galaxyId}` : '扫描默认星系群';
    case 'scan_system':
      return `扫描恒星系 ${action.args.systemId}`;
    case 'scan_planet':
      return `扫描行星 ${action.args.planetId}`;
    case 'build':
      return `建造 ${action.args.buildingType} @ (${action.args.x}, ${action.args.y})`;
    case 'start_research':
      return `启动研究 ${action.args.techId}`;
    case 'transfer_item':
      return `装料 ${action.args.itemId} x${action.args.quantity} -> ${action.args.buildingId}`;
    case 'switch_active_planet':
      return `切换 active planet 到 ${action.args.planetId}`;
    case 'set_ray_receiver_mode':
      return `切换射线接收站 ${action.args.buildingId} -> ${action.args.mode}`;
    default:
      return action satisfies never;
  }
}

export function isObserveGameCommand(command: CanonicalGameCommandName) {
  return OBSERVE_GAME_COMMANDS.has(command);
}

export function isObserveGameCommandAction(action: { command: CanonicalGameCommandName }) {
  return isObserveGameCommand(action.command);
}

export function listSupportedGameCommandsForPrompt(allowedCommands?: string[]) {
  if (!allowedCommands?.length) {
    return [...GAME_COMMAND_NAMES];
  }

  const allowed = new Set(allowedCommands);
  const mapped = GAME_COMMAND_NAMES.filter((command) => (
    allowed.has(command)
    || (command === 'transfer_item' && allowed.has('transfer'))
  ));

  return mapped.length > 0 ? mapped : [...GAME_COMMAND_NAMES];
}

export const GAME_COMMAND_NAMES = [
  'scan_galaxy',
  'scan_system',
  'scan_planet',
  'system_runtime',
  'war_industry',
  'task_forces',
  'theaters',
  'build',
  'start_research',
  'transfer_item',
  'switch_active_planet',
  'set_ray_receiver_mode',
  'queue_military_production',
  'task_force_set_stance',
  'task_force_deploy',
  'blockade_planet',
  'landing_start',
] as const;

export type CanonicalGameCommandName = typeof GAME_COMMAND_NAMES[number];

export type CanonicalGameCommandAction =
  | { type: 'game.command'; command: 'scan_galaxy'; args: { galaxyId?: string } }
  | { type: 'game.command'; command: 'scan_system'; args: { systemId: string } }
  | { type: 'game.command'; command: 'scan_planet'; args: { planetId: string } }
  | { type: 'game.command'; command: 'system_runtime'; args: { systemId: string } }
  | { type: 'game.command'; command: 'war_industry'; args: {} }
  | { type: 'game.command'; command: 'task_forces'; args: {} }
  | { type: 'game.command'; command: 'theaters'; args: {} }
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
    }
  | {
      type: 'game.command';
      command: 'queue_military_production';
      args: {
        buildingId: string;
        deploymentHubId: string;
        blueprintId: string;
        count?: number;
      };
    }
  | {
      type: 'game.command';
      command: 'task_force_set_stance';
      args: {
        taskForceId: string;
        stance: 'hold' | 'patrol' | 'escort' | 'intercept' | 'harass' | 'siege' | 'bombard' | 'retreat_on_losses';
      };
    }
  | {
      type: 'game.command';
      command: 'task_force_deploy';
      args: {
        taskForceId: string;
        theaterId?: string;
        systemId?: string;
        planetId?: string;
        position?: {
          x: number;
          y: number;
          z?: number;
        };
        frontlineId?: string;
        groundOrder?: 'occupy' | 'advance' | 'hold' | 'clear_obstacles' | 'escort_supply';
        supportMode?: 'none' | 'fire_support' | 'strike';
      };
    }
  | {
      type: 'game.command';
      command: 'blockade_planet';
      args: {
        taskForceId: string;
        planetId: string;
      };
    }
  | {
      type: 'game.command';
      command: 'landing_start';
      args: {
        taskForceId: string;
        planetId: string;
        operationId?: string;
      };
    };

const OBSERVE_GAME_COMMANDS = new Set<CanonicalGameCommandName>([
  'scan_galaxy',
  'scan_system',
  'scan_planet',
  'system_runtime',
  'war_industry',
  'task_forces',
  'theaters',
]);

const BUILD_DIRECTIONS = new Set(['north', 'east', 'south', 'west', 'auto']);
const RAY_RECEIVER_MODES = new Set(['power', 'photon', 'hybrid']);
const TASK_FORCE_STANCES = new Set([
  'hold',
  'patrol',
  'escort',
  'intercept',
  'harass',
  'siege',
  'bombard',
  'retreat_on_losses',
]);
const GROUND_ORDERS = new Set(['occupy', 'advance', 'hold', 'clear_obstacles', 'escort_supply']);
const SUPPORT_MODES = new Set(['none', 'fire_support', 'strike']);
const ARG_ALIASES: Partial<Record<string, string[]>> = {
  systemId: ['system_id'],
  planetId: ['planet_id'],
  buildingType: ['building_type'],
  recipeId: ['recipe_id'],
  techId: ['tech_id'],
  buildingId: ['building_id'],
  itemId: ['item_id'],
  deploymentHubId: ['deployment_hub_id'],
  blueprintId: ['blueprint_id'],
  taskForceId: ['task_force_id'],
  theaterId: ['theater_id'],
  frontlineId: ['frontline_id'],
  groundOrder: ['ground_order'],
  supportMode: ['support_mode'],
  operationId: ['operation_id'],
};

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

function getArgValue(args: Record<string, unknown>, fieldName: string) {
  for (const key of [fieldName, ...(ARG_ALIASES[fieldName] ?? [])]) {
    if (args[key] !== undefined) {
      return args[key];
    }
  }
  return undefined;
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
  const value = asString(getArgValue(args, fieldName));
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
  const value = asFiniteNumber(getArgValue(args, fieldName));
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
  if (getArgValue(args, fieldName) === undefined) {
    return undefined;
  }
  return requireInteger(args, fieldName, command);
}

function parseOptionalPosition(args: Record<string, unknown>, command: CanonicalGameCommandName) {
  const hasX = getArgValue(args, 'x') !== undefined;
  const hasY = getArgValue(args, 'y') !== undefined;
  if (!hasX && !hasY) {
    return undefined;
  }
  return {
    x: requireInteger(args, 'x', command),
    y: requireInteger(args, 'y', command),
    ...(optionalInteger(args, 'z', command) !== undefined ? { z: optionalInteger(args, 'z', command) } : {}),
  };
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

  if (command === 'scan_system' || command === 'system_runtime') {
    const args = requireArgsRecord(action.args, command);
    return {
      type: 'game.command',
      command,
      args: { systemId: requireString(args, 'systemId', command) },
    } as CanonicalGameCommandAction;
  }

  if (command === 'scan_planet') {
    const args = requireArgsRecord(action.args, command);
    return {
      type: 'game.command',
      command,
      args: { planetId: requireString(args, 'planetId', command) },
    };
  }

  if (command === 'war_industry' || command === 'task_forces' || command === 'theaters') {
    return {
      type: 'game.command',
      command,
      args: {},
    } as CanonicalGameCommandAction;
  }

  if (command === 'build') {
    const args = requireArgsRecord(action.args, command);
    const direction = asString(getArgValue(args, 'direction'));
    if (direction && !BUILD_DIRECTIONS.has(direction)) {
      throw new Error('build direction must be north/east/south/west/auto');
    }
    const z = optionalInteger(args, 'z', command);
    const recipeId = asString(getArgValue(args, 'recipeId'));
    return {
      type: 'game.command',
      command,
      args: {
        x: requireInteger(args, 'x', command),
        y: requireInteger(args, 'y', command),
        ...(z !== undefined ? { z } : {}),
        buildingType: requireString(args, 'buildingType', command),
        ...(direction ? { direction: direction as 'north' | 'east' | 'south' | 'west' | 'auto' } : {}),
        ...(recipeId ? { recipeId } : {}),
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

  if (command === 'set_ray_receiver_mode') {
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

  if (command === 'queue_military_production') {
    const args = requireArgsRecord(action.args, command);
    const count = optionalInteger(args, 'count', command);
    if (count !== undefined && count <= 0) {
      throw new Error('queue_military_production requires positive count');
    }
    return {
      type: 'game.command',
      command,
      args: {
        buildingId: requireString(args, 'buildingId', command),
        deploymentHubId: requireString(args, 'deploymentHubId', command),
        blueprintId: requireString(args, 'blueprintId', command),
        ...(count !== undefined ? { count } : {}),
      },
    };
  }

  if (command === 'task_force_set_stance') {
    const args = requireArgsRecord(action.args, command);
    const stance = requireString(args, 'stance', command);
    if (!TASK_FORCE_STANCES.has(stance)) {
      throw new Error('task_force_set_stance stance unsupported');
    }
    return {
      type: 'game.command',
      command,
      args: {
        taskForceId: requireString(args, 'taskForceId', command),
        stance: stance as 'hold' | 'patrol' | 'escort' | 'intercept' | 'harass' | 'siege' | 'bombard' | 'retreat_on_losses',
      },
    };
  }

  if (command === 'task_force_deploy') {
    const args = requireArgsRecord(action.args, command);
    const groundOrder = asString(getArgValue(args, 'groundOrder'));
    if (groundOrder && !GROUND_ORDERS.has(groundOrder)) {
      throw new Error('task_force_deploy groundOrder unsupported');
    }
    const supportMode = asString(getArgValue(args, 'supportMode'));
    if (supportMode && !SUPPORT_MODES.has(supportMode)) {
      throw new Error('task_force_deploy supportMode unsupported');
    }
    return {
      type: 'game.command',
      command,
      args: {
        taskForceId: requireString(args, 'taskForceId', command),
        ...(asString(getArgValue(args, 'theaterId')) ? { theaterId: asString(getArgValue(args, 'theaterId')) } : {}),
        ...(asString(getArgValue(args, 'systemId')) ? { systemId: asString(getArgValue(args, 'systemId')) } : {}),
        ...(asString(getArgValue(args, 'planetId')) ? { planetId: asString(getArgValue(args, 'planetId')) } : {}),
        ...(parseOptionalPosition(args, command) ? { position: parseOptionalPosition(args, command) } : {}),
        ...(asString(getArgValue(args, 'frontlineId')) ? { frontlineId: asString(getArgValue(args, 'frontlineId')) } : {}),
        ...(groundOrder ? { groundOrder: groundOrder as 'occupy' | 'advance' | 'hold' | 'clear_obstacles' | 'escort_supply' } : {}),
        ...(supportMode ? { supportMode: supportMode as 'none' | 'fire_support' | 'strike' } : {}),
      },
    };
  }

  if (command === 'blockade_planet') {
    const args = requireArgsRecord(action.args, command);
    return {
      type: 'game.command',
      command,
      args: {
        taskForceId: requireString(args, 'taskForceId', command),
        planetId: requireString(args, 'planetId', command),
      },
    };
  }

  const args = requireArgsRecord(action.args, command);
  return {
    type: 'game.command',
    command,
    args: {
      taskForceId: requireString(args, 'taskForceId', command),
      planetId: requireString(args, 'planetId', command),
      ...(asString(getArgValue(args, 'operationId')) ? { operationId: asString(getArgValue(args, 'operationId')) } : {}),
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
    case 'system_runtime':
      return `system_runtime ${action.args.systemId}`;
    case 'war_industry':
      return 'war_industry';
    case 'task_forces':
      return 'task_forces';
    case 'theaters':
      return 'theaters';
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
    case 'queue_military_production': {
      const parts = [
        'queue_military_production',
        action.args.buildingId,
        action.args.deploymentHubId,
        action.args.blueprintId,
      ];
      if (action.args.count !== undefined) {
        parts.push('--count', String(action.args.count));
      }
      return parts.join(' ');
    }
    case 'task_force_set_stance':
      return `task_force_set_stance ${action.args.taskForceId} ${action.args.stance}`;
    case 'task_force_deploy': {
      const parts = ['task_force_deploy', action.args.taskForceId];
      if (action.args.theaterId) {
        parts.push('--theater', action.args.theaterId);
      }
      if (action.args.systemId) {
        parts.push('--system', action.args.systemId);
      }
      if (action.args.planetId) {
        parts.push('--planet', action.args.planetId);
      }
      if (action.args.position) {
        parts.push('--x', String(action.args.position.x), '--y', String(action.args.position.y));
        if (action.args.position.z !== undefined) {
          parts.push('--z', String(action.args.position.z));
        }
      }
      if (action.args.frontlineId) {
        parts.push('--frontline', action.args.frontlineId);
      }
      if (action.args.groundOrder) {
        parts.push('--ground-order', action.args.groundOrder);
      }
      if (action.args.supportMode) {
        parts.push('--support-mode', action.args.supportMode);
      }
      return parts.join(' ');
    }
    case 'blockade_planet':
      return `blockade_planet ${action.args.taskForceId} ${action.args.planetId}`;
    case 'landing_start': {
      const parts = ['landing_start', action.args.taskForceId, action.args.planetId];
      if (action.args.operationId) {
        parts.push('--operation-id', action.args.operationId);
      }
      return parts.join(' ');
    }
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
    case 'system_runtime':
      return `查看恒星系 ${action.args.systemId} 战争运行态`;
    case 'war_industry':
      return '查看战争工业总览';
    case 'task_forces':
      return '查看任务群态势';
    case 'theaters':
      return '查看战区态势';
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
    case 'queue_military_production':
      return `军工排产 ${action.args.blueprintId} x${action.args.count ?? 1}`;
    case 'task_force_set_stance':
      return `任务群 ${action.args.taskForceId} 切换到 ${action.args.stance}`;
    case 'task_force_deploy':
      return `部署任务群 ${action.args.taskForceId} 到 ${action.args.theaterId ?? action.args.systemId ?? action.args.planetId ?? '指定位置'}`;
    case 'blockade_planet':
      return `命令任务群 ${action.args.taskForceId} 封锁 ${action.args.planetId}`;
    case 'landing_start':
      return `命令任务群 ${action.args.taskForceId} 对 ${action.args.planetId} 发起登陆`;
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

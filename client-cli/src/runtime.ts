import { createApiClient } from '../../shared-client/src/api.js';
import { setAuth, setServerUrl } from './api.js';
import { AGENT_ALLOWED_COMMANDS, getAllowedCommandsByCategories, getCommandCategory } from './command-catalog.js';
import { parseArgs, getStringOption } from './commands/args.js';
import { dispatch } from './commands/index.js';

export interface GameCliRuntimeContext {
  currentPlayer: string;
  serverUrl: string;
  playerKey: string;
}

export interface AgentMilitaryCommandRuntimePolicy {
  theaterIds?: string[];
  taskForceIds?: string[];
  allowedCommandIds?: string[];
  maxMilitaryProductionCount?: number;
  allowBlockade?: boolean;
  allowLanding?: boolean;
  allowMilitaryProduction?: boolean;
}

export interface AgentCommandRuntimePolicy {
  allowedCategories?: string[];
  allowedPlanetIds?: string[];
  military?: AgentMilitaryCommandRuntimePolicy;
}

interface CommandScopeMetadata {
  commandName: string;
  planetIds: string[];
  systemIds: string[];
  theaterIds: string[];
  taskForceIds: string[];
  productionCount?: number;
  military: boolean;
}

const MILITARY_COMMANDS = new Set([
  'system_runtime',
  'war_industry',
  'task_forces',
  'theaters',
  'queue_military_production',
  'task_force_set_stance',
  'task_force_deploy',
  'blockade_planet',
  'landing_start',
]);

const MILITARY_PRODUCTION_COMMANDS = new Set([
  'queue_military_production',
]);

function parseCommandMetadata(line: string): CommandScopeMetadata {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  const commandName = parts[0]?.toLowerCase() ?? '';
  const parsed = parseArgs(parts.slice(1));
  const metadata: CommandScopeMetadata = {
    commandName,
    planetIds: [],
    systemIds: [],
    theaterIds: [],
    taskForceIds: [],
    military: MILITARY_COMMANDS.has(commandName),
  };

  switch (commandName) {
    case 'system_runtime':
      if (parsed.positionals[0]) {
        metadata.systemIds.push(parsed.positionals[0]);
      }
      return metadata;
    case 'queue_military_production':
      if (parsed.positionals[0]) {
        metadata.taskForceIds = [];
      }
      metadata.productionCount = getStringOption(parsed, 'count')
        ? Number.parseInt(getStringOption(parsed, 'count') as string, 10)
        : 1;
      return metadata;
    case 'task_force_set_stance':
      if (parsed.positionals[0]) {
        metadata.taskForceIds.push(parsed.positionals[0]);
      }
      return metadata;
    case 'task_force_deploy':
      if (parsed.positionals[0]) {
        metadata.taskForceIds.push(parsed.positionals[0]);
      }
      if (getStringOption(parsed, 'theater')) {
        metadata.theaterIds.push(getStringOption(parsed, 'theater') as string);
      }
      if (getStringOption(parsed, 'system')) {
        metadata.systemIds.push(getStringOption(parsed, 'system') as string);
      }
      if (getStringOption(parsed, 'planet')) {
        metadata.planetIds.push(getStringOption(parsed, 'planet') as string);
      }
      return metadata;
    case 'blockade_planet':
      if (parsed.positionals[0]) {
        metadata.taskForceIds.push(parsed.positionals[0]);
      }
      if (parsed.positionals[1]) {
        metadata.planetIds.push(parsed.positionals[1]);
      }
      return metadata;
    case 'landing_start':
      if (parsed.positionals[0]) {
        metadata.taskForceIds.push(parsed.positionals[0]);
      }
      if (parsed.positionals[1]) {
        metadata.planetIds.push(parsed.positionals[1]);
      }
      return metadata;
    default:
      return metadata;
  }
}

function extractExplicitPlanetIds(line: string, metadata: CommandScopeMetadata) {
  const tokenPlanets = line
    .trim()
    .split(/\s+/)
    .filter((token) => token.startsWith('planet-'));
  return [...new Set([...tokenPlanets, ...metadata.planetIds])];
}

async function loadMilitaryScope(
  context: GameCliRuntimeContext,
  military: AgentMilitaryCommandRuntimePolicy,
) {
  const api = createApiClient({
    serverUrl: context.serverUrl,
    auth: {
      playerId: context.currentPlayer,
      playerKey: context.playerKey,
    },
  });

  const [theaterList, taskForceList] = await Promise.all([
    api.fetchWarTheaters(),
    api.fetchWarTaskForces(),
  ]);

  const theaterIds = new Set(military.theaterIds ?? []);
  const taskForceIds = new Set(military.taskForceIds ?? []);
  const systemIds = new Set<string>();
  const planetIds = new Set<string>();

  for (const theater of theaterList.theaters ?? []) {
    if (!theaterIds.has(theater.id)) {
      continue;
    }
    for (const zone of theater.zones ?? []) {
      if (zone.system_id) {
        systemIds.add(zone.system_id);
      }
      if (zone.planet_id) {
        planetIds.add(zone.planet_id);
      }
    }
    if (theater.objective?.system_id) {
      systemIds.add(theater.objective.system_id);
    }
    if (theater.objective?.planet_id) {
      planetIds.add(theater.objective.planet_id);
    }
  }

  for (const taskForce of taskForceList.task_forces ?? []) {
    if (!taskForceIds.has(taskForce.id)) {
      continue;
    }
    if (taskForce.theater_id) {
      theaterIds.add(taskForce.theater_id);
    }
    if (taskForce.deployment?.system_id) {
      systemIds.add(taskForce.deployment.system_id);
    }
    if (taskForce.deployment?.planet_id) {
      planetIds.add(taskForce.deployment.planet_id);
    }
  }

  return { theaterIds, taskForceIds, systemIds, planetIds };
}

async function validateMilitaryCommand(
  metadata: CommandScopeMetadata,
  context: GameCliRuntimeContext,
  military: AgentMilitaryCommandRuntimePolicy | undefined,
) {
  if (!metadata.military) {
    return;
  }

  if (!military) {
    throw new Error(`military command not allowed without delegated policy: ${metadata.commandName}`);
  }
  if ((military.theaterIds?.length ?? 0) === 0 && (military.taskForceIds?.length ?? 0) === 0) {
    throw new Error(`military scope not delegated to agent: ${metadata.commandName}`);
  }
  if (!(military.allowedCommandIds ?? []).includes(metadata.commandName)) {
    throw new Error(`military command not allowed for agent: ${metadata.commandName}`);
  }
  if (metadata.commandName === 'blockade_planet' && !military.allowBlockade) {
    throw new Error('blockade_planet requires player approval');
  }
  if (metadata.commandName === 'landing_start' && !military.allowLanding) {
    throw new Error('landing_start requires player approval');
  }
  if (MILITARY_PRODUCTION_COMMANDS.has(metadata.commandName) && !military.allowMilitaryProduction) {
    throw new Error(`${metadata.commandName} requires player approval`);
  }
  if (
    MILITARY_PRODUCTION_COMMANDS.has(metadata.commandName)
    && (metadata.productionCount ?? 1) > (military.maxMilitaryProductionCount ?? 0)
  ) {
    throw new Error(`${metadata.commandName} exceeds military production limit`);
  }

  const scope = await loadMilitaryScope(context, military);
  const disallowedTaskForce = metadata.taskForceIds.find((taskForceId) => !scope.taskForceIds.has(taskForceId));
  if (disallowedTaskForce) {
    throw new Error(`task force not allowed for agent: ${disallowedTaskForce}`);
  }
  const disallowedTheater = metadata.theaterIds.find((theaterId) => !scope.theaterIds.has(theaterId));
  if (disallowedTheater) {
    throw new Error(`theater not allowed for agent: ${disallowedTheater}`);
  }
  const disallowedSystem = metadata.systemIds.find((systemId) => scope.systemIds.size > 0 && !scope.systemIds.has(systemId));
  if (disallowedSystem) {
    throw new Error(`system not allowed for agent: ${disallowedSystem}`);
  }
  const disallowedPlanet = metadata.planetIds.find((planetId) => scope.planetIds.size > 0 && !scope.planetIds.has(planetId));
  if (disallowedPlanet) {
    throw new Error(`planet not allowed for agent: ${disallowedPlanet}`);
  }
}

export function getAgentAllowedCommands(policy?: AgentCommandRuntimePolicy) {
  return policy?.allowedCategories?.length
    ? getAllowedCommandsByCategories(policy.allowedCategories)
    : [...AGENT_ALLOWED_COMMANDS];
}

export async function runCommandLine(line: string, context: GameCliRuntimeContext, policy?: AgentCommandRuntimePolicy) {
  const metadata = parseCommandMetadata(line);
  const commandName = metadata.commandName;
  const allowedCommands = getAgentAllowedCommands(policy);

  if (policy?.allowedCategories?.length && commandName !== 'help') {
    const category = getCommandCategory(commandName);
    if (!category || !policy.allowedCategories.includes(category)) {
      throw new Error(`command category not allowed for agent: ${commandName}`);
    }
  }

  if (!allowedCommands.includes(commandName as typeof AGENT_ALLOWED_COMMANDS[number]) && commandName !== 'help') {
    throw new Error(`command not allowed for agent: ${commandName}`);
  }

  const explicitPlanetIds = extractExplicitPlanetIds(line, metadata);
  if (policy?.allowedPlanetIds?.length) {
    const disallowedPlanetId = explicitPlanetIds.find((planetId) => !policy.allowedPlanetIds?.includes(planetId));
    if (disallowedPlanetId) {
      throw new Error(`planet not allowed for agent: ${disallowedPlanetId}`);
    }
  }

  if (commandName !== 'help') {
    await validateMilitaryCommand(metadata, context, policy?.military);
  }

  setServerUrl(context.serverUrl);
  setAuth(context.currentPlayer, context.playerKey);

  return dispatch(line, {
    currentPlayer: context.currentPlayer,
    rl: {} as never,
  });
}

import {
  cmdScanGalaxy as apiScanGalaxy,
  cmdScanSystem as apiScanSystem,
  cmdScanPlanet as apiScanPlanet,
  sendCommandRequest,
  cmdBuild as apiBuild,
  cmdMove as apiMove,
  cmdAttack as apiAttack,
  cmdProduce as apiProduce,
  cmdUpgrade as apiUpgrade,
  cmdDemolish as apiDemolish,
  cmdConfigureLogisticsStation as apiConfigureLogisticsStation,
  cmdConfigureLogisticsSlot as apiConfigureLogisticsSlot,
  cmdCancelConstruction as apiCancelConstruction,
  cmdRestoreConstruction as apiRestoreConstruction,
  cmdStartResearch as apiStartResearch,
  cmdCancelResearch as apiCancelResearch,
  cmdCommissionFleet as apiCommissionFleet,
  cmdDeploySquad as apiDeploySquad,
  cmdFleetAssign as apiFleetAssign,
  cmdFleetAttack as apiFleetAttack,
  cmdFleetDisband as apiFleetDisband,
  cmdTransferItem as apiTransferItem,
  cmdSwitchActivePlanet as apiSwitchActivePlanet,
  cmdSetRayReceiverMode as apiSetRayReceiverMode,
  cmdLaunchRocket as apiLaunchRocket,
  cmdLaunchSolarSail as apiLaunchSolarSail,
  cmdBuildDysonNode as apiBuildDysonNode,
  cmdBuildDysonFrame as apiBuildDysonFrame,
  cmdBuildDysonShell as apiBuildDysonShell,
  cmdDemolishDyson as apiDemolishDyson,
  type FleetFormation,
  type ConfigureLogisticsStationOptions,
  type Direction,
  type DysonComponentType,
  type RayReceiverMode,
} from '../api.js';
import { fmtCommandResponse, fmtError } from '../format.js';
import type { CommandRequest, Position } from '../types.js';
import { getStringOption, parseArgs, parseIntegerArg, parseNumberArg } from './args.js';

const DIRECTIONS = new Set<Direction>(['north', 'east', 'south', 'west', 'auto']);
const DYSON_COMPONENT_TYPES = new Set<DysonComponentType>(['node', 'frame', 'shell']);
const LOGISTICS_SCOPES = new Set(['planetary', 'interstellar']);
const LOGISTICS_MODES = new Set(['none', 'supply', 'demand', 'both']);
const RAY_RECEIVER_MODES = new Set<RayReceiverMode>(['power', 'photon', 'hybrid']);
const SQUAD_UNITS = new Set(['prototype', 'precision_drone']);
const FLEET_UNITS = new Set(['corvette', 'destroyer']);
const FLEET_FORMATIONS = new Set<FleetFormation>(['line', 'vee', 'circle', 'wedge']);

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireInt(raw: string | undefined, label: string): number {
  const value = parseIntegerArg(raw);
  if (value === undefined) {
    throw new Error(`${label} 必须是整数`);
  }
  return value;
}

function requireNumber(raw: string | undefined, label: string): number {
  const value = parseNumberArg(raw);
  if (value === undefined) {
    throw new Error(`${label} 必须是数字`);
  }
  return value;
}

function parseBooleanOption(raw: string | boolean | undefined, label: string): boolean | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === true || raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  throw new Error(`${label} 必须是 true 或 false`);
}

function parsePosition(xRaw: string | undefined, yRaw: string | undefined, zRaw?: string): Position {
  return {
    x: requireInt(xRaw, 'x'),
    y: requireInt(yRaw, 'y'),
    z: zRaw !== undefined ? requireInt(zRaw, 'z') : 0,
  };
}

export async function cmdScanGalaxy(args: string[]): Promise<string> {
  const galaxyId = args[0] ?? 'galaxy-1';
  try {
    return fmtCommandResponse(await apiScanGalaxy(galaxyId));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdScanSystem(args: string[]): Promise<string> {
  const systemId = args[0];
  if (!systemId) {
    return fmtError('Usage: scan_system <system_id>');
  }
  try {
    return fmtCommandResponse(await apiScanSystem(systemId));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdScanPlanet(args: string[]): Promise<string> {
  const planetId = args[0];
  if (!planetId) {
    return fmtError('Usage: scan_planet <planet_id>');
  }
  try {
    return fmtCommandResponse(await apiScanPlanet(planetId));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdRaw(args: string[]): Promise<string> {
  if (args.length < 1) {
    return fmtError('Usage: raw <json>');
  }
  const json = args.join(' ');
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fmtError('Raw expects a full /commands request object');
    }
    const req = parsed as CommandRequest;
    if (!req.request_id || !req.issuer_type || !req.issuer_id || !Array.isArray(req.commands)) {
      return fmtError('Raw requires request_id, issuer_type, issuer_id, commands[]');
    }
    return fmtCommandResponse(await sendCommandRequest(req));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdBuild(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  if (parsed.positionals.length < 3) {
    return fmtError('Usage: build <x> <y> <building_type> [--z <z>] [--direction <dir>] [--recipe <recipe_id>]');
  }
  try {
    const position = parsePosition(
      parsed.positionals[0],
      parsed.positionals[1],
      getStringOption(parsed, 'z'),
    );
    const direction = getStringOption(parsed, 'direction');
    if (direction && !DIRECTIONS.has(direction as Direction)) {
      return fmtError('direction 必须是 north/east/south/west/auto');
    }
    return fmtCommandResponse(await apiBuild(position, parsed.positionals[2], {
      direction: direction as Direction | undefined,
      recipeId: getStringOption(parsed, 'recipe'),
    }));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdMove(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  if (parsed.positionals.length < 3) {
    return fmtError('Usage: move <entity_id> <x> <y> [--z <z>]');
  }
  try {
    const position = parsePosition(
      parsed.positionals[1],
      parsed.positionals[2],
      getStringOption(parsed, 'z'),
    );
    return fmtCommandResponse(await apiMove(parsed.positionals[0], position));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdAttack(args: string[]): Promise<string> {
  if (args.length < 2) {
    return fmtError('Usage: attack <entity_id> <target_entity_id>');
  }
  try {
    return fmtCommandResponse(await apiAttack(args[0], args[1]));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdProduce(args: string[]): Promise<string> {
  if (args.length < 2) {
    return fmtError('Usage: produce <entity_id> <unit_type>');
  }
  try {
    return fmtCommandResponse(await apiProduce(args[0], args[1]));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdUpgrade(args: string[]): Promise<string> {
  if (args.length < 1) {
    return fmtError('Usage: upgrade <entity_id>');
  }
  try {
    return fmtCommandResponse(await apiUpgrade(args[0]));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdDemolish(args: string[]): Promise<string> {
  if (args.length < 1) {
    return fmtError('Usage: demolish <entity_id>');
  }
  try {
    return fmtCommandResponse(await apiDemolish(args[0]));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdConfigureLogisticsStation(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  if (parsed.positionals.length < 1) {
    return fmtError('Usage: configure_logistics_station <building_id> [--drone-capacity <n>] [--input-priority <n>] [--output-priority <n>] [--interstellar-enabled <true|false>] [--warp-enabled <true|false>] [--ship-slots <n>]');
  }
  try {
    const options: ConfigureLogisticsStationOptions = {};
    const inputPriority = getStringOption(parsed, 'input-priority');
    const outputPriority = getStringOption(parsed, 'output-priority');
    const droneCapacity = getStringOption(parsed, 'drone-capacity');
    const shipSlots = getStringOption(parsed, 'ship-slots');
    const interstellarEnabled = parseBooleanOption(parsed.options['interstellar-enabled'], 'interstellar-enabled');
    const warpEnabled = parseBooleanOption(parsed.options['warp-enabled'], 'warp-enabled');

    if (inputPriority !== undefined) {
      options.inputPriority = requireInt(inputPriority, 'input-priority');
    }
    if (outputPriority !== undefined) {
      options.outputPriority = requireInt(outputPriority, 'output-priority');
    }
    if (droneCapacity !== undefined) {
      options.droneCapacity = requireInt(droneCapacity, 'drone-capacity');
    }
    if (interstellarEnabled !== undefined || warpEnabled !== undefined || shipSlots !== undefined) {
      options.interstellar = {};
      if (interstellarEnabled !== undefined) {
        options.interstellar.enabled = interstellarEnabled;
      }
      if (warpEnabled !== undefined) {
        options.interstellar.warpEnabled = warpEnabled;
      }
      if (shipSlots !== undefined) {
        options.interstellar.shipSlots = requireInt(shipSlots, 'ship-slots');
      }
    }

    return fmtCommandResponse(await apiConfigureLogisticsStation(parsed.positionals[0], options));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdConfigureLogisticsSlot(args: string[]): Promise<string> {
  if (args.length < 5) {
    return fmtError('Usage: configure_logistics_slot <building_id> <planetary|interstellar> <item_id> <none|supply|demand|both> <local_storage>');
  }
  if (!LOGISTICS_SCOPES.has(args[1])) {
    return fmtError('scope 必须是 planetary 或 interstellar');
  }
  if (!LOGISTICS_MODES.has(args[3])) {
    return fmtError('mode 必须是 none/supply/demand/both');
  }
  try {
    return fmtCommandResponse(await apiConfigureLogisticsSlot(args[0], {
      scope: args[1] as 'planetary' | 'interstellar',
      itemId: args[2],
      mode: args[3] as 'none' | 'supply' | 'demand' | 'both',
      localStorage: requireInt(args[4], 'local_storage'),
    }));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdCancelConstruction(args: string[]): Promise<string> {
  if (args.length < 1) {
    return fmtError('Usage: cancel_construction <task_id>');
  }
  try {
    return fmtCommandResponse(await apiCancelConstruction(args[0]));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdRestoreConstruction(args: string[]): Promise<string> {
  if (args.length < 1) {
    return fmtError('Usage: restore_construction <task_id>');
  }
  try {
    return fmtCommandResponse(await apiRestoreConstruction(args[0]));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdStartResearch(args: string[]): Promise<string> {
  if (args.length < 1) {
    return fmtError('Usage: start_research <tech_id>');
  }
  try {
    return fmtCommandResponse(await apiStartResearch(args[0]));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdCancelResearch(args: string[]): Promise<string> {
  if (args.length < 1) {
    return fmtError('Usage: cancel_research <tech_id>');
  }
  try {
    return fmtCommandResponse(await apiCancelResearch(args[0]));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdDeploySquad(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  if (parsed.positionals.length < 2) {
    return fmtError('Usage: deploy_squad <building_id> <prototype|precision_drone> [--count <n>] [--planet <planet_id>]');
  }
  if (!SQUAD_UNITS.has(parsed.positionals[1])) {
    return fmtError('unit_type 必须是 prototype 或 precision_drone');
  }
  try {
    const countRaw = getStringOption(parsed, 'count');
    return fmtCommandResponse(await apiDeploySquad(parsed.positionals[0], parsed.positionals[1], {
      count: countRaw !== undefined ? requireInt(countRaw, 'count') : undefined,
      planetId: getStringOption(parsed, 'planet'),
    }));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdCommissionFleet(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  if (parsed.positionals.length < 3) {
    return fmtError('Usage: commission_fleet <building_id> <corvette|destroyer> <system_id> [--count <n>] [--fleet-id <fleet_id>]');
  }
  if (!FLEET_UNITS.has(parsed.positionals[1])) {
    return fmtError('unit_type 必须是 corvette 或 destroyer');
  }
  try {
    const countRaw = getStringOption(parsed, 'count');
    return fmtCommandResponse(await apiCommissionFleet(
      parsed.positionals[0],
      parsed.positionals[1],
      parsed.positionals[2],
      {
        count: countRaw !== undefined ? requireInt(countRaw, 'count') : undefined,
        fleetId: getStringOption(parsed, 'fleet-id'),
      },
    ));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdFleetAssign(args: string[]): Promise<string> {
  if (args.length < 2) {
    return fmtError('Usage: fleet_assign <fleet_id> <line|vee|circle|wedge>');
  }
  if (!FLEET_FORMATIONS.has(args[1] as FleetFormation)) {
    return fmtError('formation 必须是 line/vee/circle/wedge');
  }
  try {
    return fmtCommandResponse(await apiFleetAssign(args[0], args[1] as FleetFormation));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdFleetAttack(args: string[]): Promise<string> {
  if (args.length < 3) {
    return fmtError('Usage: fleet_attack <fleet_id> <planet_id> <target_id>');
  }
  try {
    return fmtCommandResponse(await apiFleetAttack(args[0], args[1], args[2]));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdFleetDisband(args: string[]): Promise<string> {
  if (args.length < 1) {
    return fmtError('Usage: fleet_disband <fleet_id>');
  }
  try {
    return fmtCommandResponse(await apiFleetDisband(args[0]));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdLaunchSolarSail(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  if (parsed.positionals.length < 1) {
    return fmtError('Usage: launch_solar_sail <building_id> [--count <n>] [--orbit-radius <n>] [--inclination <n>]');
  }
  try {
    const countRaw = getStringOption(parsed, 'count');
    const orbitRadiusRaw = getStringOption(parsed, 'orbit-radius');
    const inclinationRaw = getStringOption(parsed, 'inclination');
    return fmtCommandResponse(await apiLaunchSolarSail(parsed.positionals[0], {
      count: countRaw !== undefined ? requireInt(countRaw, 'count') : undefined,
      orbitRadius: orbitRadiusRaw !== undefined ? requireNumber(orbitRadiusRaw, 'orbit-radius') : undefined,
      inclination: inclinationRaw !== undefined ? requireNumber(inclinationRaw, 'inclination') : undefined,
    }));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdTransfer(args: string[]): Promise<string> {
  if (args.length < 3) {
    return fmtError('Usage: transfer <building_id> <item_id> <quantity>');
  }
  try {
    return fmtCommandResponse(await apiTransferItem(
      args[0],
      args[1],
      requireInt(args[2], 'quantity'),
    ));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdSwitchActivePlanet(args: string[]): Promise<string> {
  if (args.length < 1) {
    return fmtError('Usage: switch_active_planet <planet_id>');
  }
  try {
    return fmtCommandResponse(await apiSwitchActivePlanet(args[0]));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdSetRayReceiverMode(args: string[]): Promise<string> {
  if (args.length < 2) {
    return fmtError('Usage: set_ray_receiver_mode <building_id> <power|photon|hybrid>');
  }
  if (!RAY_RECEIVER_MODES.has(args[1] as RayReceiverMode)) {
    return fmtError('mode 必须是 power/photon/hybrid');
  }
  try {
    return fmtCommandResponse(await apiSetRayReceiverMode(args[0], args[1] as RayReceiverMode));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdLaunchRocket(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  if (parsed.positionals.length < 2) {
    return fmtError('Usage: launch_rocket <building_id> <system_id> [--layer <n>] [--count <n>]');
  }
  try {
    const layerRaw = getStringOption(parsed, 'layer');
    const countRaw = getStringOption(parsed, 'count');
    return fmtCommandResponse(await apiLaunchRocket(parsed.positionals[0], parsed.positionals[1], {
      layerIndex: layerRaw !== undefined ? requireInt(layerRaw, 'layer') : undefined,
      count: countRaw !== undefined ? requireInt(countRaw, 'count') : undefined,
    }));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdBuildDysonNode(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  if (parsed.positionals.length < 4) {
    return fmtError('Usage: build_dyson_node <system_id> <layer_index> <latitude> <longitude> [--orbit-radius <n>]');
  }
  try {
    const orbitRadiusRaw = getStringOption(parsed, 'orbit-radius');
    return fmtCommandResponse(await apiBuildDysonNode({
      systemId: parsed.positionals[0],
      layerIndex: requireInt(parsed.positionals[1], 'layer_index'),
      latitude: requireNumber(parsed.positionals[2], 'latitude'),
      longitude: requireNumber(parsed.positionals[3], 'longitude'),
      orbitRadius: orbitRadiusRaw !== undefined ? requireNumber(orbitRadiusRaw, 'orbit-radius') : undefined,
    }));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdBuildDysonFrame(args: string[]): Promise<string> {
  if (args.length < 4) {
    return fmtError('Usage: build_dyson_frame <system_id> <layer_index> <node_a_id> <node_b_id>');
  }
  try {
    return fmtCommandResponse(await apiBuildDysonFrame({
      systemId: args[0],
      layerIndex: requireInt(args[1], 'layer_index'),
      nodeAId: args[2],
      nodeBId: args[3],
    }));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdBuildDysonShell(args: string[]): Promise<string> {
  if (args.length < 5) {
    return fmtError('Usage: build_dyson_shell <system_id> <layer_index> <latitude_min> <latitude_max> <coverage>');
  }
  try {
    return fmtCommandResponse(await apiBuildDysonShell({
      systemId: args[0],
      layerIndex: requireInt(args[1], 'layer_index'),
      latitudeMin: requireNumber(args[2], 'latitude_min'),
      latitudeMax: requireNumber(args[3], 'latitude_max'),
      coverage: requireNumber(args[4], 'coverage'),
    }));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

export async function cmdDemolishDyson(args: string[]): Promise<string> {
  if (args.length < 3) {
    return fmtError('Usage: demolish_dyson <system_id> <node|frame|shell> <component_id>');
  }
  if (!DYSON_COMPONENT_TYPES.has(args[1] as DysonComponentType)) {
    return fmtError('component_type 必须是 node/frame/shell');
  }
  try {
    return fmtCommandResponse(await apiDemolishDyson(
      args[0],
      args[1] as DysonComponentType,
      args[2],
    ));
  } catch (e) {
    return fmtError(toErrorMessage(e));
  }
}

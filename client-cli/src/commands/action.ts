import {
  cmdBuild as apiBuild,
  cmdMove as apiMove,
  cmdAttack as apiAttack,
  cmdProduce as apiProduce,
  cmdUpgrade as apiUpgrade,
  cmdDemolish as apiDemolish,
  sendRawCommands,
} from '../api.js';
import { fmtCommandResponse, fmtError } from '../format.js';
import type { BuildingType, UnitType } from '../types.js';

const BUILDING_TYPES: BuildingType[] = ['mine', 'solar_plant', 'factory', 'turret'];
const UNIT_TYPES: UnitType[] = ['worker', 'soldier'];

export async function cmdBuild(args: string[]): Promise<string> {
  if (args.length < 3) return fmtError('Usage: build <x> <y> <type>');
  const x = parseInt(args[0], 10);
  const y = parseInt(args[1], 10);
  const type = args[2] as BuildingType;
  if (isNaN(x) || isNaN(y)) return fmtError('x and y must be numbers');
  if (!BUILDING_TYPES.includes(type)) {
    return fmtError(`Invalid building type. Valid: ${BUILDING_TYPES.join(', ')}`);
  }
  try {
    return fmtCommandResponse(await apiBuild(x, y, type));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdMove(args: string[]): Promise<string> {
  if (args.length < 3) return fmtError('Usage: move <entity_id> <x> <y>');
  const entityId = args[0];
  const x = parseInt(args[1], 10);
  const y = parseInt(args[2], 10);
  if (isNaN(x) || isNaN(y)) return fmtError('x and y must be numbers');
  try {
    return fmtCommandResponse(await apiMove(entityId, x, y));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdAttack(args: string[]): Promise<string> {
  if (args.length < 2) return fmtError('Usage: attack <attacker_id> <target_id>');
  try {
    return fmtCommandResponse(await apiAttack(args[0], args[1]));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdProduce(args: string[]): Promise<string> {
  if (args.length < 2) return fmtError('Usage: produce <factory_id> <unit_type>');
  const unitType = args[1] as UnitType;
  if (!UNIT_TYPES.includes(unitType)) {
    return fmtError(`Invalid unit type. Valid: ${UNIT_TYPES.join(', ')}`);
  }
  try {
    return fmtCommandResponse(await apiProduce(args[0], unitType));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdUpgrade(args: string[]): Promise<string> {
  if (args.length < 1) return fmtError('Usage: upgrade <entity_id>');
  try {
    return fmtCommandResponse(await apiUpgrade(args[0]));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdDemolish(args: string[]): Promise<string> {
  if (args.length < 1) return fmtError('Usage: demolish <entity_id>');
  try {
    return fmtCommandResponse(await apiDemolish(args[0]));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdRaw(args: string[]): Promise<string> {
  if (args.length < 1) return fmtError('Usage: raw <json>');
  const json = args.join(' ');
  try {
    return fmtCommandResponse(await sendRawCommands(json));
  } catch (e) {
    return fmtError(String(e));
  }
}

import { cmdScanGalaxy as apiScanGalaxy, cmdScanSystem as apiScanSystem, cmdScanPlanet as apiScanPlanet, sendCommandRequest } from '../api.js';
import { fmtCommandResponse, fmtError } from '../format.js';
import type { CommandRequest } from '../types.js';

export async function cmdScanGalaxy(args: string[]): Promise<string> {
  const galaxyId = args[0] ?? 'galaxy-1';
  try {
    return fmtCommandResponse(await apiScanGalaxy(galaxyId));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdScanSystem(args: string[]): Promise<string> {
  const systemId = args[0];
  if (!systemId) return fmtError('Usage: scan_system <system_id>');
  try {
    return fmtCommandResponse(await apiScanSystem(systemId));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdScanPlanet(args: string[]): Promise<string> {
  const planetId = args[0];
  if (!planetId) return fmtError('Usage: scan_planet <planet_id>');
  try {
    return fmtCommandResponse(await apiScanPlanet(planetId));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdRaw(args: string[]): Promise<string> {
  if (args.length < 1) return fmtError('Usage: raw <json>');
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
    return fmtError(String(e));
  }
}

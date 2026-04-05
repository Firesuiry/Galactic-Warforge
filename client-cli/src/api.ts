import { createApiClient } from '../../shared-client/src/api.js';
import {
  DEFAULT_GALAXY_ID,
  DEFAULT_PLANET_ID,
  DEFAULT_SYSTEM_ID,
  SERVER_URL,
} from './config.js';

export type {
  AlertSnapshotParams,
  ApiClient,
  AuditQueryParams,
  BuildDysonFrameOptions,
  BuildDysonNodeOptions,
  BuildDysonShellOptions,
  BuildOptions,
  CommissionFleetOptions,
  DeploySquadOptions,
  Direction,
  DysonComponentType,
  EventSnapshotParams,
  FleetFormation,
  LaunchRocketOptions,
  LaunchSolarSailOptions,
  PlanetSceneParams,
  ReplayRequest,
  RollbackRequest,
  UnitTypeName,
} from '../../shared-client/src/api.js';
export type {
  ConfigureLogisticsSlotOptions,
  ConfigureLogisticsStationOptions,
  RayReceiverMode,
} from '../../shared-client/src/types.js';

const client = createApiClient({
  serverUrl: SERVER_URL,
  defaultGalaxyId: DEFAULT_GALAXY_ID,
  defaultPlanetId: DEFAULT_PLANET_ID,
  defaultSystemId: DEFAULT_SYSTEM_ID,
});

export const clearAuth = client.clearAuth;
export const cmdAttack = client.cmdAttack;
export const cmdBuild = client.cmdBuild;
export const cmdBuildDysonFrame = client.cmdBuildDysonFrame;
export const cmdBuildDysonNode = client.cmdBuildDysonNode;
export const cmdBuildDysonShell = client.cmdBuildDysonShell;
export const cmdCancelConstruction = client.cmdCancelConstruction;
export const cmdCancelResearch = client.cmdCancelResearch;
export const cmdCommissionFleet = client.cmdCommissionFleet;
export const cmdConfigureLogisticsSlot = client.cmdConfigureLogisticsSlot;
export const cmdConfigureLogisticsStation = client.cmdConfigureLogisticsStation;
export const cmdDemolish = client.cmdDemolish;
export const cmdDemolishDyson = client.cmdDemolishDyson;
export const cmdDeploySquad = client.cmdDeploySquad;
export const cmdFleetAssign = client.cmdFleetAssign;
export const cmdFleetAttack = client.cmdFleetAttack;
export const cmdFleetDisband = client.cmdFleetDisband;
export const cmdLaunchRocket = client.cmdLaunchRocket;
export const cmdLaunchSolarSail = client.cmdLaunchSolarSail;
export const cmdMove = client.cmdMove;
export const cmdProduce = client.cmdProduce;
export const cmdRestoreConstruction = client.cmdRestoreConstruction;
export const cmdScanGalaxy = client.cmdScanGalaxy;
export const cmdScanPlanet = client.cmdScanPlanet;
export const cmdScanSystem = client.cmdScanSystem;
export const cmdSetRayReceiverMode = client.cmdSetRayReceiverMode;
export const cmdStartResearch = client.cmdStartResearch;
export const cmdSwitchActivePlanet = client.cmdSwitchActivePlanet;
export const cmdTransferItem = client.cmdTransferItem;
export const cmdUpgrade = client.cmdUpgrade;
export const fetchAlertSnapshot = client.fetchAlertSnapshot;
export const fetchAudit = client.fetchAudit;
export const fetchCatalog = client.fetchCatalog;
export const fetchEventSnapshot = client.fetchEventSnapshot;
export const fetchFleet = client.fetchFleet;
export const fetchFleets = client.fetchFleets;
export const fetchGalaxy = client.fetchGalaxy;
export const fetchHealth = client.fetchHealth;
export const fetchMetrics = client.fetchMetrics;
export const fetchPlanet = client.fetchPlanet;
export const fetchPlanetInspect = client.fetchPlanetInspect;
export const fetchPlanetScene = client.fetchPlanetScene;
export const fetchSystemRuntime = client.fetchSystemRuntime;
export const fetchStats = client.fetchStats;
export const fetchSummary = client.fetchSummary;
export const fetchSystem = client.fetchSystem;
export const getAuth = client.getAuth;
export const getServerUrl = client.getServerUrl;
export const sendCommandRequest = client.sendCommandRequest;
export const sendCommands = client.sendCommands;
export const sendReplay = client.sendReplay;
export const sendRollback = client.sendRollback;
export const sendSave = client.sendSave;
export const setAuth = client.setAuth;
export const setServerUrl = client.setServerUrl;

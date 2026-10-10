import type { ApiClient } from '../api.js';
import {
  cmdScanGalaxy,
  cmdScanSystem,
  cmdScanPlanet,
  cmdRaw,
  cmdBlockadePlanet,
  cmdBlueprintCreate,
  cmdBlueprintFinalize,
  cmdBlueprintSetComponent,
  cmdBlueprintValidate,
  cmdBlueprintVariant,
  cmdBuild,
  cmdMove,
  cmdAttack,
  cmdOrder,
  cmdProduce,
  cmdUpgrade,
  cmdDemolish,
  cmdConfigureLogisticsStation,
  cmdInstallLogisticsVehicle,
  cmdConfigureLogisticsSlot,
  cmdCancelConstruction,
  cmdRestoreConstruction,
  cmdStartResearch,
  cmdCancelResearch,
  cmdSetRecipe,
  cmdSetEnergyExchangerMode,
  cmdCommissionFleet,
  cmdDeploySquad,
  cmdFleetAssign,
  cmdFleetAttack,
  cmdFleetDisband,
  cmdFleetMove,
  cmdQueueMilitaryProduction,
  cmdRefitUnit,
  cmdTaskForceAssign,
  cmdTaskForceCreate,
  cmdTaskForceDeploy,
  cmdTaskForceSetStance,
  cmdTheaterCreate,
  cmdTheaterDefineZone,
  cmdTheaterSetObjective,
  cmdTransfer,
  cmdRefuelMecha,
  cmdMineResource,
  cmdCraftItem,
  cmdCancelMechaJob,
  cmdSetRallyPoint,
  cmdFormSquad,
  cmdSquadOrder,
  cmdDissolveSquad,
  cmdConfigureSorter,
  cmdConfigureSplitter,
  cmdConfigureTrafficMonitor,
  cmdSwitchActivePlanet,
  cmdSetRayReceiverMode,
  cmdLaunchRocket,
  cmdLaunchSolarSail,
  cmdBuildDysonNode,
  cmdBuildDysonFrame,
  cmdBuildDysonShell,
  cmdDemolishDyson,
} from './action.js';
import { cmdAlertSnapshot, cmdAudit, cmdEventSnapshot, cmdReplay, cmdRollback, cmdSave } from './debug.js';
import { cmdCheckpoint } from './checkpoint.js';
import { configureDistributor, configureMechaLogistics, installBot, uninstallBot } from './distributor.js';
import { cmdHelp } from './help.js';
import {
  cmdBlueprints,
  cmdFleetStatus,
  cmdGalaxy,
  cmdHealth,
  cmdInspect,
  cmdMetrics,
  cmdPlanet,
  cmdPlanetRuntime,
  cmdScene,
  cmdStats,
  cmdSummary,
  cmdBriefing,
  cmdCatalogCommands,
  cmdSystem,
  cmdSystemRuntime,
  cmdTaskForces,
  cmdTheaters,
  cmdWarIndustry,
  cmdFog,
} from './query.js';

/** 命令执行上下文：每次执行都显式携带已鉴权的 API 客户端，不依赖模块级单例。 */
export interface CommandContext {
  api: ApiClient;
}

export type CommandHandler<Ctx extends CommandContext = CommandContext> =
  (args: string[], ctx: Ctx) => Promise<string> | string;

export interface CommandEntry<Ctx extends CommandContext = CommandContext> {
  handler: CommandHandler<Ctx>;
  completions?: string[];
}

/** 与终端会话无关的游戏命令表：CLI REPL 与 agent-gateway 共用。 */
export const GAME_COMMANDS: Record<string, CommandEntry> = {
  configure_distributor: { handler: configureDistributor },
  install_logistics_bot: { handler: installBot },
  uninstall_logistics_bot: { handler: uninstallBot },
  configure_mecha_logistics: { handler: configureMechaLogistics },
  health: { handler: cmdHealth },
  metrics: { handler: cmdMetrics },
  summary: { handler: cmdSummary },
  stats: { handler: cmdStats },
  briefing: { handler: cmdBriefing },
  catalog_commands: { handler: cmdCatalogCommands },
  galaxy: { handler: cmdGalaxy },
  system: { handler: cmdSystem },
  system_runtime: { handler: cmdSystemRuntime },
  planet: { handler: cmdPlanet },
  planet_runtime: { handler: cmdPlanetRuntime },
  blueprints: { handler: cmdBlueprints },
  war_industry: { handler: cmdWarIndustry },
  task_forces: { handler: cmdTaskForces },
  theaters: { handler: cmdTheaters },
  scene: { handler: cmdScene },
  inspect: { handler: cmdInspect },
  fleet_status: { handler: cmdFleetStatus },
  fog: { handler: cmdFog },
  scan_galaxy: { handler: cmdScanGalaxy },
  scan_system: { handler: cmdScanSystem },
  scan_planet: { handler: cmdScanPlanet },
  build: { handler: cmdBuild },
  move: { handler: cmdMove },
  attack: { handler: cmdAttack },
  order: { handler: cmdOrder },
  produce: { handler: cmdProduce },
  upgrade: { handler: cmdUpgrade },
  demolish: { handler: cmdDemolish },
  configure_logistics_station: { handler: cmdConfigureLogisticsStation },
  install_logistics_vehicle: { handler: cmdInstallLogisticsVehicle },
  configure_logistics_slot: { handler: cmdConfigureLogisticsSlot },
  cancel_construction: { handler: cmdCancelConstruction },
  restore_construction: { handler: cmdRestoreConstruction },
  start_research: { handler: cmdStartResearch },
  cancel_research: { handler: cmdCancelResearch },
  set_recipe: { handler: cmdSetRecipe },
  set_energy_exchanger_mode: { handler: cmdSetEnergyExchangerMode },
  blueprint_create: { handler: cmdBlueprintCreate },
  blueprint_set_component: { handler: cmdBlueprintSetComponent },
  blueprint_validate: { handler: cmdBlueprintValidate },
  blueprint_finalize: { handler: cmdBlueprintFinalize },
  blueprint_variant: { handler: cmdBlueprintVariant },
  queue_military_production: { handler: cmdQueueMilitaryProduction },
  refit_unit: { handler: cmdRefitUnit },
  deploy_squad: { handler: cmdDeploySquad },
  form_squad: { handler: cmdFormSquad },
  squad_order: { handler: cmdSquadOrder },
  dissolve_squad: { handler: cmdDissolveSquad },
  commission_fleet: { handler: cmdCommissionFleet },
  fleet_assign: { handler: cmdFleetAssign },
  fleet_attack: { handler: cmdFleetAttack },
  fleet_disband: { handler: cmdFleetDisband },
  fleet_move: { handler: cmdFleetMove },
  task_force_create: { handler: cmdTaskForceCreate },
  task_force_assign: { handler: cmdTaskForceAssign },
  task_force_set_stance: { handler: cmdTaskForceSetStance },
  task_force_deploy: { handler: cmdTaskForceDeploy },
  theater_create: { handler: cmdTheaterCreate },
  theater_define_zone: { handler: cmdTheaterDefineZone },
  theater_set_objective: { handler: cmdTheaterSetObjective },
  blockade_planet: { handler: cmdBlockadePlanet },
  transfer: { handler: cmdTransfer },
  refuel_mecha: { handler: cmdRefuelMecha },
  mine_resource: { handler: cmdMineResource },
  craft_item: { handler: cmdCraftItem },
  cancel_mecha_job: { handler: cmdCancelMechaJob },
  set_rally_point: { handler: cmdSetRallyPoint },
  configure_sorter: { handler: cmdConfigureSorter },
  configure_splitter: { handler: cmdConfigureSplitter },
  configure_traffic_monitor: { handler: cmdConfigureTrafficMonitor },
  switch_active_planet: { handler: cmdSwitchActivePlanet },
  set_ray_receiver_mode: { handler: cmdSetRayReceiverMode },
  launch_rocket: { handler: cmdLaunchRocket },
  launch_solar_sail: { handler: cmdLaunchSolarSail },
  build_dyson_node: { handler: cmdBuildDysonNode },
  build_dyson_frame: { handler: cmdBuildDysonFrame },
  build_dyson_shell: { handler: cmdBuildDysonShell },
  demolish_dyson: { handler: cmdDemolishDyson },
  raw: { handler: cmdRaw },
  audit: { handler: cmdAudit },
  event_snapshot: { handler: cmdEventSnapshot },
  alert_snapshot: { handler: cmdAlertSnapshot },
  save: { handler: cmdSave },
  checkpoint: { handler: cmdCheckpoint, completions: ['list', 'save', 'load'] },
  replay: { handler: cmdReplay },
  rollback: { handler: cmdRollback },
  help: { handler: cmdHelp, completions: [] },
};

export function splitCommandLine(line: string) {
  const parts = line.trim().split(/\s+/);
  return { name: parts[0].toLowerCase(), args: parts.slice(1) };
}

export function unknownCommandMessage(name: string) {
  return `Unknown command: "${name}". Type "help" for commands.`;
}

/** 在给定命令表里执行一行命令；默认使用共享游戏命令表。 */
export async function dispatchCommand<Ctx extends CommandContext>(
  line: string,
  ctx: Ctx,
  commands: Record<string, CommandEntry<Ctx>> = GAME_COMMANDS,
): Promise<string> {
  const { name, args } = splitCommandLine(line);
  const entry = commands[name];
  if (!entry) {
    return unknownCommandMessage(name);
  }
  return entry.handler(args, ctx);
}

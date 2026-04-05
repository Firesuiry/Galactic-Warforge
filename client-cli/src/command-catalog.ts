export type AgentCommandCategory =
  | 'observe'
  | 'build'
  | 'combat'
  | 'research'
  | 'management';

export const AGENT_COMMAND_CATALOG = {
  health: { category: 'observe' },
  metrics: { category: 'observe' },
  summary: { category: 'observe' },
  stats: { category: 'observe' },
  galaxy: { category: 'observe' },
  system: { category: 'observe' },
  system_runtime: { category: 'observe' },
  planet: { category: 'observe' },
  scene: { category: 'observe' },
  inspect: { category: 'observe' },
  fleet_status: { category: 'observe' },
  fog: { category: 'observe' },
  scan_galaxy: { category: 'observe' },
  scan_system: { category: 'observe' },
  scan_planet: { category: 'observe' },
  build: { category: 'build' },
  move: { category: 'combat' },
  attack: { category: 'combat' },
  produce: { category: 'build' },
  upgrade: { category: 'build' },
  demolish: { category: 'build' },
  cancel_construction: { category: 'build' },
  restore_construction: { category: 'build' },
  start_research: { category: 'research' },
  cancel_research: { category: 'research' },
  deploy_squad: { category: 'combat' },
  commission_fleet: { category: 'combat' },
  fleet_assign: { category: 'combat' },
  fleet_attack: { category: 'combat' },
  fleet_disband: { category: 'combat' },
  transfer: { category: 'management' },
  switch_active_planet: { category: 'management' },
  set_ray_receiver_mode: { category: 'management' },
  launch_rocket: { category: 'management' },
  launch_solar_sail: { category: 'management' },
  build_dyson_node: { category: 'build' },
  build_dyson_frame: { category: 'build' },
  build_dyson_shell: { category: 'build' },
  demolish_dyson: { category: 'build' },
  save: { category: 'management' },
} as const;

export type AgentAllowedCommand = keyof typeof AGENT_COMMAND_CATALOG;

export const AGENT_ALLOWED_COMMANDS = Object.keys(AGENT_COMMAND_CATALOG) as AgentAllowedCommand[];

export function getCommandCategory(commandName: string): AgentCommandCategory | null {
  return AGENT_COMMAND_CATALOG[commandName as AgentAllowedCommand]?.category ?? null;
}

export function getAllowedCommandsByCategories(categories?: string[]) {
  if (!categories || categories.length === 0) {
    return [...AGENT_ALLOWED_COMMANDS];
  }

  const allowed = new Set(categories);
  return AGENT_ALLOWED_COMMANDS.filter((commandName) => allowed.has(AGENT_COMMAND_CATALOG[commandName].category));
}

import type { PublicCommandId } from "@shared/command-catalog";

export interface PlanetCommandRendererDefinition {
  cardId: string;
  section: string;
}

export const PLANET_COMMAND_RENDERERS: Partial<
  Record<PublicCommandId, PlanetCommandRendererDefinition>
> = {
  scan_galaxy: { cardId: "scan", section: "基础操作" },
  scan_system: { cardId: "scan", section: "基础操作" },
  scan_planet: { cardId: "scan", section: "基础操作" },
  build: { cardId: "build", section: "基础操作" },
  move: { cardId: "move", section: "基础操作" },
  demolish: { cardId: "demolish", section: "基础操作" },
  attack: { cardId: "combat", section: "战斗与制造" },
  produce: { cardId: "combat", section: "战斗与制造" },
  upgrade: { cardId: "combat", section: "战斗与制造" },
  cancel_construction: { cardId: "cancel", section: "取消与恢复" },
  restore_construction: { cardId: "cancel", section: "取消与恢复" },
  cancel_research: { cardId: "cancel", section: "取消与恢复" },
  demolish_dyson: { cardId: "cancel", section: "取消与恢复" },
  start_research: { cardId: "research", section: "研究与装料" },
  transfer_item: { cardId: "transfer-item", section: "研究与装料" },
  switch_active_planet: {
    cardId: "switch-active-planet",
    section: "跨星球",
  },
  build_dyson_node: { cardId: "dyson-build", section: "戴森" },
  build_dyson_frame: { cardId: "dyson-build", section: "戴森" },
  build_dyson_shell: { cardId: "dyson-build", section: "戴森" },
  launch_solar_sail: { cardId: "dyson-launch", section: "戴森" },
  launch_rocket: { cardId: "dyson-launch", section: "戴森" },
  set_ray_receiver_mode: {
    cardId: "ray-receiver-mode",
    section: "戴森",
  },
};

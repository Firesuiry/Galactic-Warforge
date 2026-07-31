import { describe, expect, it } from "vitest";

import type { PlayerState, ProductionAlert } from "@shared/types";

import { resolveEarlyGameNextAction } from "@/features/early-game-next";

function player(partial: Partial<PlayerState> = {}): PlayerState {
  return {
    player_id: "p1",
    is_alive: true,
    resources: { minerals: 240, energy: 100 },
    inventory: { electromagnetic_matrix: 50 },
    tech: {
      player_id: "p1",
      completed_techs: ["dyson_sphere_program"],
    },
    ...partial,
  };
}

const alert: ProductionAlert = {
  alert_id: "a1",
  tick: 10,
  player_id: "p1",
  building_id: "assembler-1",
  building_type: "assembling_machine_mk1",
  alert_type: "power_low",
  severity: "warning",
  message: "电力不足",
  metrics: {
    throughput: 0,
    backlog: 0,
    idle_ratio: 1,
    efficiency: 0,
    input_shortage: false,
    output_blocked: false,
    power_state: "low",
  },
  details: {},
};

describe("resolveEarlyGameNextAction", () => {
  it("产线告警优先于开局引导", () => {
    const next = resolveEarlyGameNextAction({
      activePlanetId: "planet-1-1",
      player: player(),
      energy: { generation: 0, consumption: 0, storage: 0, current_stored: 0, shortage_ticks: 0 },
      alerts: [alert],
    });
    expect(next.stage).toBe("alert");
    expect(next.to).toBe("/planet/planet-1-1");
    expect(next.idle).toBe(false);
    expect(next.text).toContain("电力不足");
  });

  it("新局无电：引导建造风力涡轮机（深链 build）", () => {
    const next = resolveEarlyGameNextAction({
      activePlanetId: "planet-1-1",
      player: player(),
      energy: { generation: 0, consumption: 0, storage: 0, current_stored: 0, shortage_ticks: 0 },
      alerts: [],
    });
    expect(next.stage).toBe("power_first");
    expect(next.to).toBe("/planet/planet-1-1?build=wind_turbine");
    expect(next.text).toContain("风力涡轮机");
    expect(next.idle).toBe(false);
  });

  it("有电但未研究电磁学：引导建研究站", () => {
    const next = resolveEarlyGameNextAction({
      activePlanetId: "planet-1-1",
      player: player(),
      energy: { generation: 30, consumption: 0, storage: 0, current_stored: 0, shortage_ticks: 0 },
      alerts: [],
    });
    expect(next.stage).toBe("research_electromagnetism");
    expect(next.to).toContain("build=matrix_lab");
    expect(next.text).toMatch(/矩阵研究站|电磁学/);
  });

  it("研究缺站：引导建 matrix_lab", () => {
    const next = resolveEarlyGameNextAction({
      activePlanetId: "planet-1-1",
      player: player({
        tech: {
          player_id: "p1",
          completed_techs: ["dyson_sphere_program"],
          current_research: {
            tech_id: "electromagnetism",
            state: "blocked",
            progress: 0,
            total_cost: 10,
            blocked_reason: "waiting_lab",
          },
        },
      }),
      energy: { generation: 30, consumption: 5, storage: 0, current_stored: 0, shortage_ticks: 0 },
      alerts: [],
    });
    expect(next.stage).toBe("build_lab");
    expect(next.to).toContain("build=matrix_lab");
  });

  it("研究缺矩阵：引导装入", () => {
    const next = resolveEarlyGameNextAction({
      activePlanetId: "planet-1-1",
      player: player({
        inventory: { electromagnetic_matrix: 3 },
        tech: {
          player_id: "p1",
          completed_techs: ["dyson_sphere_program"],
          current_research: {
            tech_id: "electromagnetism",
            state: "blocked",
            progress: 0,
            total_cost: 10,
            blocked_reason: "waiting_matrix",
          },
        },
      }),
      energy: { generation: 30, consumption: 5, storage: 0, current_stored: 0, shortage_ticks: 0 },
      alerts: [],
    });
    expect(next.stage).toBe("load_matrix");
    expect(next.text).toContain("矩阵");
  });

  it("研究进行中：显示进度", () => {
    const next = resolveEarlyGameNextAction({
      activePlanetId: "planet-1-1",
      player: player({
        tech: {
          player_id: "p1",
          completed_techs: ["dyson_sphere_program"],
          current_research: {
            tech_id: "electromagnetism",
            state: "running",
            progress: 4,
            total_cost: 10,
          },
        },
      }),
      energy: { generation: 30, consumption: 5, storage: 0, current_stored: 0, shortage_ticks: 0 },
      alerts: [],
    });
    expect(next.stage).toBe("research_running");
    expect(next.idle).toBe(true);
    expect(next.text).toMatch(/40%/);
  });

  it("电磁学完成且无产出：引导采矿", () => {
    const next = resolveEarlyGameNextAction({
      activePlanetId: "planet-1-1",
      player: player({
        tech: {
          player_id: "p1",
          completed_techs: ["dyson_sphere_program", "electromagnetism"],
        },
        stats: {
          player_id: "p1",
          tick: 1,
          production_stats: { total_output: 0, by_building_type: {}, by_item: {}, efficiency: 0 },
          energy_stats: { generation: 30, consumption: 5, storage: 0, current_stored: 0, shortage_ticks: 0 },
          logistics_stats: { throughput: 0, avg_distance: 0, avg_travel_time: 0, deliveries: 0 },
          combat_stats: { units_lost: 0, enemies_killed: 0, threat_level: 0, highest_threat: 0 },
        },
      }),
      energy: { generation: 30, consumption: 5, storage: 0, current_stored: 0, shortage_ticks: 0 },
      alerts: [],
    });
    expect(next.stage).toBe("mine_expand");
    expect(next.to).toContain("build=mining_machine");
  });

  it("稳态有产出：降级银河侦察", () => {
    const next = resolveEarlyGameNextAction({
      activePlanetId: "planet-1-1",
      player: player({
        tech: {
          player_id: "p1",
          completed_techs: ["dyson_sphere_program", "electromagnetism"],
        },
        stats: {
          player_id: "p1",
          tick: 1,
          production_stats: { total_output: 12, by_building_type: {}, by_item: {}, efficiency: 1 },
          energy_stats: { generation: 120, consumption: 40, storage: 100, current_stored: 50, shortage_ticks: 0 },
          logistics_stats: { throughput: 1, avg_distance: 1, avg_travel_time: 1, deliveries: 1 },
          combat_stats: { units_lost: 0, enemies_killed: 0, threat_level: 0, highest_threat: 0 },
        },
      }),
      energy: { generation: 120, consumption: 40, storage: 100, current_stored: 50, shortage_ticks: 0 },
      alerts: [],
    });
    expect(next.stage).toBe("scout_expand");
    expect(next.to).toBe("/galaxy");
    expect(next.idle).toBe(true);
  });
});

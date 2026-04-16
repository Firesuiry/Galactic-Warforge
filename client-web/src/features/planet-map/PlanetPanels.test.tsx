import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { usePlanetCommandStore } from "@/features/planet-commands/store";
import { PlanetActivityPanel } from "@/features/planet-map/PlanetPanels";
import { usePlanetViewStore } from "@/features/planet-map/store";

function createPlanet() {
  return {
    planet_id: "planet-1-1",
    name: "Gaia",
    discovered: true,
    kind: "terrestrial",
    map_width: 8,
    map_height: 8,
    tick: 120,
    terrain: Array.from({ length: 8 }, () =>
      Array.from({ length: 8 }, () => "buildable"),
    ),
    buildings: {
      "b-44": {
        id: "b-44",
        type: "mining_machine",
        owner_id: "p1",
        position: { x: 2, y: 1, z: 0 },
        hp: 100,
        max_hp: 100,
        level: 1,
        vision_range: 4,
        runtime: {
          params: {
            energy_consume: 1,
            energy_generate: 0,
            capacity: 0,
            maintenance_cost: { minerals: 0, energy: 0 },
            footprint: { width: 1, height: 1 },
          },
          functions: {},
          state: "no_power",
          state_reason: "under_power",
        },
      },
    },
    units: {},
    resources: [],
  };
}

describe("PlanetActivityPanel", () => {
  beforeEach(() => {
    usePlanetViewStore.getState().resetForPlanet("planet-1-1");
    usePlanetCommandStore.getState().resetForPlanet("planet-1-1");
  });

  it("默认关键反馈优先显示命令结果，并把告警翻译成玩家文案", () => {
    render(
      <PlanetActivityPanel
        alerts={[
          {
            alert_id: "alert-1",
            tick: 121,
            player_id: "p1",
            building_id: "b-44",
            building_type: "mining_machine",
            alert_type: "throughput_drop",
            severity: "warning",
            message: "building b-44 throughput drop detected",
            metrics: {
              throughput: 0,
              backlog: 3,
              idle_ratio: 0.2,
              efficiency: 0,
              input_shortage: true,
              output_blocked: true,
              power_state: "under_power",
            },
            details: {},
          },
        ]}
        events={[
          {
            event_id: "evt-command-1",
            tick: 122,
            event_type: "command_result",
            visibility_scope: "p1",
            payload: {
              request_id: "req-1",
              command_type: "build",
              message: "wind_turbine 已开始施工",
              code: "OK",
            },
          },
          {
            event_id: "evt-alert-1",
            tick: 121,
            event_type: "production_alert",
            visibility_scope: "p1",
            payload: {
              alert: {
                alert_id: "alert-1",
                tick: 121,
                player_id: "p1",
                building_id: "b-44",
                building_type: "mining_machine",
                alert_type: "throughput_drop",
                severity: "warning",
                message: "building b-44 throughput drop detected",
                metrics: {
                  throughput: 0,
                  backlog: 3,
                  idle_ratio: 0.2,
                  efficiency: 0,
                  input_shortage: true,
                  output_blocked: true,
                  power_state: "under_power",
                },
                details: {},
              },
            },
          },
        ]}
        planet={createPlanet() as never}
      />,
    );

    expect(screen.getByText("wind_turbine 已开始施工")).toBeInTheDocument();
    expect(screen.queryByText("产线告警")).not.toBeInTheDocument();
    expect(screen.getByText("采矿机 · (2, 1, 0)")).toBeInTheDocument();
    expect(screen.getByText("问题：产能下降")).toBeInTheDocument();
    expect(
      screen.getByText("建议：优先补原料，并检查供电与输出链路"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("building b-44 throughput drop detected"),
    ).not.toBeInTheDocument();
  });
});

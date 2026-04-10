import { screen } from "@testing-library/react";
import { vi } from "vitest";

import { renderApp, jsonResponse } from "@/test/utils";
import { useSessionStore } from "@/stores/session";

describe("SystemPage", () => {
  it("展示戴森态势与当前 active planet 上下文", async () => {
    useSessionStore.getState().setSession({
      serverUrl: "http://localhost:5173",
      playerId: "p1",
      playerKey: "key_player_1",
    });

    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/world/systems/sys-1")) {
        return Promise.resolve(jsonResponse({
          system_id: "sys-1",
          name: "Helios",
          discovered: true,
          planets: [
            { planet_id: "planet-1-1", name: "Gaia", discovered: true, kind: "terrestrial" },
            { planet_id: "planet-1-2", name: "Ares", discovered: true, kind: "lava" },
          ],
        }));
      }
      if (url.endsWith("/world/systems/sys-1/runtime")) {
        return Promise.resolve(jsonResponse({
          system_id: "sys-1",
          discovered: true,
          available: true,
          solar_sail_orbit: {
            player_id: "p1",
            system_id: "sys-1",
            total_energy: 900,
            sails: [{ id: "sail-1", orbit_radius: 1.1, inclination: 0.1, launch_tick: 10, lifetime_ticks: 100, energy_per_tick: 30 }],
          },
          dyson_sphere: {
            player_id: "p1",
            system_id: "sys-1",
            total_energy: 1500,
            layers: [
              {
                layer_index: 0,
                orbit_radius: 1.2,
                energy_output: 1500,
                rocket_launches: 7,
                nodes: [{ id: "node-1", layer_index: 0, latitude: 10, longitude: 20, orbit_radius: 1.2, energy_output: 100, built: true }],
                frames: [],
                shells: [],
              },
            ],
          },
          active_planet_context: {
            planet_id: "planet-1-1",
            em_rail_ejector_count: 3,
            vertical_launching_silo_count: 1,
            ray_receiver_count: 2,
            ray_receiver_modes: {
              photon: 1,
              power: 1,
            },
          },
        }));
      }
      if (url.endsWith("/state/summary")) {
        return Promise.resolve(jsonResponse({
          tick: 240,
          active_planet_id: "planet-1-1",
          map_width: 128,
          map_height: 128,
          players: {
            p1: {
              player_id: "p1",
              is_alive: true,
              resources: { minerals: 1000, energy: 800 },
            },
          },
        }));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    }));

    renderApp(["/system/sys-1"]);

    expect(await screen.findByRole("heading", { name: "Helios" })).toBeInTheDocument();
    expect(screen.getByText("系统总产能")).toBeInTheDocument();
    expect(screen.getAllByText("1500").length).toBeGreaterThan(0);
    expect(screen.getByText("太阳帆轨道能量")).toBeInTheDocument();
    expect(screen.getByText("900")).toBeInTheDocument();
    expect(screen.getByText("火箭发射次数")).toBeInTheDocument();
    expect(screen.getAllByText("7").length).toBeGreaterThan(0);
    expect(screen.getAllByText("当前 active planet").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Gaia").length).toBeGreaterThan(0);
    expect(screen.getByText("电磁轨道弹射器 3")).toBeInTheDocument();
    expect(screen.getByText("垂直发射井 1")).toBeInTheDocument();
    expect(screen.getByText("射线接收站 2")).toBeInTheDocument();
    expect(screen.getByText("光子模式 1")).toBeInTheDocument();
    expect(screen.getByText("发电模式 1")).toBeInTheDocument();
  });
});

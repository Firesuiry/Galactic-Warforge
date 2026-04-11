import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeProviderTurn,
  type CanonicalAgentTurn,
} from "./action-schema.js";

describe("action schema normalize", () => {
  it("normalizes string done and args-wrapped game commands into canonical actions", () => {
    const normalized = normalizeProviderTurn({
      assistantMessage: "我先扫描 planet-1-2。",
      done: "true",
      actions: [
        {
          type: "game.command",
          args: {
            command: "scan_planet",
            args: {
              planetId: "planet-1-2",
            },
          },
        },
      ],
    });

    assert.deepEqual(normalized, {
      assistantMessage: "我先扫描 planet-1-2。",
      done: true,
      actions: [
        {
          type: "game.command",
          command: "scan_planet",
          args: {
            planetId: "planet-1-2",
          },
        },
      ],
    } satisfies CanonicalAgentTurn);
  });

  it("accepts partial agent.create policy and leaves defaults to the server", () => {
    const normalized = normalizeProviderTurn({
      assistantMessage: "我来创建胡景。",
      done: false,
      actions: [
        {
          type: "agent.create",
          name: "胡景",
          policy: {
            planetIds: ["planet-1-1"],
            commandCategories: ["build"],
          },
        },
      ],
    });

    assert.deepEqual(normalized.actions[0], {
      type: "agent.create",
      name: "胡景",
      policy: {
        planetIds: ["planet-1-1"],
        commandCategories: ["build"],
      },
    });
  });

  it("skips empty action shells but keeps the turn itself valid", () => {
    const normalized = normalizeProviderTurn({
      assistantMessage: "已收到你的私聊",
      done: true,
      actions: [{}, { args: {} }],
    });

    assert.deepEqual(normalized, {
      assistantMessage: "已收到你的私聊",
      done: true,
      actions: [],
    } satisfies CanonicalAgentTurn);
  });

  it("does not swallow actions with business fields but missing type", () => {
    assert.throws(
      () =>
        normalizeProviderTurn({
          assistantMessage: "我先扫描当前行星。",
          done: false,
          actions: [
            {
              commandLine: "scan_planet planet-1-1",
            },
          ],
        }),
      /action\.type is required/i,
    );
  });

  it("rejects game.command with missing typed args", () => {
    assert.throws(
      () =>
        normalizeProviderTurn({
          assistantMessage: "我先建造 mining_machine。",
          done: false,
          actions: [
            {
              type: "game.command",
              command: "build",
              args: {
                x: 5,
                y: 1,
              },
            },
          ],
        }),
      /build requires buildingType/i,
    );
  });

  it("normalizes snake_case game.command aliases into canonical typed args", () => {
    const normalized = normalizeProviderTurn({
      assistantMessage: "开始执行。",
      done: false,
      actions: [
        {
          type: "game.command",
          command: "scan_system",
          args: {
            system_id: "sys-1",
          },
        },
        {
          type: "game.command",
          command: "scan_planet",
          args: {
            planet_id: "planet-1-2",
          },
        },
        {
          type: "game.command",
          command: "build",
          args: {
            x: 5,
            y: 1,
            building_type: "matrix_lab",
            recipe_id: "electromagnetic_matrix",
          },
        },
        {
          type: "game.command",
          command: "start_research",
          args: {
            tech_id: "basic_logistics_system",
          },
        },
        {
          type: "game.command",
          command: "transfer_item",
          args: {
            building_id: "b-9",
            item_id: "electromagnetic_matrix",
            quantity: 10,
          },
        },
        {
          type: "game.command",
          command: "set_ray_receiver_mode",
          args: {
            building_id: "ray-1",
            mode: "hybrid",
          },
        },
      ],
    });

    assert.deepEqual(normalized.actions, [
      {
        type: "game.command",
        command: "scan_system",
        args: {
          systemId: "sys-1",
        },
      },
      {
        type: "game.command",
        command: "scan_planet",
        args: {
          planetId: "planet-1-2",
        },
      },
      {
        type: "game.command",
        command: "build",
        args: {
          x: 5,
          y: 1,
          buildingType: "matrix_lab",
          recipeId: "electromagnetic_matrix",
        },
      },
      {
        type: "game.command",
        command: "start_research",
        args: {
          techId: "basic_logistics_system",
        },
      },
      {
        type: "game.command",
        command: "transfer_item",
        args: {
          buildingId: "b-9",
          itemId: "electromagnetic_matrix",
          quantity: 10,
        },
      },
      {
        type: "game.command",
        command: "set_ray_receiver_mode",
        args: {
          buildingId: "ray-1",
          mode: "hybrid",
        },
      },
    ]);
  });
});

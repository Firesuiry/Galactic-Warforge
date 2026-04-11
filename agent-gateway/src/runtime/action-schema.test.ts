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
});

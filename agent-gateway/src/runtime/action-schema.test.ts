import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeProviderTurn,
  type CanonicalAgentTurn,
} from "./action-schema.js";

describe("action schema normalize", () => {
  it("normalizes string done and args-wrapped actions into canonical actions", () => {
    const normalized = normalizeProviderTurn({
      assistantMessage: "我先安排胡景去建矿场。",
      done: "true",
      actions: [
        {
          type: "conversation.send_message",
          args: {
            targetAgentId: "agent-hujing",
            content: "去新建一个矿场",
          },
        },
      ],
    });

    assert.deepEqual(normalized, {
      assistantMessage: "我先安排胡景去建矿场。",
      done: true,
      actions: [
        {
          type: "conversation.send_message",
          targetAgentId: "agent-hujing",
          content: "去新建一个矿场",
        },
      ],
    } satisfies CanonicalAgentTurn);
  });

  it("rejects agent.create when policy is incomplete", () => {
    assert.throws(
      () =>
        normalizeProviderTurn({
          assistantMessage: "我来创建胡景。",
          done: false,
          actions: [
            {
              type: "agent.create",
              name: "胡景",
              policy: {
                planetIds: ["planet-1-1"],
              },
            },
          ],
        }),
      /agent\.create requires complete policy/i,
    );
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
});

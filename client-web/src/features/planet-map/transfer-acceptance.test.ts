import { describe, expect, it } from "vitest";

import { estimateTransferAcceptance } from "@/features/planet-map/model";

/**
 * 「装入建筑」事前可收量估算（试玩 1014 层 15 问题 4）：旧表单只报背包有多少，
 * 玩家要等回执才知道建筑装不下。这里的口径按服务端 execTransferItem →
 * StorageState.Load / LogisticsStationState.ReceiveItem 复刻，所以是「约」值。
 */
describe("estimateTransferAcceptance：装入前的事前可收量估算", () => {
  const depot = (storage: Record<string, unknown>) =>
    ({
      id: "b-4",
      type: "depot_mk1",
      storage,
      runtime: { functions: { storage: {} } },
    }) as never;

  it("空仓储：按数量与容量取小，不产生剩余", () => {
    const result = estimateTransferAcceptance(depot({ capacity: 60 }), "iron_ore", 20, 60);
    expect(result).toMatchObject({ accepted: 20, remaining: 0, blocked: false });
  });

  it("数量超过容量：只收容量部分，其余留在背包", () => {
    const result = estimateTransferAcceptance(depot({ capacity: 60 }), "iron_ore", 100, 100);
    expect(result.accepted).toBe(60);
    expect(result.remaining).toBe(40);
  });

  it("产出预留：主库存到预留线时拒收并说明预留原因", () => {
    const result = estimateTransferAcceptance(
      depot({ capacity: 48, reserve: 8, inventory: { iron_ingot: 40 } }),
      "iron_ore",
      10,
      10,
    );
    expect(result.blocked).toBe(true);
    expect(result.accepted).toBe(0);
    expect(result.reason).toContain("产出预留线");
  });

  it("主库存满但输入缓冲还有空位：用缓冲接收", () => {
    const result = estimateTransferAcceptance(
      depot({
        capacity: 48,
        buffer_capacity: 16,
        priority: { input: 2, output: 1 },
        inventory: { iron_ingot: 48 },
      }),
      "iron_ore",
      30,
      30,
    );
    // floor(16 * 2 / 3) = 10
    expect(result).toMatchObject({ accepted: 10, remaining: 20, blocked: false });
  });

  it("priority 全为 0 时按 1:1 拆分缓冲", () => {
    const result = estimateTransferAcceptance(
      depot({ capacity: 48, buffer_capacity: 16, inventory: { iron_ingot: 48 } }),
      "iron_ore",
      30,
      30,
    );
    expect(result.accepted).toBe(8);
  });

  it("槽位满且不含该物品：直接拒收", () => {
    const result = estimateTransferAcceptance(
      depot({
        capacity: 60,
        slots: 2,
        inventory: { iron_ingot: 4, copper_ingot: 4 },
      }),
      "iron_ore",
      10,
      10,
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("槽位已满");
  });

  it("槽位满但已含该物品：仍可继续装入", () => {
    const result = estimateTransferAcceptance(
      depot({
        capacity: 60,
        slots: 2,
        inventory: { iron_ingot: 4, iron_ore: 2 },
      }),
      "iron_ore",
      10,
      10,
    );
    expect(result.blocked).toBe(false);
    expect(result.accepted).toBe(10);
  });

  it("背包数量裁剪：请求量大于背包时按背包算", () => {
    const result = estimateTransferAcceptance(depot({ capacity: 60 }), "iron_ore", 100, 30);
    expect(result.accepted).toBe(30);
    expect(result.remaining).toBe(70);
  });

  it("没有存储的建筑：拒收并说明原因", () => {
    const windTurbine = {
      id: "b-1",
      type: "wind_turbine",
      runtime: { functions: {} },
    } as never;
    const result = estimateTransferAcceptance(windTurbine, "iron_ore", 10, 10);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("没有存储");
  });

  it("物流站：按单项容量估算，未配置槽位时拒收", () => {
    const station = (overrides: Record<string, unknown>) =>
      ({
        id: "b-35",
        type: "planetary_logistics_station",
        logistics_station: {
          item_capacity: 200,
          inventory: { iron_ingot: 40 },
          settings: { iron_ingot: {} },
          ...overrides,
        },
        runtime: { functions: {} },
      }) as never;

    const ok = estimateTransferAcceptance(station({}), "iron_ingot", 300, 300);
    expect(ok).toMatchObject({ accepted: 160, remaining: 140, blocked: false });

    const unconfigured = estimateTransferAcceptance(station({ settings: {} }), "iron_ingot", 10, 10);
    expect(unconfigured.blocked).toBe(true);
    expect(unconfigured.reason).toContain("配置槽位");

    const full = estimateTransferAcceptance(
      station({ inventory: { iron_ingot: 200 } }),
      "iron_ingot",
      10,
      10,
    );
    expect(full.blocked).toBe(true);
    expect(full.reason).toContain("已满");
  });

  it("星际物流站只配了星际槽位也算已配置", () => {
    const station = {
      id: "b-36",
      type: "interstellar_logistics_station",
      logistics_station: {
        item_capacity: 100,
        inventory: {},
        settings: {},
        interstellar_settings: { space_warper: {} },
      },
      runtime: { functions: {} },
    } as never;
    const result = estimateTransferAcceptance(station, "space_warper", 10, 10);
    expect(result.blocked).toBe(false);
    expect(result.accepted).toBe(10);
  });

  it("数量为 0 或未选物品时给出「先选择」提示而不是静默通过", () => {
    expect(estimateTransferAcceptance(depot({ capacity: 60 }), "iron_ore", 0, 10).blocked).toBe(true);
    expect(estimateTransferAcceptance(depot({ capacity: 60 }), "", 10, 10).blocked).toBe(true);
    expect(estimateTransferAcceptance(undefined, "iron_ore", 10, 10).blocked).toBe(true);
  });
});

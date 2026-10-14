import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameSummary } from "@shared/game";

import { PlanetDebugPanel } from "@/features/planet-map/PlanetPanels";
import { usePlanetViewStore } from "@/features/planet-map/store";
import { useSessionStore } from "@/stores/session";

/**
 * 调试面板「狂飙模式 / 快进」控件布局回归（试玩 1014 层 06 遗留 4）：
 * 280px 窄面板里 radio 与数字输入框同行会把「推进 tick 数 / 推进到 tick」标签
 * 挤成竖排三行。现在的结构是：单选项一行（.debug-panel__advance-modes）+
 * 下方**一个**数字输入框（随模式切换 label 与值）+ 紧凑的停止条件复选框。
 */

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    cancelAdvance: vi.fn(),
    sendAdvance: vi.fn(),
  },
}));

vi.mock("@/hooks/use-api-client", () => ({ useApiClient: () => mockClient }));

function adminGame(): GameSummary {
  return {
    map_seed: "seed",
    enemy_difficulty: "off",
    victory_mode: "sandbox",
    max_tick_rate: 10,
    active_planet_id: "planet-1-1",
    tick: 120,
    started_at: "2026-10-14T00:00:00Z",
    origin: "new",
    players: [{ player_id: "p1", role: "admin", team_id: "t1", is_alive: true }],
    victory: { declared: false },
  };
}

function renderPanel(overrides: { game?: GameSummary; currentTick?: number } = {}) {
  return render(
    <PlanetDebugPanel
      capture={null}
      currentTick={overrides.currentTick ?? 120}
      game={overrides.game ?? adminGame()}
      onPullEvents={vi.fn().mockResolvedValue(undefined)}
      onRefreshFog={vi.fn().mockResolvedValue(undefined)}
      onRefreshPlanet={vi.fn().mockResolvedValue(undefined)}
      planet={{ planet_id: "planet-1-1", map_width: 24, map_height: 16 } as never}
    />,
  );
}

describe("PlanetDebugPanel 快进控件布局", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().setSession({
      serverUrl: "http://server",
      playerId: "p1",
      playerKey: "key_player_1",
    });
    usePlanetViewStore.getState().toggleDebugOpen();
  });

  it("单选项单独一行、文字不折行，数字输入框只有一个且随模式切换", () => {
    renderPanel();

    const modes = document.querySelector(".debug-panel__advance-modes");
    expect(modes).not.toBeNull();
    // 两个单选项都在同一行容器里，且这一行里没有数字输入框（旧布局正是把
    // radio 和 input 塞进同一个 .debug-panel__advance-row 才把标签挤成竖排）。
    expect(within(modes as HTMLElement).getAllByRole("radio")).toHaveLength(2);
    expect((modes as HTMLElement).querySelector('input[type="text"]')).toBeNull();
    expect(screen.getByText("推进 tick 数").closest("label")).toHaveClass(
      "debug-panel__advance-mode",
    );
    expect(screen.getByText("推进到 tick").closest("label")).toHaveClass(
      "debug-panel__advance-mode",
    );
    // 旧的「radio + 输入框同行」结构已经不存在。
    for (const row of document.querySelectorAll(".debug-panel__advance-row")) {
      expect(row.querySelector('input[type="radio"]')).toBeNull();
    }

    // 只有一个数字输入框：默认按 tick 数，切到「推进到 tick」后同一个输入框换 label 与值。
    const inputs = screen.getAllByRole("textbox");
    expect(inputs).toHaveLength(1);
    expect(screen.getByLabelText("快进 tick 数")).toHaveValue("500");

    fireEvent.click(screen.getByRole("radio", { name: "推进到 tick" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByLabelText("快进目标 tick")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("快进目标 tick"), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("radio", { name: "推进 tick 数" }));
    expect(screen.getByLabelText("快进 tick 数")).toHaveValue("500");
    fireEvent.click(screen.getByRole("radio", { name: "推进到 tick" }));
    expect(screen.getByLabelText("快进目标 tick")).toHaveValue("900");
  });

  it("停止条件复选框紧凑排列在同一个容器里", () => {
    renderPanel();

    const stops = document.querySelector(".debug-panel__advance-stops");
    expect(stops).not.toBeNull();
    const boxes = within(stops as HTMLElement).getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    expect(screen.getByLabelText("受袭即停")).toBeChecked();
    expect(screen.getByLabelText("关键警报即停")).toBeChecked();
    expect(screen.getByLabelText("对局结束即停")).toBeChecked();
  });

  it("按 tick 数提交：发 ticks 与默认全开的 stop_on，并显示结果文案", async () => {
    mockClient.sendAdvance.mockResolvedValue({
      start_tick: 120,
      end_tick: 300,
      stopped_reason: "critical_alert",
      detail: "关键警报：建筑 b-48：电力不足（power_shortage，tick 240）",
      elapsed_ms: 12,
      ticks_per_sec: 900,
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "开始快进" }));

    await waitFor(() => expect(mockClient.sendAdvance).toHaveBeenCalledTimes(1));
    expect(mockClient.sendAdvance).toHaveBeenCalledWith({
      ticks: 500,
      stop_on: { game_over: true, under_attack: true, critical_alert: true },
    });
    expect(await screen.findByText("停在 tick 300（关键警报）")).toBeInTheDocument();
  });

  it("推进到 tick：发 to_tick；目标不大于当前 tick 时报错且不发请求", async () => {
    mockClient.sendAdvance.mockResolvedValue({
      start_tick: 120,
      end_tick: 900,
      stopped_reason: "reached",
      detail: "已推进到目标 tick 900",
      elapsed_ms: 30,
      ticks_per_sec: 1200,
    });
    renderPanel({ currentTick: 120 });

    fireEvent.click(screen.getByRole("radio", { name: "推进到 tick" }));
    fireEvent.change(screen.getByLabelText("快进目标 tick"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "开始快进" }));
    expect(screen.getByText(/目标 tick 必须是大于当前 tick/)).toBeInTheDocument();
    expect(mockClient.sendAdvance).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("快进目标 tick"), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: "开始快进" }));
    await waitFor(() =>
      expect(mockClient.sendAdvance).toHaveBeenCalledWith({
        to_tick: 900,
        stop_on: { game_over: true, under_attack: true, critical_alert: true },
      }),
    );
  });

  it("取消快进：没有进行中的快进时给出提示", async () => {
    mockClient.cancelAdvance.mockResolvedValue({ cancelled: false });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "取消快进" }));
    expect(await screen.findByText("当前没有进行中的快进")).toBeInTheDocument();
  });

  it("非 admin 只显示无权限说明，不渲染快进控件", () => {
    renderPanel({
      game: {
        ...adminGame(),
        players: [{ player_id: "p1", role: "player", team_id: "t1", is_alive: true }],
      },
    });

    expect(screen.getByText(/快进需要 admin 身份/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始快进" })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MapDrawer } from "@/common/MapDrawer";

describe("MapDrawer（全屏地图页共用抽屉）", () => {
  it("默认收起为边缘把手，点击把手触发 onToggle", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <MapDrawer label="工作台" onToggle={onToggle} open={false}>
        <div>抽屉内容</div>
      </MapDrawer>,
    );

    const handle = screen.getByRole("button", { name: "工作台" });
    expect(handle).toHaveAttribute("aria-expanded", "false");
    await user.click(handle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("reserveBottom 让抽屉体带让位类（窄屏不遮挡底部选择条）", () => {
    const { rerender } = render(
      <MapDrawer label="工作台" onToggle={() => {}} open reserveBottom>
        <div>抽屉内容</div>
      </MapDrawer>,
    );
    expect(document.querySelector(".planet-drawer__body--reserve-bottom")).not.toBeNull();

    rerender(
      <MapDrawer label="工作台" onToggle={() => {}} open>
        <div>抽屉内容</div>
      </MapDrawer>,
    );
    expect(document.querySelector(".planet-drawer__body--reserve-bottom")).toBeNull();
  });
});

package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/model"
)

// scan_* 是"星图登记"，不是"开图"（试玩报告 #7：点「扫描当前行星」回执
// 「星球扫描完成」但 explored 掩码完全不变）。当前设计里星图在开局就已登记
// 全部行星（运行时加载需要），所以扫描是幂等的空操作——回执必须如实说明，
// 不能让玩家以为能开图。
func TestScanReportsStarChartNoopHonestly(t *testing.T) {
	core, _, _ := newTwoPlanetTestCore(t)
	ws := core.World()

	cases := []struct {
		name   string
		cmd    model.CommandType
		target model.CommandTarget
		id     string
	}{
		{"planet", model.CmdScanPlanet, model.CommandTarget{PlanetID: "planet-1-2"}, "planet-1-2"},
		{"system", model.CmdScanSystem, model.CommandTarget{SystemID: "sys-1"}, "sys-1"},
		{"galaxy", model.CmdScanGalaxy, model.CommandTarget{GalaxyID: "galaxy-1"}, "galaxy-1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, _ := execCommand(core, tc.cmd, ws, "p1", model.Command{Type: tc.cmd, Target: tc.target})
			if res.Code != model.CodeOK {
				t.Fatalf("%s failed: %s (%s)", tc.cmd, res.Code, res.Message)
			}
			if !strings.Contains(res.Message, "星图") {
				t.Fatalf("receipt must name the star chart, got %q", res.Message)
			}
			// 重复执行必须说明它不揭示地表迷雾，而不是笼统的"扫描完成"。
			if !strings.Contains(res.Message, "迷雾") {
				t.Fatalf("repeated scan must explain it does not reveal fog, got %q", res.Message)
			}
			if strings.Contains(res.Message, "扫描完成") {
				t.Fatalf("receipt must not imply the planet was revealed, got %q", res.Message)
			}
		})
	}

	// 目标仍然登记在星图里（命令本身是有效的幂等操作，只是不改迷雾）。
	if !core.Discovery().IsPlanetDiscovered("p1", "planet-1-2") {
		t.Fatal("scan_planet must keep the planet registered in the star chart")
	}
	// 未知目标仍然是实体不存在，而不是空操作。
	res, _ := execCommand(core, model.CmdScanPlanet, ws, "p1", model.Command{
		Type:   model.CmdScanPlanet,
		Target: model.CommandTarget{PlanetID: "planet-9-9"},
	})
	if res.Code != model.CodeEntityNotFound {
		t.Fatalf("unknown planet must be ENTITY_NOT_FOUND, got %s (%s)", res.Code, res.Message)
	}
}

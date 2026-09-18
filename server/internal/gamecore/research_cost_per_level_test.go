package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// DSP 每级成本（CostPerLevel）结算验收：同一可重复科技的不同等级
// 必须按各级成本分别校验库存、计算总量并消耗。

func setupPerLevelResearchLab(t *testing.T, core *GameCore, ws *model.WorldState) *model.Building {
	t.Helper()
	lab := newBuilding("lab-per-level", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	lab.Runtime.State = model.BuildingWorkRunning
	lab.Runtime.Functions.Research = &model.ResearchModule{ResearchPerTick: 10}
	placeBuilding(ws, lab)
	placeBuilding(ws, newBuilding("power-per-level", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6}))
	return lab
}

func TestPerLevelCostDrivesValidationAndConsumption(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	grantTechs(ws, "p1", "mecha_core") // drive_engine 前置
	lab := setupPerLevelResearchLab(t, core, ws)

	// L1 成本（DSP drive-engine-1）：coal x15 + engine x5；空研究站应被拒绝。
	res, _ := core.execStartResearch(ws, "p1", model.Command{
		Type:    model.CmdStartResearch,
		Payload: map[string]any{"tech_id": "drive_engine"},
	})
	if res.Code == model.CodeOK {
		t.Fatal("drive_engine L1 must require coal/engine")
	}

	if _, _, err := lab.Storage.Load("coal", 15); err != nil {
		t.Fatal(err)
	}
	if _, _, err := lab.Storage.Load("engine", 5); err != nil {
		t.Fatal(err)
	}
	res, _ = core.execStartResearch(ws, "p1", model.Command{
		Type:    model.CmdStartResearch,
		Payload: map[string]any{"tech_id": "drive_engine"},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("start drive_engine L1: %s (%s)", res.Code, res.Message)
	}
	research := player.Tech.CurrentResearch
	if research == nil {
		t.Fatal("expected current research")
	}
	if research.TotalCost != 20 {
		t.Fatalf("drive_engine L1 TotalCost = %d, want 20 (coal 15 + engine 5)", research.TotalCost)
	}
	wantL1 := map[string]int{"coal": 15, "engine": 5}
	for _, c := range research.RequiredCost {
		if wantL1[c.ItemID] != c.Quantity {
			t.Fatalf("drive_engine L1 RequiredCost wrong: %+v", research.RequiredCost)
		}
		delete(wantL1, c.ItemID)
	}
	if len(wantL1) != 0 {
		t.Fatalf("drive_engine L1 RequiredCost missing %+v", wantL1)
	}

	for range 4 {
		lab.Runtime.State = model.BuildingWorkRunning
		core.processTick()
		if player.Tech.CompletedTechs["drive_engine"] > 0 {
			break
		}
	}
	if player.Tech.CompletedTechs["drive_engine"] != 1 {
		t.Fatalf("drive_engine L1 did not complete: %+v", player.Tech.CurrentResearch)
	}
	if got := lab.Storage.OutputQuantity("coal"); got != 0 {
		t.Fatalf("coal not fully consumed: %d", got)
	}
	if got := lab.Storage.OutputQuantity("engine"); got != 0 {
		t.Fatalf("engine not fully consumed: %d", got)
	}

	// L2 成本（DSP drive-engine-2）：电磁矩阵 x80 + 能量矩阵 x80。
	// 直接注入库存，绕开 36 格仓储容量对测试布景的限制。
	lab.Storage.EnsureInventory()[model.ItemElectromagneticMatrix] = 80
	lab.Storage.EnsureInventory()[model.ItemEnergyMatrix] = 80
	res, _ = core.execStartResearch(ws, "p1", model.Command{
		Type:    model.CmdStartResearch,
		Payload: map[string]any{"tech_id": "drive_engine"},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("start drive_engine L2: %s (%s)", res.Code, res.Message)
	}
	research = player.Tech.CurrentResearch
	if research == nil {
		t.Fatal("expected current research for L2")
	}
	if research.TotalCost != 160 {
		t.Fatalf("drive_engine L2 TotalCost = %d, want 160", research.TotalCost)
	}
	for range 20 {
		lab.Runtime.State = model.BuildingWorkRunning
		core.processTick()
		if player.Tech.CompletedTechs["drive_engine"] > 1 {
			break
		}
	}
	if player.Tech.CompletedTechs["drive_engine"] != 2 {
		t.Fatalf("drive_engine L2 did not complete: %+v", player.Tech.CurrentResearch)
	}
}

func TestTechCostForPlayerReflectsNextLevel(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	grantTechs(ws, "p1", "mecha_core")

	cost, ok := TechCostForPlayer(player, "drive_engine")
	if !ok {
		t.Fatal("TechCostForPlayer drive_engine not ok")
	}
	total := 0
	for _, c := range cost {
		total += c.Quantity
	}
	if total != 20 {
		t.Fatalf("drive_engine next-level cost = %d, want 20", total)
	}

	grantTechs(ws, "p1", "drive_engine") // 已完成 1 级 → 下一级为 L2
	cost, ok = TechCostForPlayer(player, "drive_engine")
	if !ok {
		t.Fatal("TechCostForPlayer drive_engine L2 not ok")
	}
	total = 0
	for _, c := range cost {
		total += c.Quantity
	}
	if total != 160 {
		t.Fatalf("drive_engine L2 cost = %d, want 160", total)
	}
}

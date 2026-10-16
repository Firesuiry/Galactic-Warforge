package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func newMiningTestWorld(faceSize int) *model.WorldState {
	ws := model.NewWorldState("planet-1", faceSize)
	ws.Players["p1"] = &model.PlayerState{
		PlayerID: "p1",
		IsAlive:  true,
		Tech:     model.NewPlayerTechState("p1"),
	}
	return ws
}

func newMiningTestBuilding(id string, btype model.BuildingType, pos model.Position, yieldPerTick int) *model.Building {
	b := &model.Building{
		ID:       id,
		Type:     btype,
		OwnerID:  "p1",
		Position: pos,
		Runtime:  model.BuildingProfileFor(btype, 1).Runtime,
	}
	b.Runtime.Params.EnergyConsume = 0
	if b.Runtime.Functions.Energy != nil {
		b.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	b.Runtime.Functions.Collect.YieldPerTick = yieldPerTick
	model.InitBuildingStorage(b)
	return b
}

func addFiniteVein(ws *model.WorldState, id, kind, clusterID string, x, y, currentYield, remaining int) {
	ws.Resources[id] = &model.ResourceNodeState{
		ID:           id,
		Kind:         kind,
		Behavior:     "finite",
		ClusterID:    clusterID,
		MaxAmount:    remaining,
		Remaining:    remaining,
		BaseYield:    currentYield,
		CurrentYield: currentYield,
	}
	ws.Grid[y][x].ResourceNodeID = id
}

func setVeinsLevel(ws *model.WorldState, playerID string, level int) {
	ws.Players[playerID].Tech.CompletedTechs["veins_utilization"] = level
}

// C1: veins_utilization 每级 +10% 采矿产能，等级幂等（每 tick 产量一致）。
func TestVeinsUtilizationBoostsMiningOutput(t *testing.T) {
	ws := newMiningTestWorld(1)
	addFiniteVein(ws, "r1", "iron_ore", "c1", 0, 0, 20, 100)
	setVeinsLevel(ws, "p1", 2)

	miner := newMiningTestBuilding("b1", model.BuildingTypeMiningMachine, model.Position{X: 0, Y: 0}, 8)
	ws.Buildings["b1"] = miner

	settleResources(ws)
	if got := totalStorageItems(miner.Storage); got != 10 {
		t.Fatalf("expected 10 ore after level-2 boost (8*1.2), got %d", got)
	}
	// 消耗减免：round(10*0.06*2)=1，实际消耗 9
	if got := ws.Resources["r1"].Remaining; got != 91 {
		t.Fatalf("expected remaining 91 after vein saving, got %d", got)
	}

	settleResources(ws)
	if got := totalStorageItems(miner.Storage); got != 20 {
		t.Fatalf("expected idempotent per-tick output (20 total), got %d", got)
	}
	if got := ws.Resources["r1"].Remaining; got != 82 {
		t.Fatalf("expected remaining 82 after two ticks, got %d", got)
	}
}

// C1: veins_utilization 每级 -6% 矿脉消耗。
func TestVeinsUtilizationReducesVeinConsumption(t *testing.T) {
	ws := newMiningTestWorld(1)
	addFiniteVein(ws, "r1", "iron_ore", "c1", 0, 0, 20, 100)
	setVeinsLevel(ws, "p1", 5)

	miner := newMiningTestBuilding("b1", model.BuildingTypeMiningMachine, model.Position{X: 0, Y: 0}, 8)
	ws.Buildings["b1"] = miner

	settleResources(ws)
	// 产能：floor(8*1.5+0.5)=12；消耗减免：round(12*0.06*5)=4，实际消耗 8
	if got := totalStorageItems(miner.Storage); got != 12 {
		t.Fatalf("expected 12 ore after level-5 boost, got %d", got)
	}
	if got := ws.Resources["r1"].Remaining; got != 92 {
		t.Fatalf("expected remaining 92 (consumed 8 of 12 extracted), got %d", got)
	}
}

// C1: 超出 MaxLevel 的存储等级按 6 级封顶，可重复研究等级生效且不溢出。
func TestVeinsUtilizationLevelCappedAtMax(t *testing.T) {
	ws := newMiningTestWorld(1)
	addFiniteVein(ws, "r1", "iron_ore", "c1", 0, 0, 20, 100)
	setVeinsLevel(ws, "p1", 99)

	miner := newMiningTestBuilding("b1", model.BuildingTypeMiningMachine, model.Position{X: 0, Y: 0}, 8)
	ws.Buildings["b1"] = miner

	settleResources(ws)
	// 封顶 6 级：floor(8*1.6+0.5)=13；消耗减免 round(13*0.36)=5，实际消耗 8
	if got := totalStorageItems(miner.Storage); got != 13 {
		t.Fatalf("expected 13 ore at capped level 6, got %d", got)
	}
	if got := ws.Resources["r1"].Remaining; got != 92 {
		t.Fatalf("expected remaining 92 at capped level 6, got %d", got)
	}
}

// C1: 未研究时行为与既有口径一致（产量不放大、消耗不减免）。
func TestVeinsUtilizationNotResearchedKeepsBaseline(t *testing.T) {
	ws := newMiningTestWorld(1)
	addFiniteVein(ws, "r1", "iron_ore", "c1", 0, 0, 20, 100)

	miner := newMiningTestBuilding("b1", model.BuildingTypeMiningMachine, model.Position{X: 0, Y: 0}, 8)
	ws.Buildings["b1"] = miner

	settleResources(ws)
	if got := totalStorageItems(miner.Storage); got != 8 {
		t.Fatalf("expected baseline 8 ore, got %d", got)
	}
	if got := ws.Resources["r1"].Remaining; got != 92 {
		t.Fatalf("expected remaining 92 baseline, got %d", got)
	}
}

// F2 + 第 16 轮契约（试玩 1016 报告 B2）：一台采集建筑只采**一种**矿。
// advanced_mining_machine 覆盖范围内混了铁矿与铜矿时，只采数量最多的那一种
// （这里覆盖框里铁矿 2 格、铜矿 1 格 → 铁矿），别的矿脉一格都不动。
func TestAdvancedMiningMachineMinesSingleOreKind(t *testing.T) {
	ws := newMiningTestWorld(2)
	addFiniteVein(ws, "n1", "iron_ore", "cluster-a", 2, 1, 20, 100)
	addFiniteVein(ws, "n2", "copper_ore", "cluster-b", 0, 0, 20, 100)
	addFiniteVein(ws, "n3", "iron_ore", "cluster-c", 4, 1, 20, 100)

	miner := newMiningTestBuilding("b1", model.BuildingTypeAdvancedMiningMachine, model.Position{X: 2, Y: 1}, 16)
	ws.Buildings["b1"] = miner

	settleResources(ws)

	if miner.MiningItem != "iron_ore" {
		t.Fatalf("覆盖框里铁矿 2 格 > 铜矿 1 格，应采铁矿，got %q", miner.MiningItem)
	}
	// 铁矿两格一起采，铜矿完全不动。
	for _, id := range []string{"n1", "n3"} {
		if got := ws.Resources[id].Remaining; got != 84 {
			t.Fatalf("expected iron vein %s remaining 84, got %d", id, got)
		}
	}
	if got := ws.Resources["n2"].Remaining; got != 100 {
		t.Fatalf("铜矿不该被混采，remaining=%d", got)
	}
	if got := totalStorageItems(miner.Storage); got != 32 {
		t.Fatalf("expected 32 ore stored (2 iron veins x yield 16), got %d", got)
	}
	// 采集建筑上报的矿种也必须是这一种（客户端配色/提示都读它）。
	if got := collectorOutputItemID(ws, miner); got != "iron_ore" {
		t.Fatalf("collectorOutputItemID = %q, want iron_ore", got)
	}
}

// 覆盖框里两种矿数量相同时按物品 ID 较小者定（确定性）。
func TestMiningItemTieBreaksByItemID(t *testing.T) {
	ws := newMiningTestWorld(6)
	addFiniteVein(ws, "n1", "iron_ore", "cluster-a", 1, 1, 20, 100)
	addFiniteVein(ws, "n2", "copper_ore", "cluster-b", 3, 3, 20, 100)

	// 采矿机 3×3 锚点 (1,1)、覆盖 5×5（x0..4, y0..4）：两种矿各 1 格 → 平票。
	got := model.MiningItemAt(ws, model.BuildingTypeMiningMachine, model.PlanRotation0, model.Position{X: 1, Y: 1})
	if got != "copper_ore" {
		t.Fatalf("平票应取物品 ID 较小者（copper_ore < iron_ore），got %q", got)
	}
	// 位置不变 → 结果不变（同一套覆盖格与平票规则）。
	if again := model.MiningItemAt(ws, model.BuildingTypeMiningMachine, model.PlanRotation0, model.Position{X: 1, Y: 1}); again != got {
		t.Fatalf("同一落点两次评估应一致，got %q then %q", got, again)
	}
}

// 覆盖框里没有矿时 MiningItemAt 返回空（命令校验会先拒掉这种落点）。
func TestMiningItemEmptyWithoutVeins(t *testing.T) {
	ws := newMiningTestWorld(4)
	if got := model.MiningItemAt(ws, model.BuildingTypeMiningMachine, model.PlanRotation0, model.Position{X: 1, Y: 1}); got != "" {
		t.Fatalf("无矿落点应返回空矿种，got %q", got)
	}
}

// 覆盖框里同种矿有多格时全部计入（DSP 的「矿机范围内同种矿一起采」）。
func TestAdvancedMiningMachineMinesEveryVeinOfItsOre(t *testing.T) {
	ws := newMiningTestWorld(6)
	addFiniteVein(ws, "n1", "iron_ore", "cluster-a", 1, 1, 20, 100)
	addFiniteVein(ws, "n2", "iron_ore", "cluster-a", 2, 1, 20, 100)
	addFiniteVein(ws, "n3", "copper_ore", "cluster-b", 5, 5, 20, 100)

	miner := newMiningTestBuilding("b1", model.BuildingTypeMiningMachine, model.Position{X: 1, Y: 1}, 8)
	ws.Buildings["b1"] = miner

	settleResources(ws)

	if miner.MiningItem != "iron_ore" {
		t.Fatalf("覆盖框里铁矿 2 格 > 铜矿 1 格，应采铁矿，got %q", miner.MiningItem)
	}
	for _, id := range []string{"n1", "n2"} {
		if got := ws.Resources[id].Remaining; got != 92 {
			t.Fatalf("同种矿 %s 应一起采，remaining=%d", id, got)
		}
	}
	if got := ws.Resources["n3"].Remaining; got != 100 {
		t.Fatalf("铜矿在覆盖框外且矿种不同，不该被动，remaining=%d", got)
	}
	if got := totalStorageItems(miner.Storage); got != 16 {
		t.Fatalf("expected 2 veins x 8 = 16 ore, got %d", got)
	}
}

// F2: mining_machine 只采自身覆盖范围内的脉（占地 + 1 圈），范围外的脉不受影响。
// 细分网格：采矿机 3×3，覆盖半径 1，因此"范围内/范围外"的脉要按 5×5 的覆盖框摆。
func TestMiningMachineMinesOnlyOwnVein(t *testing.T) {
	ws := newMiningTestWorld(8)
	addFiniteVein(ws, "n1", "iron_ore", "cluster-a", 10, 10, 20, 100)
	// 距离占地 3 格（覆盖框 5×5 之外）。
	addFiniteVein(ws, "n2", "iron_ore", "cluster-a", 10, 14, 20, 100)

	miner := newMiningTestBuilding("b1", model.BuildingTypeMiningMachine, model.Position{X: 9, Y: 9}, 8)
	ws.Buildings["b1"] = miner

	settleResources(ws)

	if got := ws.Resources["n1"].Remaining; got != 92 {
		t.Fatalf("expected own vein remaining 92, got %d", got)
	}
	if got := ws.Resources["n2"].Remaining; got != 100 {
		t.Fatalf("expected out-of-range vein untouched, got %d", got)
	}
	if got := totalStorageItems(miner.Storage); got != 8 {
		t.Fatalf("expected 8 ore stored, got %d", got)
	}
}

// F2: 部分覆盖——advanced_mining_machine 自身格无脉时仍采覆盖范围内的脉。
func TestAdvancedMiningMachineMinesVeinBesideIt(t *testing.T) {
	ws := newMiningTestWorld(2)
	addFiniteVein(ws, "n1", "titanium_ore", "cluster-a", 3, 2, 20, 100)

	miner := newMiningTestBuilding("b1", model.BuildingTypeAdvancedMiningMachine, model.Position{X: 2, Y: 1}, 16)
	ws.Buildings["b1"] = miner

	settleResources(ws)

	if got := ws.Resources["n1"].Remaining; got != 84 {
		t.Fatalf("expected covered vein remaining 84, got %d", got)
	}
	if got := totalStorageItems(miner.Storage); got != 16 {
		t.Fatalf("expected 16 ore stored from covered vein, got %d", got)
	}
}

// F2: 零脉边界——覆盖范围内无任何脉时不产出。
func TestAdvancedMiningMachineNoVeinsNoOutput(t *testing.T) {
	ws := newMiningTestWorld(2)

	miner := newMiningTestBuilding("b1", model.BuildingTypeAdvancedMiningMachine, model.Position{X: 2, Y: 1}, 16)
	ws.Buildings["b1"] = miner

	settleResources(ws)

	if got := totalStorageItems(miner.Storage); got != 0 {
		t.Fatalf("expected no ore without veins, got %d", got)
	}
}

// F2+C1 叠加：多脉同采时每脉都享受科技加成。
func TestAdvancedMiningMachineMultiVeinWithVeinsUtilization(t *testing.T) {
	ws := newMiningTestWorld(2)
	addFiniteVein(ws, "n1", "iron_ore", "cluster-a", 2, 1, 30, 200)
	addFiniteVein(ws, "n2", "iron_ore", "cluster-a", 4, 2, 30, 200)
	setVeinsLevel(ws, "p1", 1)

	miner := newMiningTestBuilding("b1", model.BuildingTypeAdvancedMiningMachine, model.Position{X: 2, Y: 1}, 16)
	ws.Buildings["b1"] = miner

	settleResources(ws)

	// 每脉 floor(16*1.1+0.5)=18；每脉消耗 18-round(18*0.06)=17
	if got := totalStorageItems(miner.Storage); got != 36 {
		t.Fatalf("expected 36 ore across two boosted veins, got %d", got)
	}
	for _, id := range []string{"n1", "n2"} {
		if got := ws.Resources[id].Remaining; got != 183 {
			t.Fatalf("expected vein %s remaining 183, got %d", id, got)
		}
	}
}

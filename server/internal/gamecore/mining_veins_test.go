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

// F2: advanced_mining_machine 覆盖范围内多脉同采（跨簇、跨矿种）。
func TestAdvancedMiningMachineMinesMultipleVeins(t *testing.T) {
	ws := newMiningTestWorld(2)
	addFiniteVein(ws, "n1", "iron_ore", "cluster-a", 2, 1, 20, 100)
	addFiniteVein(ws, "n2", "copper_ore", "cluster-b", 0, 0, 20, 100)
	addFiniteVein(ws, "n3", "iron_ore", "cluster-c", 4, 1, 20, 100)

	miner := newMiningTestBuilding("b1", model.BuildingTypeAdvancedMiningMachine, model.Position{X: 2, Y: 1}, 16)
	ws.Buildings["b1"] = miner

	settleResources(ws)

	for _, id := range []string{"n1", "n2", "n3"} {
		if got := ws.Resources[id].Remaining; got != 84 {
			t.Fatalf("expected vein %s remaining 84, got %d", id, got)
		}
	}
	if got := miner.Storage.UsedInventory() + miner.Storage.UsedInputBuffer(); got != 48 {
		t.Fatalf("expected 48 total ore stored, got %d", got)
	}
	if got := ws.Players["p1"].Resources.Minerals; got != 24 {
		t.Fatalf("expected minerals kickback 24 (0.5*48), got %d", got)
	}
}

// F2: mining_machine 只采自身所在脉，相邻脉不受影响。
func TestMiningMachineMinesOnlyOwnVein(t *testing.T) {
	ws := newMiningTestWorld(2)
	addFiniteVein(ws, "n1", "iron_ore", "cluster-a", 2, 1, 20, 100)
	addFiniteVein(ws, "n2", "iron_ore", "cluster-a", 3, 1, 20, 100)

	miner := newMiningTestBuilding("b1", model.BuildingTypeMiningMachine, model.Position{X: 2, Y: 1}, 8)
	ws.Buildings["b1"] = miner

	settleResources(ws)

	if got := ws.Resources["n1"].Remaining; got != 92 {
		t.Fatalf("expected own vein remaining 92, got %d", got)
	}
	if got := ws.Resources["n2"].Remaining; got != 100 {
		t.Fatalf("expected adjacent vein untouched, got %d", got)
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
	if got := ws.Players["p1"].Resources.Minerals; got != 0 {
		t.Fatalf("expected no minerals without veins, got %d", got)
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

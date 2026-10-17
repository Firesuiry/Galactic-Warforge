package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestUpgradeJobProgress(t *testing.T) {
	restore := overrideBuildingRule(t, model.BuildingTypeMiningMachine, func(def *model.BuildingDefinition) {
		def.Upgrade = model.BuildingUpgradeRule{
			Allow:          true,
			MaxLevel:       3,
			CostMultiplier: 1,
			DurationTicks:  2,
		}
	})
	defer restore()

	ws, gc, building := newTestWorldWithBuilding(model.BuildingTypeMiningMachine, 1)
	player := ws.Players[building.OwnerID]
	player.Resources.Energy = 1000
	grantAllItems(ws, building.OwnerID, 100)

	cmd := model.Command{
		Type:   model.CmdUpgrade,
		Target: model.CommandTarget{EntityID: building.ID},
	}
	res, _ := execCommand(gc, model.CmdUpgrade, ws, building.OwnerID, cmd)
	if res.Code != model.CodeOK {
		t.Fatalf("expected upgrade OK, got %s (%s)", res.Code, res.Message)
	}
	if building.Job == nil || building.Job.Type != model.BuildingJobUpgrade {
		t.Fatalf("expected upgrade job")
	}
	if building.Job.RemainingTicks != 2 {
		t.Fatalf("expected remaining ticks 2, got %d", building.Job.RemainingTicks)
	}
	if building.Runtime.State != model.BuildingWorkPaused {
		t.Fatalf("expected building paused, got %s", building.Runtime.State)
	}

	settleBuildingJobs(ws, nil)
	if building.Job == nil || building.Job.RemainingTicks != 1 {
		t.Fatalf("expected remaining ticks 1, got %v", building.Job)
	}
	if building.Level != 1 {
		t.Fatalf("expected level unchanged before completion, got %d", building.Level)
	}

	settleBuildingJobs(ws, nil)
	if building.Job != nil {
		t.Fatalf("expected job cleared after completion")
	}
	if building.Level != 2 {
		t.Fatalf("expected level 2 after upgrade, got %d", building.Level)
	}
	if building.Runtime.State != model.BuildingWorkRunning {
		t.Fatalf("expected running state after upgrade, got %s", building.Runtime.State)
	}

	if player.Inventory[model.ItemCircuitBoard] >= 100 || player.Inventory[model.ItemIronIngot] >= 100 {
		t.Fatalf("expected upgrade item cost deducted, got %+v", player.Inventory)
	}
}

func TestDemolishJobRefund(t *testing.T) {
	restore := overrideBuildingRule(t, model.BuildingTypeMiningMachine, func(def *model.BuildingDefinition) {
		def.Demolish = model.BuildingDemolishRule{
			Allow:         true,
			RefundRate:    0.5,
			DurationTicks: 1,
		}
	})
	defer restore()

	ws, gc, building := newTestWorldWithBuilding(model.BuildingTypeMiningMachine, 2)
	player := ws.Players[building.OwnerID]
	player.Inventory = model.ItemInventory{}

	cmd := model.Command{
		Type:   model.CmdDemolish,
		Target: model.CommandTarget{EntityID: building.ID},
	}
	res, _ := execCommand(gc, model.CmdDemolish, ws, building.OwnerID, cmd)
	if res.Code != model.CodeOK {
		t.Fatalf("expected demolish OK, got %s (%s)", res.Code, res.Message)
	}
	if building.Job == nil || building.Job.Type != model.BuildingJobDemolish {
		t.Fatalf("expected demolish job")
	}
	if player.InventoryCount() != 0 {
		t.Fatalf("expected no item refund before completion, got %+v", player.Inventory)
	}

	settleBuildingJobs(ws, nil)
	if _, ok := ws.Buildings[building.ID]; ok {
		t.Fatalf("expected building removed after demolish")
	}
	if player.InventoryCount() == 0 {
		t.Fatalf("expected item refund after demolish completion")
	}
}

func TestUpgradeConsumesItems(t *testing.T) {
	restore := overrideBuildingRule(t, model.BuildingTypeMiningMachine, func(def *model.BuildingDefinition) {
		def.Upgrade = model.BuildingUpgradeRule{
			Allow:          true,
			MaxLevel:       2,
			CostMultiplier: 1,
			DurationTicks:  0,
		}
		def.BuildCost.Items = []model.ItemAmount{
			{ItemID: model.ItemGear, Quantity: 2},
		}
	})
	defer restore()

	ws, gc, building := newTestWorldWithBuilding(model.BuildingTypeMiningMachine, 1)
	player := ws.Players[building.OwnerID]
	player.Inventory = model.ItemInventory{model.ItemGear: 2}

	cmd := model.Command{
		Type:   model.CmdUpgrade,
		Target: model.CommandTarget{EntityID: building.ID},
	}
	res, _ := execCommand(gc, model.CmdUpgrade, ws, building.OwnerID, cmd)
	if res.Code != model.CodeOK {
		t.Fatalf("expected upgrade OK, got %s (%s)", res.Code, res.Message)
	}
	if player.Inventory[model.ItemGear] != 0 {
		t.Fatalf("expected upgrade items consumed")
	}
}

func TestDemolishRefundItems(t *testing.T) {
	restore := overrideBuildingRule(t, model.BuildingTypeMiningMachine, func(def *model.BuildingDefinition) {
		def.Demolish = model.BuildingDemolishRule{
			Allow:         true,
			RefundRate:    0.5,
			DurationTicks: 1,
		}
		def.BuildCost.Items = []model.ItemAmount{
			{ItemID: model.ItemGear, Quantity: 4},
		}
	})
	defer restore()

	ws, gc, building := newTestWorldWithBuilding(model.BuildingTypeMiningMachine, 2)
	player := ws.Players[building.OwnerID]
	player.Inventory = model.ItemInventory{}

	cmd := model.Command{
		Type:   model.CmdDemolish,
		Target: model.CommandTarget{EntityID: building.ID},
	}
	res, _ := execCommand(gc, model.CmdDemolish, ws, building.OwnerID, cmd)
	if res.Code != model.CodeOK {
		t.Fatalf("expected demolish OK, got %s (%s)", res.Code, res.Message)
	}
	if player.Inventory[model.ItemGear] != 0 {
		t.Fatalf("expected no item refund before completion")
	}

	settleBuildingJobs(ws, nil)
	if player.Inventory[model.ItemGear] != 4 {
		t.Fatalf("expected item refund after demolish completion, got %d", player.Inventory[model.ItemGear])
	}
}

func newTestWorldWithBuilding(btype model.BuildingType, level int) (*model.WorldState, *GameCore, *model.Building) {
	ws := model.NewWorldState("planet-test", 6)
	player := &model.PlayerState{
		PlayerID:  "p1",
		Resources: model.Resources{Energy: 1000},
		IsAlive:   true,
	}
	player.SetPlanetExecutor(ws.PlanetID, model.NewExecutorState("u-1", 1, 10, 2, 0))
	ws.Players[player.PlayerID] = player
	execUnit := &model.Unit{
		ID:       "u-1",
		Type:     model.UnitTypeExecutor,
		OwnerID:  player.PlayerID,
		Position: model.Position{X: 1, Y: 1},
	}
	ws.Units[execUnit.ID] = execUnit

	pos := model.Position{X: 2, Y: 1}
	profile := model.BuildingProfileFor(btype, level)
	building := &model.Building{
		ID:          "b-1",
		Type:        btype,
		OwnerID:     player.PlayerID,
		Position:    pos,
		HP:          profile.MaxHP,
		MaxHP:       profile.MaxHP,
		Level:       level,
		VisionRange: profile.VisionRange,
		Runtime:     profile.Runtime,
	}
	model.InitBuildingStorage(building)
	model.InitBuildingConveyor(building)
	ws.Buildings[building.ID] = building
	tileKey := model.TileKey(pos.X, pos.Y)
	ws.TileBuilding[tileKey] = building.ID
	ws.Grid[pos.Y][pos.X].BuildingID = building.ID

	gc := &GameCore{executorUsage: make(map[string]int)}
	return ws, gc, building
}

func overrideBuildingRule(t *testing.T, btype model.BuildingType, mutate func(*model.BuildingDefinition)) func() {
	t.Helper()
	orig := model.AllBuildingDefinitions()
	defs := make([]model.BuildingDefinition, len(orig))
	copy(defs, orig)
	for i := range defs {
		if defs[i].ID == btype {
			mutate(&defs[i])
			break
		}
	}
	if err := model.ReplaceBuildingCatalog(defs); err != nil {
		t.Fatalf("replace building catalog: %v", err)
	}
	return func() {
		_ = model.ReplaceBuildingCatalog(orig)
	}
}

// 回归（试玩 1014 问题 1）：拆除返还在背包已满时不得把背包顶过上限。
func TestDemolishRefundNeverExceedsInventoryCapacity(t *testing.T) {
	restore := overrideBuildingRule(t, model.BuildingTypeMiningMachine, func(def *model.BuildingDefinition) {
		def.Demolish = model.BuildingDemolishRule{
			Allow:         true,
			RefundRate:    0.5,
			DurationTicks: 1,
		}
		def.BuildCost.Items = []model.ItemAmount{
			{ItemID: model.ItemGear, Quantity: 4},
		}
	})
	defer restore()

	ws, gc, building := newTestWorldWithBuilding(model.BuildingTypeMiningMachine, 2)
	player := ws.Players[building.OwnerID]
	unit := ws.Units["u-1"]
	model.SyncMechaCapabilities(unit, player)
	slots := unit.Mecha.InventorySlots
	player.Inventory = model.ItemInventory{model.ItemCoal: slots * model.ItemStackSize(model.ItemCoal)}

	cmd := model.Command{
		Type:   model.CmdDemolish,
		Target: model.CommandTarget{EntityID: building.ID},
	}
	if res, _ := execCommand(gc, model.CmdDemolish, ws, building.OwnerID, cmd); res.Code != model.CodeOK {
		t.Fatalf("expected demolish OK, got %s (%s)", res.Code, res.Message)
	}
	settleBuildingJobs(ws, nil)
	if got := player.InventorySlotsUsed(); got > slots {
		t.Fatalf("demolish refund pushed the bag over capacity: %d/%d", got, slots)
	}
	if player.Inventory[model.ItemGear] != 0 {
		t.Fatalf("full bag should have discarded the refund, got %v", player.Inventory)
	}

	// 腾出空间后返还照常入包。
	player.Inventory = model.ItemInventory{}
	ws2, gc2, building2 := newTestWorldWithBuilding(model.BuildingTypeMiningMachine, 2)
	player2 := ws2.Players[building2.OwnerID]
	player2.Inventory = model.ItemInventory{}
	cmd2 := model.Command{Type: model.CmdDemolish, Target: model.CommandTarget{EntityID: building2.ID}}
	if res, _ := execCommand(gc2, model.CmdDemolish, ws2, building2.OwnerID, cmd2); res.Code != model.CodeOK {
		t.Fatalf("second demolish: %s", res.Message)
	}
	settleBuildingJobs(ws2, nil)
	if player2.Inventory[model.ItemGear] != 4 {
		t.Fatalf("expected item refund after demolish completion, got %d", player2.Inventory[model.ItemGear])
	}
}

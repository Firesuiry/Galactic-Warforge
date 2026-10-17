package gamecore

import (
	"encoding/json"
	"testing"

	"siliconworld/internal/gamedir"
	"siliconworld/internal/model"
	"siliconworld/internal/persistence"
	"siliconworld/internal/queue"
)

// 存档 → 读档 → 条件解除：存档前就成立的 output_blocked 在读档后仍要被解除。
// 回归点：ProductionMonitor 不进快照时 ActiveAlerts 读档即空，wasActive 永远
// false，历史条目一直 active（审查问题 3）。
func TestAlertResolvesAfterSaveLoad(t *testing.T) {
	core, ws, _ := beltAlertCore(t)
	miner := newMiningTestBuilding("miner", model.BuildingTypeMiningMachine, model.Position{X: 5, Y: 5}, 8)
	attachBuilding(ws, miner)
	miner.Storage.Inventory = model.ItemInventory{model.ItemSiliconOre: 48}
	miner.Storage.OutputBuffer = model.ItemInventory{model.ItemSiliconOre: 8}
	miner.Storage.InputBuffer = model.ItemInventory{model.ItemSiliconOre: 4}
	for i := 0; i < 30; i++ {
		core.processTick()
	}
	if alert := alertByType(core, "p1", model.AlertTypeOutputBlocked); alert == nil || !alert.Active {
		t.Fatalf("前置条件：应产生 active 的 output_blocked，got %+v", alert)
	}

	// 用同一个世界的配置与地图重建，否则读档会因面尺寸不一致被拒。
	cfg, maps := core.cfg, core.maps
	q, bus := queue.New(), NewEventBus()
	store := persistence.New(persistence.SnapshotPolicy{IntervalTicks: 1, RetentionTicks: 100, RetentionCount: 4})
	save, err := core.ExportSaveFile("test")
	if err != nil {
		t.Fatalf("export save: %v", err)
	}
	// 走一遍 JSON（与磁盘存档同路径），确认 production_monitor 进了快照。
	payload, err := json.Marshal(save)
	if err != nil {
		t.Fatalf("marshal save: %v", err)
	}
	var roundTripped gamedir.SaveFile
	if err := json.Unmarshal(payload, &roundTripped); err != nil {
		t.Fatalf("unmarshal save: %v", err)
	}
	loaded, err := NewFromSave(cfg, maps, q, bus, store, &roundTripped)
	if err != nil {
		t.Fatalf("restore core: %v", err)
	}
	loadedWorld := loaded.World()
	loadedMiner := loadedWorld.Buildings["miner"]
	if loadedMiner == nil {
		t.Fatal("读档后找不到采矿机")
	}
	if !loadedMiner.ProductionMonitor.ActiveAlerts[model.AlertTypeOutputBlocked] {
		t.Fatalf("读档后 ActiveAlerts 应恢复，got %+v", loadedMiner.ProductionMonitor)
	}

	// 条件解除：清空库存，跑到下一个采样点。
	loadedMiner.Storage.Inventory = model.ItemInventory{}
	loadedMiner.Storage.OutputBuffer = model.ItemInventory{}
	loadedMiner.Storage.InputBuffer = model.ItemInventory{}
	for i := 0; i < 6; i++ {
		loaded.processTick()
	}
	resolved := alertByType(loaded, "p1", model.AlertTypeOutputBlocked)
	if resolved == nil || resolved.Active {
		t.Fatalf("读档后条件解除，历史条目必须 active=false，got %+v", resolved)
	}
	if resolved.ResolvedTick == 0 {
		t.Fatalf("解除的条目必须带 resolved_tick，got %+v", resolved)
	}
}

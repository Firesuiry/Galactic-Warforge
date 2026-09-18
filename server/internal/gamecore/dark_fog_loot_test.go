package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

// spawnLootTestForce 在世界中放置一支指定类型/强度的黑雾势力。
func spawnLootTestForce(ws *model.WorldState, id string, forceType model.EnemyForceType, strength int, pos model.Position) {
	if ws.EnemyForces == nil {
		ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID}
	}
	ws.EnemyForces.Forces = append(ws.EnemyForces.Forces, model.EnemyForce{
		ID:           id,
		Type:         forceType,
		Position:     pos,
		Strength:     strength,
		SpreadRadius: 1.0,
	})
}

// spawnLootKillerUnit 放置一个必定能击杀目标的战斗单位。
func spawnLootKillerUnit(gc *GameCore, ws *model.WorldState, playerID string, pos model.Position) *model.CombatUnit {
	unit := gc.combatUnits.SpawnCombatUnit(ws, model.CombatUnitTypeMech, playerID, pos, nil)
	unit.Weapon = model.WeaponState{Type: model.WeaponTypeGun, Damage: 500, FireRate: 1, Range: 100, AmmoCost: 1}
	unit.AmmoInventory = 100
	return unit
}

func lootEventsFor(events []*model.GameEvent, forceID string) []*model.GameEvent {
	var out []*model.GameEvent
	for _, evt := range events {
		if evt.EventType != model.EvtLootDropped {
			continue
		}
		if id, _ := evt.Payload["force_id"].(string); id == forceID {
			out = append(out, evt)
		}
	}
	return out
}

// TestDarkFogLootTableDrops 校验掉落表本身：目录合法、确定性、hive 必掉矩阵。
func TestDarkFogLootTableDrops(t *testing.T) {
	if drops := darkFogLootDrops(nil, 10, 1); drops != nil {
		t.Fatalf("nil force must drop nothing, got %+v", drops)
	}

	// 掉落表引用的物品必须全部在库。
	for forceType, entries := range darkFogLootTable {
		for _, entry := range entries {
			if _, ok := model.Item(entry.ItemID); !ok {
				t.Fatalf("%s loot entry %s not in item catalog", forceType, entry.ItemID)
			}
			if entry.MinQty <= 0 || entry.MaxQty < entry.MinQty {
				t.Fatalf("%s loot entry %s bad quantity range [%d,%d]", forceType, entry.ItemID, entry.MinQty, entry.MaxQty)
			}
		}
	}

	hive := &model.EnemyForce{ID: "hive-1", Type: model.EnemyForceTypeHive, Strength: 30}
	// hive 是黑雾建筑：dark_fog_matrix 必掉，且数量在表定范围内。
	for tick := int64(1); tick <= 50; tick++ {
		drops := darkFogLootDrops(hive, hive.Strength, tick)
		matrix := 0
		for _, drop := range drops {
			if drop.ItemID == model.ItemDarkFogMatrix {
				matrix = drop.Quantity
			}
			if _, ok := model.Item(drop.ItemID); !ok {
				t.Fatalf("dropped unknown item %s", drop.ItemID)
			}
		}
		if matrix < 1 || matrix > 3 {
			t.Fatalf("hive must always drop 1-3 dark_fog_matrix, got %d at tick %d", matrix, tick)
		}
	}

	// 确定性：同一 (forceID, tick) 结果恒定。
	a := darkFogLootDrops(hive, hive.Strength, 42)
	b := darkFogLootDrops(hive, hive.Strength, 42)
	if len(a) != len(b) {
		t.Fatalf("loot not deterministic: %+v vs %+v", a, b)
	}
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("loot not deterministic: %+v vs %+v", a, b)
		}
	}

	// swarm 的矩阵为概率掉落：大样本下既发生又不恒发生。
	swarm := &model.EnemyForce{ID: "swarm-1", Type: model.EnemyForceTypeSwarm, Strength: 10}
	hits := 0
	for tick := int64(1); tick <= 200; tick++ {
		for _, drop := range darkFogLootDrops(swarm, swarm.Strength, tick) {
			if drop.ItemID == model.ItemDarkFogMatrix {
				hits++
			}
		}
	}
	if hits == 0 || hits == 200 {
		t.Fatalf("swarm matrix drop should be probabilistic, hits=%d/200", hits)
	}
}

// TestGrantDarkFogLootRouting 校验入库路由：建筑库存→机甲背包→丢弃。
func TestGrantDarkFogLootRouting(t *testing.T) {
	ws := newPowerTestWorld()
	drops := []model.ItemAmount{
		{ItemID: model.ItemDarkFogMatrix, Quantity: 2},
		{ItemID: model.ItemTitaniumAlloy, Quantity: 3},
	}

	// 多槽位建筑库存：全部入库。
	storage := model.NewStorageState(model.StorageModule{Capacity: 10, Slots: 4})
	grants := grantDarkFogLoot(ws, "p1", storage, drops)
	if grants[0].StoredQty != 2 || grants[1].StoredQty != 3 {
		t.Fatalf("expected all stored, got %+v", grants)
	}
	if storage.Inventory[model.ItemDarkFogMatrix] != 2 || storage.Inventory[model.ItemTitaniumAlloy] != 3 {
		t.Fatalf("storage contents wrong: %+v", storage.Inventory)
	}
	if ws.Players["p1"].Inventory != nil {
		t.Fatalf("player inventory should stay empty, got %+v", ws.Players["p1"].Inventory)
	}

	// 满仓：保留已有物品，溢出部分转入机甲背包。
	full := model.NewStorageState(model.StorageModule{Capacity: 4, Slots: 4})
	full.EnsureInventory()[model.ItemCoal] = 4
	grants = grantDarkFogLoot(ws, "p1", full, drops)
	if grants[0].StoredQty != 0 || grants[0].CarriedQty != 2 || grants[0].DiscardedQty != 0 {
		t.Fatalf("overflow should transfer to backpack, got %+v", grants[0])
	}
	if full.Inventory[model.ItemCoal] != 4 || len(full.Inventory) != 1 {
		t.Fatalf("full storage must retain existing items, got %+v", full.Inventory)
	}
	if ws.Players["p1"].Inventory[model.ItemDarkFogMatrix] != 2 {
		t.Fatalf("backpack missing overflow loot: %+v", ws.Players["p1"].Inventory)
	}

	// 击杀者玩家不存在：存储满仓时溢出丢弃。
	grants = grantDarkFogLoot(ws, "ghost", full, drops)
	if grants[0].DiscardedQty != 2 || grants[1].DiscardedQty != 3 {
		t.Fatalf("orphan loot should be discarded, got %+v", grants)
	}
}

// TestCombatUnitKillGrantsDarkFogLoot 结算级：战斗单位击杀黑雾建筑，掉落进入击杀者库存。
func TestCombatUnitKillGrantsDarkFogLoot(t *testing.T) {
	ws := newPowerTestWorld()
	ws.Tick = 10
	gc := &GameCore{world: ws, combatUnits: NewCombatUnitManager()}

	unit := spawnLootKillerUnit(gc, ws, "p1", model.Position{X: 2, Y: 2})
	spawnLootTestForce(ws, "hive-1", model.EnemyForceTypeHive, 10, model.Position{X: 3, Y: 2})

	events := gc.settleCombat()

	if len(ws.EnemyForces.Forces) != 0 {
		t.Fatalf("enemy force should be destroyed, remaining %+v", ws.EnemyForces.Forces)
	}
	if got := ws.Players["p1"].Inventory[model.ItemDarkFogMatrix]; got < 1 {
		t.Fatalf("dark_fog_matrix should reach killer inventory, got %d", got)
	}
	lootEvents := lootEventsFor(events, "hive-1")
	if len(lootEvents) == 0 {
		t.Fatalf("expected loot events for hive-1, got %+v", events)
	}
	for _, evt := range lootEvents {
		if evt.VisibilityScope != "p1" || evt.Payload["player_id"] != "p1" {
			t.Fatalf("loot event misattributed: %+v", evt.Payload)
		}
		if evt.Payload["killed_by"] != unit.ID {
			t.Fatalf("loot event killed_by should be %s, got %+v", unit.ID, evt.Payload)
		}
		qty, _ := evt.Payload["quantity"].(int)
		carried, _ := evt.Payload["carried"].(int)
		discarded, _ := evt.Payload["discarded"].(int)
		if qty <= 0 || carried != qty || discarded != 0 {
			t.Fatalf("combat-unit loot should fully reach backpack: %+v", evt.Payload)
		}
	}
}

// TestCombatKillLootAttributionPerPlayer 多玩家归属：各自的击杀只进各自库存。
func TestCombatKillLootAttributionPerPlayer(t *testing.T) {
	ws := newPowerTestWorld()
	ws.Tick = 10
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
	gc := &GameCore{world: ws, combatUnits: NewCombatUnitManager()}

	p1unit := spawnLootKillerUnit(gc, ws, "p1", model.Position{X: 2, Y: 2})
	spawnLootTestForce(ws, "hive-1", model.EnemyForceTypeHive, 10, model.Position{X: 3, Y: 2})
	// p2 的单位没有弹药，无法击杀：p1 的掉落不得串到 p2。
	p2unit := gc.combatUnits.SpawnCombatUnit(ws, model.CombatUnitTypeMech, "p2", model.Position{X: 2, Y: 4}, nil)
	p2unit.AmmoInventory = 0
	spawnLootTestForce(ws, "hive-2", model.EnemyForceTypeHive, 10, model.Position{X: 3, Y: 4})

	events := gc.settleCombat()

	if ws.Players["p1"].Inventory[model.ItemDarkFogMatrix] < 1 {
		t.Fatalf("p1 should receive its own kill loot")
	}
	if len(ws.Players["p2"].Inventory) != 0 {
		t.Fatalf("p2 must not receive p1's loot, got %+v", ws.Players["p2"].Inventory)
	}
	if len(lootEventsFor(events, "hive-2")) != 0 {
		t.Fatalf("hive-2 survived but emitted loot events")
	}

	// 第二回合：p1 停火，p2 补弹后击杀自己的目标，掉落归 p2。
	p1unit.AmmoInventory = 0
	p2unit.AmmoInventory = 100
	p2unit.Weapon = model.WeaponState{Type: model.WeaponTypeGun, Damage: 500, FireRate: 1, Range: 100, AmmoCost: 1}
	p1Before := ws.Players["p1"].Inventory[model.ItemDarkFogMatrix]
	ws.Tick++
	events = gc.settleCombat()
	if ws.Players["p2"].Inventory[model.ItemDarkFogMatrix] < 1 {
		t.Fatalf("p2 should receive its own kill loot")
	}
	if got := ws.Players["p1"].Inventory[model.ItemDarkFogMatrix]; got != p1Before {
		t.Fatalf("p2's kill must not change p1 inventory: before=%d after=%d", p1Before, got)
	}
	for _, evt := range lootEventsFor(events, "hive-2") {
		if evt.VisibilityScope != "p2" || evt.Payload["player_id"] != "p2" {
			t.Fatalf("hive-2 loot misattributed: %+v", evt.Payload)
		}
	}
}

// TestTurretKillGrantsDarkFogLoot 结算级：炮塔击杀同样掉落；
// 弹仓槽位被弹药占用时保留弹药，战利品转入击杀者机甲背包。
func TestTurretKillGrantsDarkFogLoot(t *testing.T) {
	ws := newPowerTestWorld()
	ws.Tick = 10

	turret := newBuilding("turret-1", model.BuildingTypeMissileTurret, "p1", model.Position{X: 2, Y: 2})
	turret.Runtime.State = model.BuildingWorkRunning
	ws.Buildings[turret.ID] = turret
	combat := turret.Runtime.Functions.Combat
	const ammoLoaded = 10
	if accepted, _, err := turret.Storage.Load(combat.AmmoItem, ammoLoaded); err != nil || accepted != ammoLoaded {
		t.Fatalf("load ammo: %d %v", accepted, err)
	}

	spawnLootTestForce(ws, "hive-1", model.EnemyForceTypeHive, 2, model.Position{X: 3, Y: 2})

	var events []*model.GameEvent
	for tick := int64(10); tick < 10+int64(combat.FireRate)*10 && len(ws.EnemyForces.Forces) > 0; tick++ {
		ws.Tick = tick
		events = append(events, settleTurrets(ws)...)
	}
	if len(ws.EnemyForces.Forces) != 0 {
		t.Fatalf("turret should destroy the hive, remaining %+v", ws.EnemyForces.Forces)
	}

	// 战利品进入炮塔所属玩家库存（弹仓 Slots=1 被弹药占用，无法收新物品）。
	if got := ws.Players["p1"].Inventory[model.ItemDarkFogMatrix]; got < 1 {
		t.Fatalf("turret kill should drop dark_fog_matrix to owner, got %d", got)
	}
	// 已有弹药被保留：仅消耗击发用弹。
	ammoLeft := availableStorageItem(turret.Storage, combat.AmmoItem) + currentStorageItem(turret.Storage.OutputBuffer, combat.AmmoItem)
	if ammoLeft <= 0 || ammoLeft >= ammoLoaded {
		t.Fatalf("ammo should be retained minus consumed shots, left=%d loaded=%d", ammoLeft, ammoLoaded)
	}
	if _, ok := turret.Storage.Inventory[model.ItemDarkFogMatrix]; ok {
		t.Fatalf("single-slot magazine must not hoard loot over ammo")
	}

	lootEvents := lootEventsFor(events, "hive-1")
	if len(lootEvents) == 0 {
		t.Fatalf("expected turret kill loot events")
	}
	for _, evt := range lootEvents {
		if evt.Payload["player_id"] != "p1" || evt.Payload["killed_by"] != turret.ID {
			t.Fatalf("turret loot misattributed: %+v", evt.Payload)
		}
		qty, _ := evt.Payload["quantity"].(int)
		carried, _ := evt.Payload["carried"].(int)
		discarded, _ := evt.Payload["discarded"].(int)
		if qty <= 0 || carried != qty || discarded != 0 {
			t.Fatalf("turret loot should overflow into owner backpack: %+v", evt.Payload)
		}
	}
}

// TestDarkFogLootSurvivesSaveRestore 存档恢复：掉落入库后导出存档再恢复，库存保持一致。
func TestDarkFogLootSurvivesSaveRestore(t *testing.T) {
	cfg, maps, q, bus, store := newSaveHarnessDeps(t)
	core := New(cfg, maps, q, bus, store)

	ws := core.World()
	ws.Tick = 10
	unit := spawnLootKillerUnit(core, ws, "p1", model.Position{X: 2, Y: 2})
	_ = unit
	spawnLootTestForce(ws, "hive-1", model.EnemyForceTypeHive, 10, model.Position{X: 3, Y: 2})

	core.settleCombat()
	if len(ws.EnemyForces.Forces) != 0 {
		t.Fatalf("enemy force should be destroyed before save")
	}
	want := ws.Players["p1"].Inventory[model.ItemDarkFogMatrix]
	if want < 1 {
		t.Fatalf("loot should reach p1 inventory before save")
	}

	save, err := core.ExportSaveFile("manual")
	if err != nil {
		t.Fatalf("export save: %v", err)
	}
	restored, err := NewFromSave(cfg, maps, queue.New(), NewEventBus(), store, save)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	got := restored.World().Players["p1"].Inventory[model.ItemDarkFogMatrix]
	if got != want {
		t.Fatalf("loot lost across save/restore: before=%d after=%d", want, got)
	}
}

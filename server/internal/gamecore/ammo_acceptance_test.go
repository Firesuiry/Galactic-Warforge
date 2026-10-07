package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 3.2 验收：补给决定胜负。

func addSupplyStation(ws *model.WorldState, id, owner string, pos model.Position, stock model.ItemInventory) *model.Building {
	b := surfaceTestBuilding(ws, id, btSupply, pos)
	b.OwnerID = owner
	model.InitBuildingStorage(b)
	b.Storage.Inventory = stock
	b.Runtime.State = model.BuildingWorkRunning
	b.Runtime.Params.EnergyConsume = 0 // 测试不搭电网
	if b.Runtime.Functions.Energy != nil {
		b.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	return b
}

// stepAmmoBattle 与流水线保持相同顺序：补给 -> 移动 -> 交战。
func stepAmmoBattle(ws *model.WorldState, ticks int) []*model.GameEvent {
	var events []*model.GameEvent
	for i := 0; i < ticks; i++ {
		ws.Tick++
		settleAmmunitionSupply(ws)
		events = append(events, settleUnitMovement(ws)...)
		events = append(events, settleUnitCombat(ws)...)
	}
	return events
}

// shotsAt 数目标受到的射击次数：每发有攻守双方各一条事件，只取攻方视角的那条。
func shotsAt(events []*model.GameEvent, targetID, attackerOwner string) int {
	n := 0
	for _, evt := range events {
		if evt.EventType == model.EvtDamageApplied && evt.Payload["target_id"] == targetID && evt.VisibilityScope == attackerOwner {
			n++
		}
	}
	return n
}

func countAlive(ws *model.WorldState, owner string) int {
	n := 0
	for _, u := range ws.Units {
		if u.OwnerID == owner && u.HP > 0 {
			n++
		}
	}
	return n
}

func TestUnsuppliedForceRunsDryAndIsAnnihilated(t *testing.T) {
	ws := newRTTWorld(true)
	ws.Tick = 1
	// 双方各 6 个步兵，各带 6 发（远低于弹匣容量）；只有 p1 有补给站。
	var p2 []*model.Unit
	for i := 0; i < 6; i++ {
		a := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 4, Y: 2 + i})
		b := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 6, Y: 2 + i})
		a.Ammo, b.Ammo = 6, 6
		p2 = append(p2, b)
	}
	station := addSupplyStation(ws, "sup-p1", "p1", model.Position{X: 2, Y: 4}, model.ItemInventory{model.ItemAmmoBullet: 2000})

	stepAmmoBattle(ws, 1500)

	if countAlive(ws, "p2") != 0 {
		t.Fatalf("unsupplied side must be annihilated, %d left", countAlive(ws, "p2"))
	}
	if countAlive(ws, "p1") == 0 {
		t.Fatal("supplied side must survive")
	}
	if station.Storage.Inventory[model.ItemAmmoBullet] >= 2000 {
		t.Fatal("station stock must be drawn down by resupply")
	}
	// 断粮方在死前确实是“打空停火”而非被秒杀：其弹药为 0 且状态为 no_ammunition。
	dry := 0
	for _, u := range p2 {
		if u.Ammo == 0 && u.CombatState == "no_ammunition" {
			dry++
		}
	}
	if dry == 0 {
		t.Fatal("expected unsupplied units to have gone dry (no_ammunition)")
	}
}

func TestDryUnitsStopFiringAndCannotHurtSuppliedEnemy(t *testing.T) {
	ws := newRTTWorld(true)
	ws.Tick = 1
	dry := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 4, Y: 4})
	foe := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 5, Y: 4})
	dry.Ammo = 2
	foe.HP, foe.MaxHP = 100000, 100000
	foe.Ammo = 0 // 敌方不还击，便于统计我方射击次数
	events := stepAmmoBattle(ws, 200)
	shots := shotsAt(events, foe.ID, "p1")
	if shots != 2 {
		t.Fatalf("a 2-round magazine must fire exactly 2 shots, got %d", shots)
	}
	if dry.CombatState != "no_ammunition" {
		t.Fatalf("state = %q", dry.CombatState)
	}
}

func TestDestroyingSupplyStationCeasesFrontlineFire(t *testing.T) {
	ws := newRTTWorld(true)
	ws.Tick = 1
	var army []*model.Unit
	for _, pos := range []model.Position{{X: 4, Y: 4}, {X: 6, Y: 4}, {X: 5, Y: 3}, {X: 5, Y: 5}} {
		u := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", pos)
		u.Ammo = 3
		army = append(army, u)
	}
	foe := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 5, Y: 4})
	foe.HP, foe.MaxHP, foe.Ammo = 1000000, 1000000, 0
	station := addSupplyStation(ws, "sup", "p1", model.Position{X: 2, Y: 4}, model.ItemInventory{model.ItemAmmoBullet: 5000})

	events := stepAmmoBattle(ws, 120)
	// 有补给时射击数远超随身弹药总量（4*3=12）。
	if shots := shotsAt(events, foe.ID, "p1"); shots <= 12 {
		t.Fatalf("supply station must sustain fire, only %d shots", shots)
	}

	destroyBuildingCombat(ws, station, foe.ID, "p2", "unit")
	if ws.Buildings[station.ID] != nil {
		t.Fatal("station should be gone")
	}
	remaining := 0
	for _, u := range army {
		remaining += u.Ammo
	}
	events = stepAmmoBattle(ws, 300)
	if shots := shotsAt(events, foe.ID, "p1"); shots > remaining {
		t.Fatalf("after the station fell at most the %d rounds on hand may be fired, got %d", remaining, shots)
	}
	for _, u := range army {
		if u.Ammo != 0 || u.CombatState != "no_ammunition" {
			t.Fatalf("front line must be dry: ammo=%d state=%q", u.Ammo, u.CombatState)
		}
	}
	// 之后再无任何伤害。
	if shots := shotsAt(stepAmmoBattle(ws, 100), foe.ID, "p1"); shots != 0 {
		t.Fatalf("dry front line still fired %d shots", shots)
	}
}

func TestSupplyTruckSustainsForceWithoutStation(t *testing.T) {
	ws := newRTTWorld(true)
	ws.Tick = 1
	u := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 4, Y: 4})
	u.Ammo = 1
	truck := spawnWorldTestUnit(ws, model.UnitTypeSupplyTruck, "p1", model.Position{X: 3, Y: 4})
	truck.Cargo = model.ItemInventory{model.ItemAmmoBullet: 200}
	foe := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 5, Y: 4})
	foe.HP, foe.MaxHP, foe.Ammo = 1000000, 1000000, 0
	events := stepAmmoBattle(ws, 200)
	if shots := shotsAt(events, foe.ID, "p1"); shots < 10 {
		t.Fatalf("supply truck must keep the unit firing, shots=%d", shots)
	}
	if truck.Cargo[model.ItemAmmoBullet] >= 200 {
		t.Fatal("truck cargo must be drawn down")
	}
}

func TestDarkFogNeverSpendsAmmunition(t *testing.T) {
	fog := model.UnitStats(model.UnitTypeDarkFog)
	if !consumeUnitAmmunition(&fog) {
		t.Fatal("stock dark fog units are ammo-free")
	}
	fog.OwnerID, fog.AmmoClass, fog.Ammo = model.DarkFogOwnerID, "bullet", 0
	if !consumeUnitAmmunition(&fog) || fog.Ammo != 0 || fog.CombatState == "no_ammunition" {
		t.Fatal("dark fog must fire with an empty magazine and never flip to no_ammunition")
	}

	ws := newRTTWorld(true)
	provokeDarkFogFor(ws, "p1", "p2") // 玩家已与黑雾交战
	ws.Tick = 1
	raider := spawnWorldTestUnit(ws, model.UnitTypeDarkFog, "p2", model.Position{X: 5, Y: 4})
	raider.OwnerID, raider.AmmoClass, raider.Ammo = model.DarkFogOwnerID, "bullet", 0
	victim := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 6, Y: 4})
	victim.HP, victim.MaxHP, victim.Ammo = 100000, 100000, 0
	events := stepAmmoBattle(ws, 100)
	if shotsAt(events, victim.ID, model.DarkFogOwnerID) < 3 || raider.Ammo != 0 {
		t.Fatalf("dark fog raider must keep firing without ammo (ammo=%d)", raider.Ammo)
	}
}

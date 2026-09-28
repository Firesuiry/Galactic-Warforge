package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// R4 舰队对舰队：同星系敌对舰队自动交火，结构归零被摧毁。

func addCombatTestFleet(core *GameCore, playerID, systemID, fleetID string, directFire int, structure int) *model.SpaceFleet {
	fleet := &model.SpaceFleet{
		ID:         fleetID,
		OwnerID:    playerID,
		SystemID:   systemID,
		Formation:  model.FormationTypeLine,
		State:      model.FleetStateIdle,
		Units:      []model.FleetUnitStack{{BlueprintID: "corvette", Count: 1}},
		Weapons:    model.SpaceWeaponMix{DirectFire: directFire},
		Weapon:     model.WeaponState{Type: model.WeaponTypeLaser, Damage: directFire, FireRate: 10, Range: 20},
		Structure:  model.DurabilityLayerState{Level: structure, MaxLevel: structure},
		Subsystems: model.DefaultSpaceFleetSubsystemState(),
	}
	core.spaceRuntime.EnsurePlayerSystem(playerID, systemID).Fleets[fleetID] = fleet
	return fleet
}

func TestR4HostileFleetsExchangeFireAndDestroy(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	worlds := map[string]*model.WorldState{ws.PlanetID: ws}

	fleetA := addCombatTestFleet(core, "p1", "sys-1", "fleet-a", 80, 100)
	fleetB := addCombatTestFleet(core, "p2", "sys-1", "fleet-b", 60, 60)

	// 交战直至一方毁灭。
	var events []*model.GameEvent
	for tick := int64(1); tick <= 400; tick++ {
		ws.Tick = tick
		events = append(events, settleFleetVsFleet(worlds, core.spaceRuntime, tick)...)
		if fleetA.Structure.Level <= 0 || fleetB.Structure.Level <= 0 {
			break
		}
	}
	if fleetB.Structure.Level > 0 && fleetA.Structure.Level > 0 {
		t.Fatalf("hostile fleets never damaged each other: A=%d B=%d", fleetA.Structure.Level, fleetB.Structure.Level)
	}
	// 火力更强的 p1 应获胜（80 vs 60 直瞄）。
	if fleetB.Structure.Level > 0 {
		t.Fatalf("weaker fleet should lose the exchange: A=%d B=%d", fleetA.Structure.Level, fleetB.Structure.Level)
	}
	if core.spaceRuntime.Players["p2"].Systems["sys-1"].Fleets["fleet-b"] != nil {
		t.Fatal("destroyed fleet not removed from system")
	}
	damageSeen, destroyedSeen := false, false
	for _, evt := range events {
		if evt.EventType == model.EvtDamageApplied && evt.Payload["target_type"] == "fleet" {
			damageSeen = true
		}
		if evt.EventType == model.EvtEntityDestroyed && evt.Payload["entity_type"] == "fleet" {
			destroyedSeen = true
		}
	}
	if !damageSeen || !destroyedSeen {
		t.Fatal("missing fleet damage/destroyed events")
	}
}

func TestR4AlliedFleetsDoNotEngage(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	// 同队玩家：互不交火。
	ws.Players["p1"].TeamID = "team-x"
	ws.Players["p2"].TeamID = "team-x"
	worlds := map[string]*model.WorldState{ws.PlanetID: ws}

	fleetA := addCombatTestFleet(core, "p1", "sys-1", "fleet-a", 80, 100)
	fleetB := addCombatTestFleet(core, "p2", "sys-1", "fleet-b", 60, 60)
	for tick := int64(1); tick <= 50; tick++ {
		ws.Tick = tick
		settleFleetVsFleet(worlds, core.spaceRuntime, tick)
	}
	if fleetA.Structure.Level != 100 || fleetB.Structure.Level != 60 {
		t.Fatal("allied fleets engaged each other")
	}

	// 不同星系：不交火（sys-1 清空后，fleet-a 与 sys-2 的 fleet-c 互不构成交战）。
	ws.Players["p1"].TeamID = ""
	ws.Players["p2"].TeamID = ""
	delete(core.spaceRuntime.Players["p2"].Systems["sys-1"].Fleets, "fleet-b")
	fleetC := addCombatTestFleet(core, "p2", "sys-2", "fleet-c", 60, 60)
	for tick := int64(51); tick <= 100; tick++ {
		ws.Tick = tick
		settleFleetVsFleet(worlds, core.spaceRuntime, tick)
	}
	if fleetA.Structure.Level != 100 || fleetC.Structure.Level != 60 {
		t.Fatal("fleets in different systems engaged")
	}
}

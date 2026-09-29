package gamecore

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/model"
)

func newGapWorld() *model.WorldState {
	ws := model.NewWorldState("gap-planet", 32)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true, Tech: model.NewPlayerTechState("p1")}
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
	return ws
}

func gapSquad(ws *model.WorldState, id string, pos model.Position, weaponRange float64) *model.CombatSquad {
	squad := &model.CombatSquad{
		ID:          id,
		OwnerID:     "p1",
		PlanetID:    ws.PlanetID,
		BlueprintID: model.ItemPrototype,
		Count:       2,
		MemberMaxHP: 80,
		HP:          160,
		MaxHP:       160,
		Weapon:      model.WeaponState{Type: model.WeaponTypeLaser, Damage: 20, FireRate: 10, Range: weaponRange},
		State:       model.CombatSquadStateIdle,
		Position:    pos,
		MoveSpeed:   1,
		Sustainment: model.WarSustainmentState{Current: model.WarSupplyStock{Ammo: 8}},
	}
	ws.CombatRuntime.Squads[id] = squad
	return squad
}

func TestGapR3UngroupedSquadDoesNotChaseDistantEnemy(t *testing.T) {
	ws := newGapWorld()
	squad := gapSquad(ws, "squad-far", model.Position{X: 6, Y: 6}, 8)
	enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 36, Y: 16})
	if d := ws.SurfaceDistance(squad.Position, enemy.Position); d <= defaultUngroupedAggroRange {
		t.Fatalf("fixture distance %d is not beyond ungrouped aggro %d", d, defaultUngroupedAggroRange)
	}
	squad.TargetEnemyID = enemy.ID
	squad.Path = []model.Position{squad.Position, enemy.Position}
	squad.PathIndex = 1

	events := settleCombatRuntime(ws, 1)
	if squad.TargetEnemyID != "" || squad.State != model.CombatSquadStateIdle {
		t.Fatalf("distant enemy must be dropped, got %+v", squad)
	}
	if squad.HasPath() {
		t.Fatalf("ungrouped squad must not keep a chase path, got %+v", squad.Path)
	}
	if damageEventsFor(events, enemy.ID) != 0 {
		t.Fatal("distant enemy must not be fired on")
	}
}

func TestGapR3SquadPursuesInsideAggroOutsideWeaponRange(t *testing.T) {
	ws := newGapWorld()
	squad := gapSquad(ws, "squad-near", model.Position{X: 6, Y: 6}, 8)
	enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 16, Y: 6})
	dist := ws.SurfaceDistance(squad.Position, enemy.Position)
	if dist <= int(squad.Weapon.Range) || dist > defaultUngroupedAggroRange {
		t.Fatalf("fixture distance %d should be inside aggro and outside weapon range", dist)
	}

	events := settleCombatRuntime(ws, 1)
	if squad.TargetEnemyID != enemy.ID || squad.State != model.CombatSquadStateEngaging {
		t.Fatalf("in-radius enemy should be selected, got %+v", squad)
	}
	if !squad.HasPath() {
		t.Fatal("pursue should write a path when the target is outside weapon range")
	}
	if damageEventsFor(events, enemy.ID) != 0 {
		t.Fatal("must not fire before closing to weapon range")
	}

	before := squad.Position
	settleSquadMovement(ws)
	if squad.Position == before || ws.SurfaceDistance(squad.Position, enemy.Position) >= dist {
		t.Fatalf("pursue should close distance, before=%+v after=%+v", before, squad.Position)
	}
}

func TestGapR3UngroupedFleetIgnoresForceFarFromAnchor(t *testing.T) {
	ws := newGapWorld()
	anchor := fleetAnchorPosition(ws, nil)
	forcePos := model.Position{X: 51, Y: 12}
	if d := ws.SurfaceDistance(anchor, forcePos); d <= defaultUngroupedAggroRange {
		t.Fatalf("fixture distance %d is not beyond ungrouped fleet aggro", d)
	}
	ws.EnemyForces = &model.EnemyForceState{
		SystemID: ws.PlanetID,
		Forces: []model.EnemyForce{{
			ID:       "far-force",
			Type:     model.EnemyForceTypeHive,
			Position: forcePos,
			Strength: 80,
		}},
	}
	space := model.NewSpaceRuntimeState()
	fleet := &model.SpaceFleet{
		ID:      "fleet-far",
		OwnerID: "p1",
		State:   model.FleetStateAttacking,
		Target:  &model.FleetTarget{PlanetID: ws.PlanetID, TargetID: "far-force"},
		Weapons: model.SpaceWeaponMix{DirectFire: 40},
		Sustainment: model.WarSustainmentState{
			Current: model.WarSupplyStock{Ammo: 4},
		},
	}
	space.EnsurePlayerSystem("p1", "sys").Fleets[fleet.ID] = fleet

	events := settleSpaceFleets(map[string]*model.WorldState{ws.PlanetID: ws}, nil, space, 1)
	if fleet.State != model.FleetStateAttacking || fleet.Target == nil || fleet.Target.TargetID != "far-force" {
		t.Fatalf("explicit fleet attack must keep a far target, got %+v", fleet)
	}
	if damageEventsFor(events, "far-force") == 0 || ws.EnemyForces.Forces[0].Strength >= 80 {
		t.Fatal("explicit far target must take fleet fire")
	}

	fleet.Target.TargetID = "missing"
	ws.EnemyForces.Forces[0].Strength = 80
	events = settleSpaceFleets(map[string]*model.WorldState{ws.PlanetID: ws}, nil, space, 2)
	if fleet.State != model.FleetStateIdle || fleet.Target != nil {
		t.Fatalf("ungrouped fleet must not acquire a force far from the map-center anchor, got %+v", fleet)
	}
	if damageEventsFor(events, "far-force") != 0 || ws.EnemyForces.Forces[0].Strength != 80 {
		t.Fatal("far force must not be auto-acquired")
	}
}

func TestGapR3TaskForceRadiusDropsOutOfRangeEnemy(t *testing.T) {
	ws := newGapWorld()
	squad := gapSquad(ws, "squad-tf", model.Position{X: 6, Y: 6}, 4)
	enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 36, Y: 16})
	stanceLimit := model.WarTaskForceProfile(model.WarTaskForceStanceIntercept).MaxEngagementDistance
	if d := ws.SurfaceDistance(squad.Position, enemy.Position); d <= stanceLimit {
		t.Fatalf("fixture distance %d is inside intercept radius %d", d, stanceLimit)
	}
	ws.Players["p1"].EnsureWarCoordination().TaskForces["tf-squad"] = &model.WarTaskForce{
		ID:      "tf-squad",
		OwnerID: "p1",
		Stance:  model.WarTaskForceStanceIntercept,
		Members: []model.WarTaskForceMemberRef{{
			Kind:     model.WarTaskForceMemberKindSquad,
			EntityID: squad.ID,
		}},
	}
	squad.TargetEnemyID = enemy.ID
	events := settleCombatRuntime(ws, 1)
	if squad.TargetEnemyID != "" || squad.HasPath() || damageEventsFor(events, enemy.ID) != 0 {
		t.Fatalf("task force must not acquire outside its stance radius, got %+v", squad)
	}

	enemy.Position = model.Position{X: 16, Y: 6}
	if d := ws.SurfaceDistance(squad.Position, enemy.Position); d > stanceLimit || d <= int(squad.Weapon.Range) {
		t.Fatalf("moved enemy distance %d is not inside intercept radius and outside weapon range", d)
	}
	settleCombatRuntime(ws, 2)
	if squad.TargetEnemyID != enemy.ID || !squad.HasPath() {
		t.Fatalf("intercept should still pursue inside its finite radius, got %+v", squad)
	}

	anchor := fleetAnchorPosition(ws, nil)
	forcePos := model.Position{X: 51, Y: 12}
	if d := ws.SurfaceDistance(anchor, forcePos); d <= stanceLimit {
		t.Fatalf("fleet fixture distance %d is inside intercept radius", d)
	}
	ws.EnemyForces = &model.EnemyForceState{
		Forces: []model.EnemyForce{{
			ID:       "tf-far-force",
			Type:     model.EnemyForceTypeBeacon,
			Position: forcePos,
			Strength: 50,
		}},
	}
	space := model.NewSpaceRuntimeState()
	fleet := &model.SpaceFleet{
		ID:      "fleet-tf",
		OwnerID: "p1",
		State:   model.FleetStateAttacking,
		Target:  &model.FleetTarget{PlanetID: ws.PlanetID, TargetID: "tf-far-force"},
		Weapons: model.SpaceWeaponMix{DirectFire: 30},
		Sustainment: model.WarSustainmentState{
			Current: model.WarSupplyStock{Ammo: 4},
		},
	}
	space.EnsurePlayerSystem("p1", "sys").Fleets[fleet.ID] = fleet
	ws.Players["p1"].WarCoordination.TaskForces["tf-fleet"] = &model.WarTaskForce{
		ID:      "tf-fleet",
		OwnerID: "p1",
		Stance:  model.WarTaskForceStanceIntercept,
		Members: []model.WarTaskForceMemberRef{{
			Kind:     model.WarTaskForceMemberKindFleet,
			EntityID: fleet.ID,
		}},
	}
	fleetEvents := settleSpaceFleets(map[string]*model.WorldState{ws.PlanetID: ws}, nil, space, 3)
	if fleet.State != model.FleetStateIdle || fleet.Target != nil || damageEventsFor(fleetEvents, "tf-far-force") != 0 {
		t.Fatalf("task force fleet must not select a force outside stance radius, got %+v", fleet)
	}
}

func threatLevelEvents(events []*model.GameEvent) []*model.GameEvent {
	var out []*model.GameEvent
	for _, evt := range events {
		if evt != nil && evt.EventType == model.EvtThreatLevelChanged {
			out = append(out, evt)
		}
	}
	return out
}

func TestGapE2ThreatLevelEventOnlyOnChange(t *testing.T) {
	ws := newRTTWorld(false)
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: false}
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID, ThreatLevel: model.ThreatLevelNone, ThreatMeter: 1}
	core := &GameCore{cfg: &config.Config{Battlefield: config.BattlefieldConfig{EnemyDifficulty: "off"}}}

	if got := threatLevelEvents(core.settleEnemyForces(ws)); len(got) != 0 {
		t.Fatalf("none→none must not emit, got %+v", got)
	}

	center := getPlayerCenterPosition(ws, "p1")
	ws.EnemyForces.Forces = []model.EnemyForce{{
		ID:       "threat-force",
		Type:     model.EnemyForceTypeHive,
		Position: center,
		Strength: 80,
	}}
	ws.EnemyForces.ThreatMeter = 3.5
	raised := threatLevelEvents(core.settleEnemyForces(ws))
	if len(raised) != 1 {
		t.Fatalf("level change should emit once per alive player, got %+v", raised)
	}
	payload := raised[0].Payload
	if payload["player_id"] != "p1" || payload["planet_id"] != ws.PlanetID ||
		payload["threat_level"] != model.ThreatLevelLow || payload["force_count"] != 1 || payload["threat_meter"] != 3.5 {
		t.Fatalf("threat payload shape changed: %+v", payload)
	}
	if raised[0].VisibilityScope != "p1" {
		t.Fatalf("event scope = %s, want p1", raised[0].VisibilityScope)
	}

	ws.EnemyForces.ThreatMeter = 9.25
	if got := threatLevelEvents(core.settleEnemyForces(ws)); len(got) != 0 {
		t.Fatalf("same level must not emit even if threat_meter changed, got %+v", got)
	}
	if ws.EnemyForces.ThreatLevel != model.ThreatLevelLow {
		t.Fatalf("level should stay low, got %d", ws.EnemyForces.ThreatLevel)
	}

	ws.EnemyForces.Forces = nil
	ws.EnemyForces.ThreatMeter = 9.25
	dropped := threatLevelEvents(core.settleEnemyForces(ws))
	if len(dropped) != 1 {
		t.Fatalf("downgrade should emit once, got %+v", dropped)
	}
	if dropped[0].Payload["threat_level"] != model.ThreatLevelNone || dropped[0].Payload["force_count"] != 0 || dropped[0].Payload["threat_meter"] != 9.25 {
		t.Fatalf("downgrade payload wrong: %+v", dropped[0].Payload)
	}
}

func TestGapU6CombatTechScalesSquadAndFleet(t *testing.T) {
	ws := newGapWorld()
	player := ws.Players["p1"]
	player.EnsureWarBlueprints()["gap_missile"] = &model.WarBlueprint{
		ID:         "gap_missile",
		Domain:     model.UnitDomainSpace,
		BaseHullID: "corvette_hull",
		State:      model.WarBlueprintStatePrototype,
		Components: []model.WarBlueprintComponentSlot{
			{SlotID: "weapon_primary", ComponentID: "swarm_missile_pod"},
		},
	}

	profile, ok := model.WarBlueprintRuntimeProfileByID(model.ItemPrototype)
	if !ok || profile.Squad == nil {
		t.Fatal("prototype squad profile missing")
	}
	squad := gapSquad(ws, "squad-tech", model.Position{X: 4, Y: 4}, 8)
	squad.HP = 50
	custom := &model.CombatSquad{
		ID:          "squad-custom",
		OwnerID:     "p1",
		BlueprintID: "no-such-blueprint",
		Count:       1,
		MemberMaxHP: 40,
		HP:          40,
		MaxHP:       40,
		Weapon:      model.WeaponState{Damage: 7},
		State:       model.CombatSquadStateIdle,
	}
	ws.CombatRuntime.Squads[custom.ID] = custom

	space := model.NewSpaceRuntimeState()
	fleet := &model.SpaceFleet{
		ID:      "fleet-tech",
		OwnerID: "p1",
		Units: []model.FleetUnitStack{
			{BlueprintID: model.ItemCorvette, Count: 1},
			{BlueprintID: "gap_missile", Count: 1},
		},
	}
	rebuildFleetStats(ws, "p1", fleet)
	fleet.Structure.Level = fleet.Structure.MaxLevel / 2
	damagedLevel := fleet.Structure.Level
	baseDirect := fleet.Weapons.DirectFire
	baseMissile := fleet.Weapons.Missile
	baseWeapon := fleet.Weapon.Damage
	baseStructure := fleet.Structure.MaxLevel
	if baseDirect <= 0 || baseMissile <= 0 || baseWeapon <= 0 || baseStructure <= 0 {
		t.Fatalf("fleet baseline missing firepower or structure: %+v weapon=%d structure=%d", fleet.Weapons, baseWeapon, baseStructure)
	}
	bare := &model.SpaceFleet{
		ID:        "fleet-bare",
		OwnerID:   "p1",
		Weapons:   model.SpaceWeaponMix{DirectFire: 33},
		Weapon:    model.WeaponState{Damage: 33},
		Structure: model.DurabilityLayerState{Level: 20, MaxLevel: 20},
	}
	system := space.EnsurePlayerSystem("p1", "sys")
	system.Fleets[fleet.ID] = fleet
	system.Fleets[bare.ID] = bare

	player.Tech.CompletedTechs["df_kinetic_weapon_damage"] = 2
	player.Tech.CompletedTechs["df_enhanced_structure"] = 1
	settleCombatTech(ws, space)

	wantDamage := scaleCombatTechStat(profile.Squad.Weapon.Damage, 0.2)
	wantMember := scaleCombatTechStat(profile.Squad.HP, 0.1)
	if squad.Weapon.Damage != wantDamage || squad.MemberMaxHP != wantMember || squad.MaxHP != wantMember*squad.Count {
		t.Fatalf("squad tech = damage %d member %d max %d, want %d/%d/%d", squad.Weapon.Damage, squad.MemberMaxHP, squad.MaxHP, wantDamage, wantMember, wantMember*squad.Count)
	}
	if squad.HP != 50 {
		t.Fatalf("structure_hp must not heal lost squad HP, got %d", squad.HP)
	}
	if fleet.Weapons.DirectFire != scaleCombatTechStat(baseDirect, 0.2) || fleet.Weapons.Missile != scaleCombatTechStat(baseMissile, 0.2) || fleet.Weapon.Damage != scaleCombatTechStat(baseWeapon, 0.2) {
		t.Fatalf("fleet firepower = %+v damage %d", fleet.Weapons, fleet.Weapon.Damage)
	}
	if fleet.Structure.MaxLevel != scaleCombatTechStat(baseStructure, 0.1) || fleet.Structure.Level != damagedLevel {
		t.Fatalf("fleet structure = %+v, want max %d level %d", fleet.Structure, scaleCombatTechStat(baseStructure, 0.1), damagedLevel)
	}
	if custom.Weapon.Damage != 7 || custom.MaxHP != 40 || bare.Weapons.DirectFire != 33 || bare.Structure.MaxLevel != 20 {
		t.Fatal("entities without a runtime profile must not be rewritten")
	}

	settleCombatTech(ws, space)
	if squad.Weapon.Damage != wantDamage || squad.MaxHP != wantMember*squad.Count || fleet.Weapons.DirectFire != scaleCombatTechStat(baseDirect, 0.2) || fleet.Structure.MaxLevel != scaleCombatTechStat(baseStructure, 0.1) {
		t.Fatal("second settle must not stack the bonus")
	}

	squad.HP = squad.MaxHP
	fleet.Structure.Level = fleet.Structure.MaxLevel
	delete(player.Tech.CompletedTechs, "df_kinetic_weapon_damage")
	delete(player.Tech.CompletedTechs, "df_enhanced_structure")
	settleCombatTech(ws, space)
	if squad.Weapon.Damage != profile.Squad.Weapon.Damage || squad.MemberMaxHP != profile.Squad.HP || squad.MaxHP != profile.Squad.HP*squad.Count || squad.HP != squad.MaxHP {
		t.Fatalf("squad did not return to baseline and clamp, got %+v", squad)
	}
	if fleet.Weapons.DirectFire != baseDirect || fleet.Weapons.Missile != baseMissile || fleet.Weapon.Damage != baseWeapon || fleet.Structure.MaxLevel != baseStructure || fleet.Structure.Level != baseStructure {
		t.Fatalf("fleet did not return to baseline and clamp, got weapons %+v damage %d structure %+v", fleet.Weapons, fleet.Weapon.Damage, fleet.Structure)
	}
}

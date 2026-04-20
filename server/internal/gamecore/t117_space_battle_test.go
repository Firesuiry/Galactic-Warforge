package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/snapshot"
	"siliconworld/internal/visibility"
)

func TestT117SpaceBattleSettlementGeneratesBattleReportAndPersistsRuntime(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	systemID := core.Maps().PrimaryPlanet().SystemID

	grantTechs(ws, "p1", "destroyer")

	base := newBuilding("battle-hub-t117", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 6, Y: 6})
	base.Runtime.State = model.BuildingWorkRunning
	base.Runtime.Params.EnergyConsume = 0
	if base.Runtime.Functions.Energy != nil {
		base.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	attachBuilding(ws, base)

	power := newBuilding("battle-power-t117", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	power.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, power)

	createMissileDestroyerBlueprintForT117(t, core, ws, "missile_destroyer_t117")

	ws.Players["p1"].EnsureWarIndustry().DeploymentHubs[base.ID] = &model.WarDeploymentHubState{
		BuildingID:    base.ID,
		Capacity:      8,
		ReadyPayloads: map[string]int{"missile_destroyer_t117": 1},
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdCommissionFleet,
		Payload: map[string]any{
			"building_id":  base.ID,
			"blueprint_id": "missile_destroyer_t117",
			"count":        1,
			"system_id":    systemID,
			"fleet_id":     "fleet-t117",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("commission fleet failed: %s (%s)", res.Code, res.Message)
	}

	ws.EnemyForces = &model.EnemyForceState{
		SystemID: systemID,
		Forces: []model.EnemyForce{{
			ID:           "enemy-space-t117",
			Type:         model.EnemyForceTypeBeacon,
			Position:     model.Position{X: 12, Y: 12},
			Strength:     240,
			TargetPlayer: "p1",
			SpawnTick:    ws.Tick,
		}},
	}
	settlePlanetSensorContacts(ws, ws.Tick)

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdFleetAttack,
		Payload: map[string]any{
			"fleet_id":  "fleet-t117",
			"planet_id": ws.PlanetID,
			"target_id": "enemy-space-t117",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("fleet_attack failed: %s (%s)", res.Code, res.Message)
	}

	events := settleSpaceFleets(core.worlds, core.maps, core.spaceRuntime, ws.Tick+1)
	assertEventTypePresent(t, events, model.EvtMissileSalvoFired)
	assertEventTypePresent(t, events, model.EvtPointDefenseIntercept)
	assertEventTypePresent(t, events, model.EvtBattleReportGenerated)

	systemRuntime := core.SpaceRuntime().PlayerSystem("p1", systemID)
	if systemRuntime == nil {
		t.Fatal("expected player system runtime after fleet commission")
	}
	if len(systemRuntime.BattleReports) != 1 {
		t.Fatalf("expected one stored battle report, got %+v", systemRuntime.BattleReports)
	}

	fleet := systemRuntime.Fleets["fleet-t117"]
	if fleet == nil {
		t.Fatalf("expected commissioned fleet to persist, got %+v", systemRuntime.Fleets)
	}
	if fleet.Weapons.Missile <= 0 {
		t.Fatalf("expected missile fleet firepower to be aggregated, got %+v", fleet.Weapons)
	}
	if fleet.Armor.MaxLevel <= 0 || fleet.Structure.MaxLevel <= 0 {
		t.Fatalf("expected fleet layered durability, got armor=%+v structure=%+v", fleet.Armor, fleet.Structure)
	}
	if fleet.LastBattleReportID == "" {
		t.Fatalf("expected fleet to track latest battle report, got %+v", fleet)
	}

	report := systemRuntime.BattleReports[0]
	if report.BattleID != fleet.LastBattleReportID {
		t.Fatalf("expected fleet last battle report id %q, got %+v", fleet.LastBattleReportID, report)
	}
	if report.FleetFirepower.Missile <= 0 {
		t.Fatalf("expected report to describe missile firepower, got %+v", report.FleetFirepower)
	}
	if report.FleetMissileSalvo.Fired <= 0 {
		t.Fatalf("expected fleet missile salvo in battle report, got %+v", report.FleetMissileSalvo)
	}
	if report.EnemyMissileSalvo.Intercepted <= 0 {
		t.Fatalf("expected point defense intercepts in battle report, got %+v", report.EnemyMissileSalvo)
	}
	if report.FleetDamage.Shield <= 0 || report.FleetDamage.Armor <= 0 {
		t.Fatalf("expected layered shield and armor damage in battle report, got %+v", report.FleetDamage)
	}
	if len(report.SubsystemHits) == 0 {
		t.Fatalf("expected subsystem hits in battle report, got %+v", report)
	}
	if report.LockQuality <= 0 || report.JammingPenalty <= 0 {
		t.Fatalf("expected contact quality and jamming to affect battle report, got %+v", report)
	}
	if ws.EnemyForces.Forces[0].Strength >= 240 {
		t.Fatalf("expected enemy force strength to drop after battle, got %+v", ws.EnemyForces.Forces[0])
	}
	if fleet.Shield.Level >= fleet.Shield.MaxLevel {
		t.Fatalf("expected fleet shield to take damage, got %+v", fleet.Shield)
	}
	if fleet.Subsystems.PointDefense.Integrity >= 1 &&
		fleet.Subsystems.FireControl.Integrity >= 1 &&
		fleet.Subsystems.Sensors.Integrity >= 1 &&
		fleet.Subsystems.Engine.Integrity >= 1 {
		t.Fatalf("expected at least one degraded subsystem, got %+v", fleet.Subsystems)
	}

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	systemView, ok := ql.SystemRuntime("p1", systemID, ws.PlanetID, ws, core.SpaceRuntime())
	if !ok {
		t.Fatal("expected system runtime query view")
	}
	if len(systemView.BattleReports) != 1 {
		t.Fatalf("expected query battle reports, got %+v", systemView)
	}

	fleetView, ok := ql.Fleet("p1", "fleet-t117", core.SpaceRuntime())
	if !ok {
		t.Fatal("expected fleet detail query view")
	}
	if fleetView.LastBattleReport == nil {
		t.Fatalf("expected fleet detail to expose latest battle report, got %+v", fleetView)
	}
	if fleetView.LastBattleReport.BattleID != report.BattleID {
		t.Fatalf("expected fleet detail last report %q, got %+v", report.BattleID, fleetView.LastBattleReport)
	}
	if fleetView.Armor.MaxLevel <= 0 || fleetView.Structure.MaxLevel <= 0 {
		t.Fatalf("expected fleet detail to expose layered durability, got %+v", fleetView)
	}

	snap := snapshot.CaptureRuntime(core.worlds, core.ActivePlanetID(), core.Discovery(), core.SpaceRuntime())
	restoredWorlds, activePlanetID, restoredSpace, err := snap.RestoreRuntime()
	if err != nil {
		t.Fatalf("restore runtime snapshot: %v", err)
	}
	restoredDiscovery, err := snap.RestoreDiscovery()
	if err != nil {
		t.Fatalf("restore discovery snapshot: %v", err)
	}

	restoredQL := query.New(visibility.New(), core.Maps(), restoredDiscovery)
	restoredSystemView, ok := restoredQL.SystemRuntime("p1", systemID, activePlanetID, restoredWorlds[activePlanetID], restoredSpace)
	if !ok {
		t.Fatal("expected restored system runtime query view")
	}
	if len(restoredSystemView.BattleReports) != 1 {
		t.Fatalf("expected restored battle report, got %+v", restoredSystemView)
	}

	restoredFleetView, ok := restoredQL.Fleet("p1", "fleet-t117", restoredSpace)
	if !ok {
		t.Fatal("expected restored fleet detail view")
	}
	if restoredFleetView.LastBattleReport == nil || restoredFleetView.LastBattleReport.BattleID != report.BattleID {
		t.Fatalf("expected restored fleet report %q, got %+v", report.BattleID, restoredFleetView.LastBattleReport)
	}
}

func createMissileDestroyerBlueprintForT117(t *testing.T, core *GameCore, ws *model.WorldState, blueprintID string) {
	t.Helper()

	commands := []model.Command{
		{
			Type: model.CmdBlueprintCreate,
			Payload: map[string]any{
				"blueprint_id": blueprintID,
				"name":         "Missile Destroyer T117",
				"domain":       string(model.UnitDomainSpace),
				"base_hull_id": "destroyer_hull",
			},
		},
		{Type: model.CmdBlueprintSetComponent, Payload: map[string]any{"blueprint_id": blueprintID, "slot_id": "reactor", "component_id": "naval_fission_core"}},
		{Type: model.CmdBlueprintSetComponent, Payload: map[string]any{"blueprint_id": blueprintID, "slot_id": "drive", "component_id": "vector_thrusters"}},
		{Type: model.CmdBlueprintSetComponent, Payload: map[string]any{"blueprint_id": blueprintID, "slot_id": "armor", "component_id": "reactive_armor"}},
		{Type: model.CmdBlueprintSetComponent, Payload: map[string]any{"blueprint_id": blueprintID, "slot_id": "sensor", "component_id": "battle_link_array"}},
		{Type: model.CmdBlueprintSetComponent, Payload: map[string]any{"blueprint_id": blueprintID, "slot_id": "weapon_primary", "component_id": "swarm_missile_pod"}},
		{Type: model.CmdBlueprintSetComponent, Payload: map[string]any{"blueprint_id": blueprintID, "slot_id": "weapon_aux", "component_id": "point_defense_grid"}},
		{Type: model.CmdBlueprintSetComponent, Payload: map[string]any{"blueprint_id": blueprintID, "slot_id": "utility", "component_id": "ecm_suite"}},
		{Type: model.CmdBlueprintValidate, Payload: map[string]any{"blueprint_id": blueprintID}},
		{Type: model.CmdBlueprintFinalize, Payload: map[string]any{"blueprint_id": blueprintID, "target_state": string(model.WarBlueprintStatePrototype)}},
	}

	for _, cmd := range commands {
		res := issueInternalCommand(core, "p1", cmd)
		if res.Code != model.CodeOK {
			t.Fatalf("command %s failed: %s (%s)", cmd.Type, res.Code, res.Message)
		}
	}

	player := ws.Players["p1"]
	if player == nil || player.WarBlueprints[blueprintID] == nil {
		t.Fatalf("expected player blueprint %s, got %+v", blueprintID, player)
	}
	if player.WarBlueprints[blueprintID].State != model.WarBlueprintStatePrototype {
		t.Fatalf("expected finalized prototype blueprint, got %+v", player.WarBlueprints[blueprintID])
	}
}

func assertEventTypePresent(t *testing.T, events []*model.GameEvent, target model.EventType) {
	t.Helper()
	for _, event := range events {
		if event != nil && event.EventType == target {
			return
		}
	}
	t.Fatalf("expected event type %s in %+v", target, events)
}

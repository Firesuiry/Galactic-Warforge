package gamecore

import (
	"encoding/json"
	"reflect"
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/visibility"
)

func TestT116WarSupplyNodesAndRuntimeQueriesExposeSustainment(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	systemID := core.Maps().PrimaryPlanet().SystemID
	grantTechs(ws, "p1", "prototype", "corvette")

	base := newBuilding("hub-t116", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 6, Y: 6})
	base.Runtime.State = model.BuildingWorkRunning
	base.Runtime.Params.EnergyConsume = 0
	attachBuilding(ws, base)

	power := newBuilding("power-t116", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	power.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, power)
	// 命令期供电判定与 tick 结算同源：先结算一次发电，部署枢纽才有电。
	settlePowerGeneration(ws, currentPlanetEnvironment(core.maps, ws.PlanetID))

	planetary := newBuilding("pls-t116", model.BuildingTypePlanetaryLogisticsStation, "p1", model.Position{X: 8, Y: 6})
	planetary.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, planetary)

	interstellar := newBuilding("ils-t116", model.BuildingTypeInterstellarLogisticsStation, "p1", model.Position{X: 10, Y: 6})
	interstellar.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, interstellar)

	// 部署枢纽与物流站里的弹药不参与补给，只有补给站和补给车补弹。
	loadBuildingItems(t, base, map[string]int{model.ItemAmmoBullet: 18})
	ws.LogisticsStations[planetary.ID].Inventory = model.ItemInventory{model.ItemAmmoBullet: 24}
	ws.LogisticsStations[interstellar.ID].Inventory = model.ItemInventory{model.ItemAmmoMissile: 7}
	addSupplyStation(ws, "sup-t116", "p1", model.Position{X: 12, Y: 6}, model.ItemInventory{model.ItemAmmoBullet: 30, model.ItemShellSet: 6})
	truck := spawnWorldTestUnit(ws, model.UnitTypeSupplyTruck, "p1", model.Position{X: 9, Y: 9})
	truck.Cargo = model.ItemInventory{model.ItemAmmoMissile: 3}

	ws.Players["p1"].EnsureWarIndustry().DeploymentHubs[base.ID] = &model.WarDeploymentHubState{
		BuildingID:    base.ID,
		Capacity:      16,
		ReadyPayloads: map[string]int{model.ItemPrototype: 2, model.ItemCorvette: 1},
	}

	// 地面部队：世界单位自带血量与弹药，编队只是命令容器。
	rifleman := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 7, Y: 7})
	rifleman.Ammo, rifleman.AmmoCapacity = 3, max(rifleman.AmmoCapacity, 3)
	deployRes := issueInternalCommand(core, "p1", model.Command{
		Type:    model.CmdDeploySquad,
		Payload: map[string]any{"member_ids": []string{rifleman.ID}, "name": "t116"},
	})
	if deployRes.Code != model.CodeOK {
		t.Fatalf("deploy squad failed: %s (%s)", deployRes.Code, deployRes.Message)
	}
	squadID := deployRes.Message

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdCommissionFleet,
		Payload: map[string]any{
			"building_id":  base.ID,
			"blueprint_id": "corvette",
			"count":        1,
			"system_id":    systemID,
			"fleet_id":     "fleet-t116",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("commission fleet failed: %s (%s)", res.Code, res.Message)
	}

	squad := ws.CombatRuntime.Squads[squadID]
	if squad == nil || len(squad.MemberIDs) != 1 || squad.MemberIDs[0] != rifleman.ID {
		t.Fatalf("expected deployed member squad, got %+v", ws.CombatRuntime)
	}

	playerSystem := core.SpaceRuntime().PlayerSystem("p1", systemID)
	if playerSystem == nil || playerSystem.Fleets["fleet-t116"] == nil {
		t.Fatalf("expected commissioned fleet, got %+v", playerSystem)
	}
	playerSystem.Fleets["fleet-t116"].Shield.Level -= 5

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceCreate,
		Payload: map[string]any{
			"task_force_id": "tf-t116",
			"name":          "Sustainment Alpha",
			"stance":        string(model.WarTaskForceStanceEscort),
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_create failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceAssign,
		Payload: map[string]any{
			"task_force_id": "tf-t116",
			"member_kind":   string(model.WarTaskForceMemberKindSquad),
			"member_ids":    []string{squadID},
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_assign squad failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTaskForceAssign,
		Payload: map[string]any{
			"task_force_id": "tf-t116",
			"member_kind":   string(model.WarTaskForceMemberKindFleet),
			"member_ids":    []string{"fleet-t116"},
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("task_force_assign fleet failed: %s (%s)", res.Code, res.Message)
	}

	core.processTick()
	if ws.Units[rifleman.ID] == nil {
		t.Fatal("squad member must survive the tick")
	}

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())

	industryBody := marshalAnyMap(t, ql.WarIndustry(ws, "p1"))
	supplyNodes, ok := industryBody["supply_nodes"].([]any)
	if !ok || len(supplyNodes) != 2 {
		t.Fatalf("expected one supply station and one supply truck node, got %+v", industryBody)
	}
	nodeTypes := map[string]bool{}
	for _, raw := range supplyNodes {
		node := raw.(map[string]any)
		nodeTypes[node["source_type"].(string)] = true
	}
	if len(nodeTypes) != 2 {
		t.Fatalf("hub / logistics nodes must not appear as supply nodes, got %+v", supplyNodes)
	}
	for _, want := range []string{"supply_station", "supply_truck"} {
		if !nodeTypes[want] {
			t.Fatalf("expected supply node type %s, got %+v", want, supplyNodes)
		}
	}

	taskForceBody := marshalAnyMap(t, ql.WarTaskForces(ws, "p1", core.worlds, core.spaceRuntime))
	taskForces, ok := taskForceBody["task_forces"].([]any)
	if !ok || len(taskForces) != 1 {
		t.Fatalf("expected one task force with sustainment data, got %+v", taskForceBody)
	}
	taskForce := taskForces[0].(map[string]any)
	if _, ok := taskForce["supply_status"].(map[string]any); !ok {
		t.Fatalf("expected task force supply_status, got %+v", taskForce)
	}

	planetView, ok := ql.PlanetRuntime(ws, "p1", ws.PlanetID, ws.PlanetID)
	planetBody := marshalAnyMap(t, mustValue(t, planetView, ok))
	squads, ok := planetBody["combat_squads"].([]any)
	if !ok || len(squads) != 1 {
		t.Fatalf("expected one combat squad in planet runtime, got %+v", planetBody)
	}
	squadBody := squads[0].(map[string]any)
	if members, ok := squadBody["member_ids"].([]any); !ok || len(members) != 1 || members[0] != rifleman.ID {
		t.Fatalf("expected squad container to expose member_ids only, got %+v", squadBody)
	}
	if sus, _ := squadBody["sustainment"].(map[string]any); len(sus["current"].(map[string]any)) != 0 {
		t.Fatalf("member squad must not carry a private supply pool, got %+v", sus)
	}

	fleetView, ok := ql.Fleet("p1", "fleet-t116", core.SpaceRuntime())
	fleetBody := marshalAnyMap(t, mustValue(t, fleetView, ok))
	if _, ok := fleetBody["sustainment"].(map[string]any); !ok {
		t.Fatalf("expected fleet sustainment query payload, got %+v", fleetBody)
	}
}

func TestT116SupplyShortageDegradesFleetAndForcesRetreat(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	systemID := core.Maps().PrimaryPlanet().SystemID
	grantTechs(ws, "p1", "corvette")

	base := newBuilding("hub-short-t116", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 6, Y: 6})
	base.Runtime.State = model.BuildingWorkRunning
	base.Runtime.Params.EnergyConsume = 0
	attachBuilding(ws, base)

	power := newBuilding("power-short-t116", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	power.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, power)
	// 命令期供电判定与 tick 结算同源：先结算一次发电，部署枢纽才有电。
	settlePowerGeneration(ws, currentPlanetEnvironment(core.maps, ws.PlanetID))

	ws.Players["p1"].EnsureWarIndustry().DeploymentHubs[base.ID] = &model.WarDeploymentHubState{
		BuildingID:    base.ID,
		Capacity:      8,
		ReadyPayloads: map[string]int{model.ItemCorvette: 1},
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdCommissionFleet,
		Payload: map[string]any{
			"building_id":  base.ID,
			"blueprint_id": "corvette",
			"count":        1,
			"system_id":    systemID,
			"fleet_id":     "fleet-short-t116",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("commission fleet failed: %s (%s)", res.Code, res.Message)
	}

	playerSystem := core.SpaceRuntime().PlayerSystem("p1", systemID)
	fleet := playerSystem.Fleets["fleet-short-t116"]
	if fleet == nil {
		t.Fatalf("expected fleet-short-t116, got %+v", playerSystem)
	}

	ws.EnemyForces = &model.EnemyForceState{
		SystemID: systemID,
		Forces: []model.EnemyForce{{
			ID:   "enemy-short-t116",
			Type: model.EnemyForceTypeBeacon,
			// 放在舰队锚点内，使“无伤害”来自补给撤退而不是索敌半径。
			Position:  model.Position{X: ws.MapWidth / 2, Y: ws.MapHeight / 2},
			Strength:  150,
			SpawnTick: ws.Tick,
		}},
	}
	fleet.State = model.FleetStateAttacking
	fleet.Target = &model.FleetTarget{PlanetID: ws.PlanetID, TargetID: "enemy-short-t116"}

	setUnitSustainmentCurrent(t, fleet, map[string]int{
		"Ammo":     0,
		"Shells":   0,
		"Missiles": 0,
	}, 0.4)

	initialEnemyStrength := ws.EnemyForces.Forces[0].Strength
	for i := 0; i < 4; i++ {
		core.processTick()
	}

	if fleet.State != model.FleetStateIdle {
		t.Fatalf("expected critically undersupplied fleet to retreat to idle, got %+v", fleet)
	}
	if ws.EnemyForces.Forces[0].Strength != initialEnemyStrength {
		t.Fatalf("expected no effective attack while fleet is out of sustainment, before=%d after=%d", initialEnemyStrength, ws.EnemyForces.Forces[0].Strength)
	}

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	fleetView, ok := ql.Fleet("p1", "fleet-short-t116", core.SpaceRuntime())
	fleetBody := marshalAnyMap(t, mustValue(t, fleetView, ok))
	sustainment, ok := fleetBody["sustainment"].(map[string]any)
	if !ok {
		t.Fatalf("expected fleet sustainment status, got %+v", fleetBody)
	}
	if sustainment["condition"] == nil {
		t.Fatalf("expected sustainment condition in fleet detail, got %+v", sustainment)
	}
	shortages, ok := sustainment["shortages"].([]any)
	if !ok || len(shortages) < 1 {
		t.Fatalf("expected staged shortage reasons in fleet detail, got %+v", sustainment)
	}
	if sustainment["retreat_recommended"] != true {
		t.Fatalf("expected retreat recommendation for critical sustainment collapse, got %+v", sustainment)
	}
}

func loadBuildingItems(t *testing.T, building *model.Building, items map[string]int) {
	t.Helper()
	for itemID, qty := range items {
		if _, _, err := building.Storage.Load(itemID, qty); err != nil {
			t.Fatalf("load %s into %s: %v", itemID, building.ID, err)
		}
	}
}

func marshalAnyMap(t *testing.T, value any) map[string]any {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal value: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("unmarshal value: %v", err)
	}
	return out
}

func mustValue[T any](t *testing.T, value T, ok bool) T {
	t.Helper()
	if !ok {
		t.Fatal("expected query result to exist")
	}
	return value
}

func setUnitSustainmentCurrent(t *testing.T, unit any, current map[string]int, cohesion float64) {
	t.Helper()
	value := reflect.ValueOf(unit)
	if value.Kind() != reflect.Ptr || value.IsNil() {
		t.Fatalf("unit must be a non-nil pointer, got %T", unit)
	}
	unitValue := value.Elem()
	sustainment := unitValue.FieldByName("Sustainment")
	if !sustainment.IsValid() {
		t.Fatalf("expected %T to expose Sustainment field for T116", unit)
	}
	currentField := sustainment.FieldByName("Current")
	if !currentField.IsValid() {
		t.Fatalf("expected Sustainment.Current field on %T", unit)
	}
	for fieldName, qty := range current {
		field := currentField.FieldByName(fieldName)
		if !field.IsValid() {
			t.Fatalf("expected sustainment current field %s on %T", fieldName, unit)
		}
		field.SetInt(int64(qty))
	}
	cohesionField := sustainment.FieldByName("Cohesion")
	if !cohesionField.IsValid() {
		t.Fatalf("expected Sustainment.Cohesion field on %T", unit)
	}
	cohesionField.SetFloat(cohesion)
}

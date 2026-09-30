package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestT113QueueMilitaryProductionSupportsPlayerBlueprintDeploymentAndLineRetool(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "prototype")

	factory := newBuilding("factory-t113", model.BuildingTypeRecomposingAssembler, "p1", model.Position{X: 6, Y: 6})
	factory.Runtime.State = model.BuildingWorkRunning
	factory.Runtime.Params.EnergyConsume = 0
	if factory.Runtime.Functions.Energy != nil {
		factory.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	attachBuilding(ws, factory)

	hub := newBuilding("hub-t113", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 7, Y: 6})
	hub.Runtime.State = model.BuildingWorkRunning
	hub.Runtime.Params.EnergyConsume = 0
	if hub.Runtime.Functions.Energy != nil {
		hub.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	attachBuilding(ws, hub)

	power := newBuilding("power-t113", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	power.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, power)

	player := ws.Players["p1"]
	player.Inventory = model.ItemInventory{
		model.ItemCircuitBoard:                 80,
		model.ItemProcessor:                    80,
		model.ItemTitaniumAlloy:                80,
		model.ItemQuantumChip:                  80,
		model.ItemDeuteriumFuelRod:             80,
		model.ItemFrameMaterial:                80,
		model.ItemMicrocrystalline:             80,
		model.ItemGraphene:                     80,
		model.ItemCarbonNanotube:               80,
		model.ItemEnergeticGraphite:            80,
		model.ItemCopperIngot:                  80,
		model.ItemIronIngot:                    80,
		model.ItemParticleContainer:            40,
		model.ItemPhotonCombiner:               40,
		model.ItemTitaniumCrystal:              40,
		model.ItemHydrogenFuelRod:              40,
		model.ItemAntimatterCapsule:            40,
		model.ItemAmmoMissile:                  40,
		model.ItemGravityMissile:               20,
		model.ItemAnnihilationConstraintSphere: 10,
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdBlueprintVariant,
		Payload: map[string]any{
			"parent_blueprint_id": "prototype",
			"blueprint_id":        "raider_mk1",
			"allowed_slot_ids":    []string{"utility"},
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("create variant raider_mk1 failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, "p1", model.Command{
		Type:    model.CmdBlueprintValidate,
		Payload: map[string]any{"blueprint_id": "raider_mk1"},
	}); res.Code != model.CodeOK {
		t.Fatalf("validate raider_mk1 failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdBlueprintFinalize,
		Payload: map[string]any{
			"blueprint_id": "raider_mk1",
			"target_state": "prototype",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("finalize raider_mk1 failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdBlueprintVariant,
		Payload: map[string]any{
			"parent_blueprint_id": "prototype",
			"blueprint_id":        "raider_support",
			"allowed_slot_ids":    []string{"utility"},
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("create variant raider_support failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, "p1", model.Command{
		Type:    model.CmdBlueprintValidate,
		Payload: map[string]any{"blueprint_id": "raider_support"},
	}); res.Code != model.CodeOK {
		t.Fatalf("validate raider_support failed: %s (%s)", res.Code, res.Message)
	}
	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdBlueprintFinalize,
		Payload: map[string]any{
			"blueprint_id": "raider_support",
			"target_state": "prototype",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("finalize raider_support failed: %s (%s)", res.Code, res.Message)
	}

	queueRes := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdQueueMilitaryProduction,
		Payload: map[string]any{
			"building_id":       factory.ID,
			"deployment_hub_id": hub.ID,
			"blueprint_id":      "raider_mk1",
			"count":             1,
		},
	})
	if queueRes.Code != model.CodeOK {
		t.Fatalf("queue_military_production raider_mk1 failed: %s (%s)", queueRes.Code, queueRes.Message)
	}

	for i := 0; i < 300; i++ {
		core.processTick()
	}

	industry := player.WarIndustry
	if industry == nil || industry.DeploymentHubs[hub.ID] == nil {
		t.Fatalf("expected deployment hub state after production, got %+v", industry)
	}
	if got := industry.DeploymentHubs[hub.ID].ReadyPayloads["raider_mk1"]; got != 1 {
		t.Fatalf("expected one ready payload for raider_mk1, got %+v", industry.DeploymentHubs[hub.ID])
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdDeploySquad,
		Payload: map[string]any{
			"building_id":  hub.ID,
			"blueprint_id": "raider_mk1",
			"count":        1,
			"planet_id":    ws.PlanetID,
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("deploy raider_mk1 failed: %s (%s)", res.Code, res.Message)
	}

	if ws.CombatRuntime == nil || len(ws.CombatRuntime.Squads) != 1 {
		t.Fatalf("expected one deployed squad, got %+v", ws.CombatRuntime)
	}

	var deployed *model.CombatSquad
	for _, squad := range ws.CombatRuntime.Squads {
		deployed = squad
	}
	if deployed == nil || deployed.BlueprintID != "raider_mk1" {
		t.Fatalf("expected deployed squad to keep player blueprint id, got %+v", deployed)
	}

	sameBlueprintRes := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdQueueMilitaryProduction,
		Payload: map[string]any{
			"building_id":       factory.ID,
			"deployment_hub_id": hub.ID,
			"blueprint_id":      "raider_mk1",
			"count":             1,
		},
	})
	if sameBlueprintRes.Code != model.CodeOK {
		t.Fatalf("queue_military_production same blueprint failed: %s (%s)", sameBlueprintRes.Code, sameBlueprintRes.Message)
	}
	sameOrder := player.WarIndustry.ProductionOrders["war-prod-2"]
	if sameOrder == nil || sameOrder.RepeatBonusPercent <= 0 {
		t.Fatalf("expected repeat bonus on second identical production order, got %+v", sameOrder)
	}

	switchOrderRes := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdQueueMilitaryProduction,
		Payload: map[string]any{
			"building_id":       factory.ID,
			"deployment_hub_id": hub.ID,
			"blueprint_id":      "raider_support",
			"count":             1,
		},
	})
	if switchOrderRes.Code != model.CodeOK {
		t.Fatalf("queue_military_production retool failed: %s (%s)", switchOrderRes.Code, switchOrderRes.Message)
	}
	switchOrder := player.WarIndustry.ProductionOrders["war-prod-3"]
	if switchOrder == nil || switchOrder.RetoolTicks <= 0 {
		t.Fatalf("expected retool cost after switching blueprint, got %+v", switchOrder)
	}
}

func TestT113RefitUnitReturnsFleetAsTargetBlueprint(t *testing.T) {
	// 地面部队没有蓝图血量池，改造只作用于舰队实体：拆出舰队，工期后以目标蓝图归队。
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "corvette")

	newRunning := func(id string, typ model.BuildingType, x int) *model.Building {
		b := newBuilding(id, typ, "p1", model.Position{X: x, Y: 6})
		b.Runtime.State = model.BuildingWorkRunning
		b.Runtime.Params.EnergyConsume = 0
		if b.Runtime.Functions.Energy != nil {
			b.Runtime.Functions.Energy.ConsumePerTick = 0
		}
		attachBuilding(ws, b)
		return b
	}
	factory := newRunning("factory-refit-t113", model.BuildingTypeRecomposingAssembler, 6)
	hub := newRunning("hub-refit-t113", model.BuildingTypeBattlefieldAnalysisBase, 7)
	power := newBuilding("power-refit-t113", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	power.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, power)

	player := ws.Players["p1"]
	player.Inventory = model.ItemInventory{
		model.ItemCircuitBoard:  80,
		model.ItemProcessor:     80,
		model.ItemTitaniumAlloy: 80,
		model.ItemFrameMaterial: 80,
	}
	must := func(cmd model.Command) {
		t.Helper()
		if res := issueInternalCommand(core, "p1", cmd); res.Code != model.CodeOK {
			t.Fatalf("%s failed: %s (%s)", cmd.Type, res.Code, res.Message)
		}
	}
	must(model.Command{Type: model.CmdBlueprintVariant, Payload: map[string]any{
		"parent_blueprint_id": "corvette", "blueprint_id": "corvette_mk2", "allowed_slot_ids": []string{"utility"},
	}})
	must(model.Command{Type: model.CmdBlueprintValidate, Payload: map[string]any{"blueprint_id": "corvette_mk2"}})
	must(model.Command{Type: model.CmdBlueprintFinalize, Payload: map[string]any{"blueprint_id": "corvette_mk2", "target_state": "prototype"}})

	player.EnsureWarIndustry().DeploymentHubs[hub.ID] = &model.WarDeploymentHubState{
		BuildingID:    hub.ID,
		Capacity:      8,
		ReadyPayloads: map[string]int{model.ItemCorvette: 1},
	}
	must(model.Command{Type: model.CmdCommissionFleet, Payload: map[string]any{
		"building_id": hub.ID, "blueprint_id": "corvette", "count": 1, "system_id": "sys-1", "fleet_id": "fleet-refit",
	}})
	system := core.spaceRuntime.PlayerSystem("p1", "sys-1")
	if system.Fleets["fleet-refit"] == nil {
		t.Fatal("expected commissioned fleet")
	}

	must(model.Command{Type: model.CmdRefitUnit, Payload: map[string]any{
		"building_id": factory.ID, "unit_id": "fleet-refit", "target_blueprint_id": "corvette_mk2",
	}})
	if system.Fleets["fleet-refit"] != nil {
		t.Fatal("expected fleet to leave runtime while refitting")
	}

	for i := 0; i < 300; i++ {
		core.processTick()
	}

	refitted := system.Fleets["fleet-refit"]
	if refitted == nil {
		t.Fatal("expected fleet to return after refit")
	}
	if len(refitted.Units) != 1 || refitted.Units[0].BlueprintID != "corvette_mk2" {
		t.Fatalf("expected refitted fleet to use target blueprint, got %+v", refitted.Units)
	}
	if player.WarIndustry == nil || len(player.WarIndustry.RefitOrders) == 0 {
		t.Fatalf("expected refit order history to remain queryable, got %+v", player.WarIndustry)
	}
}

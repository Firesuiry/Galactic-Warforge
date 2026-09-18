package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// migratedTechEffect pins one legacy per-level constant to its catalog effect.
type migratedTechEffect struct {
	techID     string
	effectType string
	perLevel   float64
}

var migratedTechEffects = []migratedTechEffect{
	{"mechanical_frame", "mecha_max_hp", 20},
	{"inventory_capacity", "mecha_inventory_capacity", 60},
	{"drive_engine", "move_speed", 2},
	{"energy_circuit", "mecha_charge_rate_pct", 20},
	{"distribution_range", "distribution_range", 5},
	{"logistics_carrier_capacity", "logistics_ship_capacity", 100},
	{"logistics_carrier_engine", "logistics_ship_speed", 1},
	{"sorter_cargo_stacking", "sorter_grab_stacks", 1},
	{"sorter_cargo_integration", "piler_pile_height", 2},
}

func techPlayer(levels map[string]int) *model.PlayerState {
	return &model.PlayerState{
		PlayerID: "p1",
		IsAlive:  true,
		Tech:     &model.PlayerTechState{PlayerID: "p1", CompletedTechs: levels},
	}
}

// TestTechEffectCatalogValuesMatchLegacyPerLevelFormulas is the equivalence
// gate for the Effects migration: for every migrated tech and every level
// (including beyond MaxLevel, which must clamp), TechEffectValue must produce
// exactly the value the legacy per-level constant formula produced.
func TestTechEffectCatalogValuesMatchLegacyPerLevelFormulas(t *testing.T) {
	for _, tc := range migratedTechEffects {
		def, ok := model.TechDefinitionByID(tc.techID)
		if !ok {
			t.Fatalf("tech %s missing from catalog", tc.techID)
		}
		found := false
		for _, eff := range def.Effects {
			if eff.Type == tc.effectType {
				found = true
				if eff.Value != tc.perLevel {
					t.Fatalf("%s effect %s value %v, want legacy per-level %v", tc.techID, tc.effectType, eff.Value, tc.perLevel)
				}
			}
		}
		if !found {
			t.Fatalf("%s lacks catalog effect %s", tc.techID, tc.effectType)
		}
		for level := 0; level <= def.MaxLevel+3; level++ {
			player := techPlayer(map[string]int{tc.techID: level})
			clamped := level
			if clamped > def.MaxLevel {
				clamped = def.MaxLevel
			}
			want := tc.perLevel * float64(clamped)
			if got := model.TechEffectValue(player, tc.effectType); got != want {
				t.Fatalf("%s L%d: TechEffectValue(%s)=%v, want %v", tc.techID, level, tc.effectType, got, want)
			}
		}
	}
}

// TestMigratedDerivationsMatchLegacyStats sweeps the end-to-end derived stats
// that used to read tech levels directly and asserts the legacy numbers.
func TestMigratedDerivationsMatchLegacyStats(t *testing.T) {
	executor := func() *model.Unit {
		u := model.UnitStats(model.UnitTypeExecutor)
		u.ID = "exec"
		u.Type = model.UnitTypeExecutor
		u.OwnerID = "p1"
		return &u
	}

	// mechanical_frame: MaxHP = 120 + 20*L
	def, _ := model.TechDefinitionByID("mechanical_frame")
	for level := 0; level <= def.MaxLevel; level++ {
		unit := executor()
		model.SyncMechaCapabilities(unit, techPlayer(map[string]int{"mechanical_frame": level}))
		if want := 120 + 20*level; unit.MaxHP != want {
			t.Fatalf("mechanical_frame L%d MaxHP=%d, want %d", level, unit.MaxHP, want)
		}
	}

	// inventory_capacity: capacity = 200 + 60*L
	def, _ = model.TechDefinitionByID("inventory_capacity")
	for level := 0; level <= def.MaxLevel; level++ {
		unit := executor()
		model.SyncMechaCapabilities(unit, techPlayer(map[string]int{"inventory_capacity": level}))
		if want := 200 + 60*level; unit.Mecha.InventoryCapacity != want {
			t.Fatalf("inventory_capacity L%d capacity=%d, want %d", level, unit.Mecha.InventoryCapacity, want)
		}
	}

	// drive_engine: move range = 12 + 2*L
	def, _ = model.TechDefinitionByID("drive_engine")
	for level := 0; level <= def.MaxLevel; level++ {
		unit := executor()
		model.SyncMechaCapabilities(unit, techPlayer(map[string]int{"drive_engine": level}))
		if want := 12 + 2*level; unit.MoveRange != want {
			t.Fatalf("drive_engine L%d move=%d, want %d", level, unit.MoveRange, want)
		}
	}

	// energy_circuit: charge rate = base * (100 + 20*L) / 100
	def, _ = model.TechDefinitionByID("energy_circuit")
	for level := 0; level <= def.MaxLevel; level++ {
		got := model.MechaChargeRate(10, techPlayer(map[string]int{"energy_circuit": level}))
		if want := 10 * (100 + 20*level) / 100; got != want {
			t.Fatalf("energy_circuit L%d charge rate=%d, want %d", level, got, want)
		}
	}

	// carrier techs: capacity = 200 + 100*L, speed = 2 + L
	capDef, _ := model.TechDefinitionByID("logistics_carrier_capacity")
	engDef, _ := model.TechDefinitionByID("logistics_carrier_engine")
	for capLevel := 0; capLevel <= capDef.MaxLevel; capLevel++ {
		for engLevel := 0; engLevel <= engDef.MaxLevel; engLevel++ {
			ship := model.NewLogisticsShipState("ship", "st", model.Position{})
			ship.RefreshTechStats(techPlayer(map[string]int{
				"logistics_carrier_capacity": capLevel,
				"logistics_carrier_engine":   engLevel,
			}))
			if want := 200 + 100*capLevel; ship.Capacity != want {
				t.Fatalf("carrier capacity L%d: %d, want %d", capLevel, ship.Capacity, want)
			}
			if want := 2 + engLevel; ship.Speed != want {
				t.Fatalf("carrier engine L%d: %d, want %d", engLevel, ship.Speed, want)
			}
		}
	}

	// distribution_range: effective range = base + 5*L
	def, _ = model.TechDefinitionByID("distribution_range")
	for level := 0; level <= def.MaxLevel; level++ {
		ws := model.NewWorldState("planet-range", 8)
		ws.Players["p1"] = techPlayer(map[string]int{"distribution_range": level})
		home := &model.Building{
			ID:       "home",
			OwnerID:  "p1",
			Position: model.Position{X: 1, Y: 1},
			Distributor: &model.DistributorState{
				Range: 12,
			},
		}
		if want := 12 + 5*level; distributorEffectiveRange(ws, home) != want {
			t.Fatalf("distribution_range L%d range=%d, want %d", level, distributorEffectiveRange(ws, home), want)
		}
	}

	// sorter_cargo_integration: pile height 2 -> 4
	ws := model.NewWorldState("planet-piler", 8)
	ws.Players["p1"] = techPlayer(nil)
	if got := pileHeightFor(ws, "p1"); got != 2 {
		t.Fatalf("unresearched pile height=%d, want 2", got)
	}
	ws.Players["p1"] = techPlayer(map[string]int{"sorter_cargo_integration": 1})
	if got := pileHeightFor(ws, "p1"); got != 4 {
		t.Fatalf("researched pile height=%d, want 4", got)
	}
}

func TestSyncMechaCapabilitiesWeaponDamageRaisesAttack(t *testing.T) {
	unit := model.UnitStats(model.UnitTypeExecutor)
	unit.ID = "exec"
	unit.Type = model.UnitTypeExecutor
	unit.OwnerID = "p1"

	model.SyncMechaCapabilities(&unit, techPlayer(nil))
	if unit.Attack != 20 || unit.Defense != 8 || unit.AttackRange != 4 {
		t.Fatalf("base combat stats wrong: attack=%d defense=%d range=%d", unit.Attack, unit.Defense, unit.AttackRange)
	}

	// df_kinetic_weapon_damage L2 -> +20% attack.
	model.SyncMechaCapabilities(&unit, techPlayer(map[string]int{"df_kinetic_weapon_damage": 2}))
	if unit.Attack != 24 {
		t.Fatalf("weapon_damage L2 attack=%d, want 24", unit.Attack)
	}

	// Two weapon trees stack additively through the shared effect type:
	// kinetic L2 (+0.2) + energy L1 (+0.1) -> 20 * 1.3 = 26.
	model.SyncMechaCapabilities(&unit, techPlayer(map[string]int{
		"df_kinetic_weapon_damage": 2,
		"df_energy_weapon_damage":  1,
	}))
	if unit.Attack != 26 {
		t.Fatalf("stacked weapon techs attack=%d, want 26", unit.Attack)
	}

	// Idempotent: re-sync never multiplies onto itself.
	model.SyncMechaCapabilities(&unit, techPlayer(map[string]int{
		"df_kinetic_weapon_damage": 2,
		"df_energy_weapon_damage":  1,
	}))
	if unit.Attack != 26 {
		t.Fatalf("re-sync accumulated attack: %d", unit.Attack)
	}
}

func TestSyncMechaCapabilitiesStructureHpScalesMaxHP(t *testing.T) {
	unit := model.UnitStats(model.UnitTypeExecutor)
	unit.ID = "exec"
	unit.Type = model.UnitTypeExecutor
	unit.OwnerID = "p1"
	unit.HP = 90 // damaged; sync must never heal

	// df_enhanced_structure L2 -> +20% max HP on the flat total.
	model.SyncMechaCapabilities(&unit, techPlayer(map[string]int{"df_enhanced_structure": 2}))
	if unit.MaxHP != 144 {
		t.Fatalf("structure_hp L2 MaxHP=%d, want 144", unit.MaxHP)
	}
	if unit.HP != 90 {
		t.Fatalf("sync must not heal, HP=%d", unit.HP)
	}

	// Multiplier applies on top of mechanical_frame's flat bonus:
	// (120 + 20*3) * 1.2 = 216.
	model.SyncMechaCapabilities(&unit, techPlayer(map[string]int{
		"df_enhanced_structure": 2,
		"mechanical_frame":      3,
	}))
	if unit.MaxHP != 216 {
		t.Fatalf("structure_hp + mechanical_frame MaxHP=%d, want 216", unit.MaxHP)
	}
}

// stackCascadeFixture builds a world with a three-layer vertical stack of
// matrix labs at one tile (base Z=0 plus Z=1/Z=2 layers).
func stackCascadeFixture(t *testing.T) (*model.WorldState, *model.PlayerState, *model.Building, *model.Building, *model.Building) {
	t.Helper()
	ws := model.NewWorldState("planet-cascade", 8)
	player := &model.PlayerState{
		PlayerID:  "p1",
		IsAlive:   true,
		Resources: model.Resources{Minerals: 0, Energy: 0},
		Inventory: model.ItemInventory{},
	}
	player.Executor = model.NewExecutorState("u-1", 1, 10, 2, 0)
	ws.Players["p1"] = player
	ws.Units["u-1"] = &model.Unit{
		ID:       "u-1",
		Type:     model.UnitTypeExecutor,
		OwnerID:  "p1",
		Position: model.Position{X: 1, Y: 1},
	}

	base := newBuilding("lab-base", model.BuildingTypeMatrixLab, "p1", model.Position{X: 3, Y: 3})
	placeBuilding(ws, base)
	layer1 := newBuilding("lab-z1", model.BuildingTypeMatrixLab, "p1", model.Position{X: 3, Y: 3, Z: 1})
	layer2 := newBuilding("lab-z2", model.BuildingTypeMatrixLab, "p1", model.Position{X: 3, Y: 3, Z: 2})
	// Stacked layers share the base tile registration; they only exist in
	// ws.Buildings (mirrors WorldState.IndexBuilding).
	ws.Buildings[layer1.ID] = layer1
	ws.Buildings[layer2.ID] = layer2
	return ws, player, base, layer1, layer2
}

func TestDemolishBaseCascadesStackedLayers(t *testing.T) {
	ws, player, base, layer1, layer2 := stackCascadeFixture(t)
	gc := &GameCore{executorUsage: make(map[string]int)}

	res, events := gc.execDemolish(ws, "p1", model.Command{
		Type:   model.CmdDemolish,
		Target: model.CommandTarget{EntityID: base.ID},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("demolish base failed: %s (%s)", res.Code, res.Message)
	}

	for _, id := range []string{base.ID, layer1.ID, layer2.ID} {
		if _, ok := ws.Buildings[id]; ok {
			t.Fatalf("building %s survived cascade demolish", id)
		}
	}
	if key := model.TileKey(base.Position.X, base.Position.Y); ws.TileBuilding[key] != "" {
		t.Fatalf("ground tile still registered to %s", ws.TileBuilding[key])
	}

	// Each layer refunds at the same 50% rule as the base.
	perLayer := model.BuildingDemolishRefundWithRate(model.BuildingTypeMatrixLab, 1, 0.5)
	if want := 3 * perLayer.Minerals; player.Resources.Minerals != want {
		t.Fatalf("cascade refund minerals=%d, want %d", player.Resources.Minerals, want)
	}
	if want := 3 * perLayer.Energy; player.Resources.Energy != want {
		t.Fatalf("cascade refund energy=%d, want %d", player.Resources.Energy, want)
	}

	destroyed := map[string]bool{}
	for _, evt := range events {
		if evt.EventType != model.EvtEntityDestroyed {
			continue
		}
		if id, ok := evt.Payload["entity_id"].(string); ok {
			destroyed[id] = true
		}
	}
	for _, id := range []string{base.ID, layer1.ID, layer2.ID} {
		if !destroyed[id] {
			t.Fatalf("no destroy event for cascaded building %s", id)
		}
	}
}

func TestDemolishJobCompletionCascadesStackedLayers(t *testing.T) {
	restore := overrideBuildingRule(t, model.BuildingTypeMatrixLab, func(def *model.BuildingDefinition) {
		def.Demolish = model.BuildingDemolishRule{Allow: true, RefundRate: 0.5, DurationTicks: 1}
	})
	defer restore()

	ws, player, base, layer1, layer2 := stackCascadeFixture(t)
	gc := &GameCore{executorUsage: make(map[string]int)}

	res, _ := gc.execDemolish(ws, "p1", model.Command{
		Type:   model.CmdDemolish,
		Target: model.CommandTarget{EntityID: base.ID},
	})
	if res.Code != model.CodeOK || base.Job == nil || base.Job.Type != model.BuildingJobDemolish {
		t.Fatalf("demolish job not started: %+v job=%+v", res, base.Job)
	}
	if player.Resources.Minerals != 0 {
		t.Fatal("refund must wait for job completion")
	}

	settleBuildingJobs(ws)
	for _, id := range []string{base.ID, layer1.ID, layer2.ID} {
		if _, ok := ws.Buildings[id]; ok {
			t.Fatalf("building %s survived job-path cascade demolish", id)
		}
	}
	perLayer := model.BuildingDemolishRefundWithRate(model.BuildingTypeMatrixLab, 1, 0.5)
	if want := 3 * perLayer.Minerals; player.Resources.Minerals != want {
		t.Fatalf("job-path cascade refund=%d, want %d", player.Resources.Minerals, want)
	}
}

func TestDemolishMiddleLayerCascadesUpwardOnly(t *testing.T) {
	ws, player, base, layer1, layer2 := stackCascadeFixture(t)
	gc := &GameCore{executorUsage: make(map[string]int)}

	res, _ := gc.execDemolish(ws, "p1", model.Command{
		Type:   model.CmdDemolish,
		Target: model.CommandTarget{EntityID: layer1.ID},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("demolish middle layer failed: %s (%s)", res.Code, res.Message)
	}

	if _, ok := ws.Buildings[base.ID]; !ok {
		t.Fatal("base must survive demolishing an upper layer")
	}
	if key := model.TileKey(base.Position.X, base.Position.Y); ws.TileBuilding[key] != base.ID {
		t.Fatalf("ground tile registration lost: %s", ws.TileBuilding[key])
	}
	for _, id := range []string{layer1.ID, layer2.ID} {
		if _, ok := ws.Buildings[id]; ok {
			t.Fatalf("layer %s must cascade down with the middle layer", id)
		}
	}
	perLayer := model.BuildingDemolishRefundWithRate(model.BuildingTypeMatrixLab, 1, 0.5)
	if want := 2 * perLayer.Minerals; player.Resources.Minerals != want {
		t.Fatalf("middle-layer cascade refund=%d, want %d", player.Resources.Minerals, want)
	}
}

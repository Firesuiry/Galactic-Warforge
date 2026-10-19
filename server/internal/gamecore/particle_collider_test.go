package gamecore

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"siliconworld/internal/gamedir"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

func colliderForTest(ws *model.WorldState, recipe string) *model.Building {
	b := newBuilding("collider", model.BuildingTypeMiniatureParticleCollider, "p1", model.Position{X: 3, Y: 3})
	b.Production.RecipeID = recipe
	b.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, b)
	return b
}

// itemAmountIDs 把配方的产出清单转成分拣器过滤用 ID 列表。
func itemAmountIDs(amounts []model.ItemAmount) []string {
	out := make([]string, 0, len(amounts))
	for _, amount := range amounts {
		if amount.ItemID != "" {
			out = append(out, amount.ItemID)
		}
	}
	return out
}

func TestParticleColliderRecipesThroughBelts(t *testing.T) {
	for _, tc := range []struct {
		recipe          string
		duration        int
		inputs, outputs model.ItemInventory
	}{
		{"deuterium_collision", 300, model.ItemInventory{model.ItemHydrogen: 10}, model.ItemInventory{model.ItemDeuterium: 5}},
		{"strange_matter", 480, model.ItemInventory{model.ItemParticleContainer: 2, model.ItemDeuterium: 10, model.ItemIronIngot: 2}, model.ItemInventory{model.ItemStrangeMatter: 1}},
		{"antimatter", 120, model.ItemInventory{model.ItemCriticalPhoton: 2}, model.ItemInventory{model.ItemAntimatter: 2, model.ItemHydrogen: 2}},
	} {
		t.Run(tc.recipe, func(t *testing.T) {
			ws := model.NewWorldState("planet", 12)
			b := colliderForTest(ws, tc.recipe)
			supplyProductionFixture(t, ws, b)
			recipe, ok := model.Recipe(tc.recipe)
			if !ok {
				t.Fatalf("recipe %s missing", tc.recipe)
			}
			// 细分网格：对撞机 5×5（x3..7,y3..7）。第 16 轮契约 §3 起对撞机不再与
			// 皮带直连，三条带子都各自配一台分拣器：
			//   进料 (1,5) 带 → 分拣器 (2,5)（背西面东）→ 占地 (3,5)；
			//   主产物 分拣器 (8,5)（背西面东）→ 带 (9,5)；
			//   副产物 分拣器 (5,8)（背北面南）→ 带 (5,9)。
			// 两台出货分拣器必须带过滤：不区分端口，靠过滤把主产物与副产物分开。
			input := newConveyorBuilding("input", model.Position{X: 1, Y: 5}, model.ConveyorEast)
			feeder := newSorterBuilding("feeder", model.Position{X: 2, Y: 5})
			feeder.Sorter.CycleTicks = 1
			output := newConveyorBuilding("output", model.Position{X: 9, Y: 5}, model.ConveyorEast)
			mainSorter := newSorterBuilding("main-sorter", model.Position{X: 8, Y: 5})
			mainSorter.Sorter.CycleTicks = 1
			mainSorter.Sorter.Filter = model.SorterFilter{Mode: model.SorterFilterAllow, Items: itemAmountIDs(recipe.Outputs)}
			side := newConveyorBuilding("side", model.Position{X: 5, Y: 9}, model.ConveyorSouth)
			sideSorter := newSorterBuilding("side-sorter", model.Position{X: 5, Y: 8})
			sideSorter.Rotation = model.PlanRotation180 // 背面北（对撞机）、正面南（带子）
			sideSorter.Sorter.CycleTicks = 1
			sideSorter.Sorter.Filter = model.SorterFilter{Mode: model.SorterFilterAllow, Items: itemAmountIDs(recipe.Byproducts)}
			buildings := []*model.Building{input, feeder, output, mainSorter}
			if len(recipe.Byproducts) > 0 {
				buildings = append(buildings, side, sideSorter)
			}
			for _, belt := range buildings {
				attachBuilding(ws, belt)
			}
			for item, quantity := range tc.inputs {
				for quantity > 0 {
					accepted, remaining, err := input.Conveyor.Insert(item, quantity)
					if err != nil || accepted == 0 {
						t.Fatalf("feed %s: accepted=%d err=%v", item, accepted, err)
					}
					quantity = remaining
					for drain := 0; drain < 60 && input.Conveyor.TotalItems() > 0; drain++ {
						ws.Tick++
						settleSorters(ws)
						settleStorage(ws)
					}
				}
			}
			settleProduction(ws)
			if b.Production.RemainingTicks != tc.duration {
				t.Fatalf("duration=%d want %d", b.Production.RemainingTicks, tc.duration)
			}
			for item := range tc.inputs {
				if availableStorageItem(b.Storage, item) != 0 {
					t.Fatalf("unconsumed input %s: %+v", item, b.Storage)
				}
			}
			for i := 0; i < tc.duration+10; i++ {
				ws.Tick++
				settleProduction(ws)
				settleStorage(ws)
				settleSorters(ws)
			}
			got := model.ItemInventory{}
			for _, belt := range []*model.Building{output, side} {
				for _, stack := range belt.Conveyor.Buffer {
					got[stack.ItemID] += stack.Quantity
				}
			}
			if !reflect.DeepEqual(got, tc.outputs) {
				t.Fatalf("belt output=%v want=%v; storage=%+v", got, tc.outputs, b.Storage)
			}
			if totalStorageItems(b.Storage) != 0 || len(b.Production.PendingOutputs) != 0 || len(b.Production.PendingByproducts) != 0 {
				t.Fatalf("unexpected leftover batch: %+v %+v", b.Storage, b.Production)
			}
		})
	}
}

func TestParticleColliderPowerGridStopsAndResumesBatch(t *testing.T) {
	ws := newPowerTestWorld()
	// A real power node connects to the collider; supply is controlled at the
	// generation/settlement boundary to exercise under-power and recovery.
	b := colliderForTest(ws, "deuterium_collision")
	generator := addPowerTestBuilding(ws, "generator", model.BuildingTypeWindTurbine, model.Position{X: 2, Y: 3})
	b.Storage.EnsureInventory()[model.ItemHydrogen] = 10
	if got := model.PowerDemandForBuilding(b); got != 24 {
		t.Fatalf("power demand=%d want24", got)
	}
	ws.PowerGrid = model.BuildPowerGridGraph(ws)
	settleResources(ws)
	settleProduction(ws)
	if b.Runtime.State != model.BuildingWorkNoPower || b.Storage.Inventory[model.ItemHydrogen] != 10 || b.Production.RemainingTicks != 0 {
		t.Fatalf("unpowered start consumed inputs: %+v %+v", b.Runtime, b.Production)
	}
	ws.PowerInputs = []model.PowerInput{{BuildingID: generator.ID, OwnerID: "p1", Output: 24}}
	ws.PowerGrid = model.BuildPowerGridGraph(ws)
	settleResources(ws)
	settleProduction(ws)
	if b.Runtime.State != model.BuildingWorkRunning || b.Production.RemainingTicks != 300 {
		t.Fatalf("no powered start: %+v %+v", b.Runtime, b.Production)
	}
	ws.PowerInputs = nil
	ws.PowerGrid = model.BuildPowerGridGraph(ws)
	settleResources(ws)
	for i := 0; i < 10; i++ {
		settleProduction(ws)
	}
	if b.Runtime.State != model.BuildingWorkNoPower || b.Production.RemainingTicks != 300 {
		t.Fatal("power loss advanced batch")
	}
	ws.PowerInputs = []model.PowerInput{{BuildingID: generator.ID, OwnerID: "p1", Output: 24}}
	ws.PowerGrid = model.BuildPowerGridGraph(ws)
	settleResources(ws)
	settleProduction(ws)
	if b.Production.RemainingTicks != 299 {
		t.Fatal("power restored did not resume batch")
	}
}

func TestParticleColliderFullOutputIsAtomicAndSurvivesSave(t *testing.T) {
	core := newSaveStateHarness(t)
	ws := core.World()
	b := colliderForTest(ws, "antimatter")
	supplyProductionFixture(t, ws, b)
	b.Storage.EnsureInventory()[model.ItemCriticalPhoton] = 4
	settleProduction(ws)
	// Leave room for neither product: 主输出的落点是输出缓冲 → 产出预留段，
	// 把两处都占满（预留段用真正的成品占住，避免被 collectRecipeInputs 当成原料）。
	// The whole batch must remain pending; repeated attempts cannot duplicate it.
	fillProductLandingSpots(b.Storage, model.ItemAntimatter)
	for i := 0; i < 125; i++ {
		settleProduction(ws)
	}
	if len(b.Production.PendingOutputs) != 1 || len(b.Production.PendingByproducts) != 1 || b.Production.RemainingTicks != 0 {
		t.Fatalf("blocked batch lost: %+v", b.Production)
	}
	// 不变量：没有凭空多出成品——输出缓冲/预留段里只有测试自己塞进去的那批。
	if got := b.Storage.UsedOutputBuffer(); got != b.Storage.OutputBufferCapacity() {
		t.Fatalf("blocked batch leaked into the output buffer: %d/%d %+v", got, b.Storage.OutputBufferCapacity(), b.Storage)
	}
	if got := b.Storage.Inventory[model.ItemAntimatter]; got != b.Storage.Reserve {
		t.Fatalf("blocked batch leaked into the reserve: %d, reserve %d %+v", got, b.Storage.Reserve, b.Storage)
	}
	if availableStorageItem(b.Storage, model.ItemCriticalPhoton) != 2 {
		t.Fatalf("blocked batch consumed future inputs: %+v", b.Storage)
	}
	save, err := core.ExportSaveFile("collider-blocked")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(save)
	if err != nil {
		t.Fatal(err)
	}
	var decoded gamedir.SaveFile
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	restored, err := NewFromSave(core.cfg, core.maps, queue.New(), NewEventBus(), nil, &decoded)
	if err != nil {
		t.Fatal(err)
	}
	resumed := restored.World().Buildings[b.ID]
	if resumed == nil || !reflect.DeepEqual(resumed.Production, b.Production) || !reflect.DeepEqual(resumed.Storage, b.Storage) {
		t.Fatal("save/load changed pending batch or storage")
	}
	drainProductLandingSpots(resumed.Storage, model.ItemAntimatter)
	resumed.Runtime.State = model.BuildingWorkRunning
	supplyProductionFixture(t, restored.World(), resumed)
	settleProduction(restored.World())
	settleStorage(restored.World())
	if resumed.ExportableItemQuantity(model.ItemAntimatter) != 2 || resumed.ExportableItemQuantity(model.ItemHydrogen) != 2 || availableStorageItem(resumed.Storage, model.ItemCriticalPhoton) != 2 {
		t.Fatalf("restored batch release not conserved: %+v", resumed.Storage)
	}
	if len(resumed.Production.PendingOutputs) != 0 || len(resumed.Production.PendingByproducts) != 0 {
		t.Fatal("batch still pending after release")
	}
}

func TestParticleColliderBuildResearchGates(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantAllItems(ws, "p1", 100)
	pos, err := findOpenTile(ws, 2)
	if err != nil || pos == nil {
		t.Fatalf("find build tile: %v", err)
	}
	build := func(recipe string) model.CommandResult {
		result, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{Type: model.CmdBuild, Target: model.CommandTarget{Position: pos}, Payload: map[string]any{"building_type": string(model.BuildingTypeMiniatureParticleCollider), "recipe_id": recipe}})
		return result
	}
	if result := build("deuterium_collision"); result.Code != model.CodeValidationFailed || !strings.Contains(result.Message, "研究") {
		t.Fatalf("locked collider accepted: %+v", result)
	}
	grantTechs(ws, "p1", "miniature_collider")
	for _, recipe := range []string{"antimatter", "strange_matter"} {
		if result := build(recipe); result.Code != model.CodeValidationFailed || !strings.Contains(result.Message, "研究") {
			t.Fatalf("locked recipe %s accepted: %+v", recipe, result)
		}
	}
	if result := build("deuterium_collision"); result.Code != model.CodeOK {
		t.Fatalf("unlocked collider rejected: %+v", result)
	}
	for i := 0; i < 10; i++ {
		ws.Tick++
		core.settleConstructionQueue(ws)
	}
	building := ws.Buildings[ws.TileBuilding[model.TileKey(pos.X, pos.Y)]]
	if building == nil || building.Storage == nil || building.Production == nil || building.Production.RecipeID != "deuterium_collision" {
		t.Fatalf("constructed collider lacks runtime: %+v", building)
	}
	grantTechs(ws, "p1", "strange_matter", "dirac_inversion")
	if !CanUseRecipeTech(ws.Players["p1"], "strange_matter") || !CanUseRecipeTech(ws.Players["p1"], "antimatter") {
		t.Fatal("later recipes not unlocked by correct research")
	}
}

func TestParticleColliderConstructedLineImportsAndExports(t *testing.T) {
	core := newConstructionTestCore(t, 4)
	ws := core.World()
	// 细分网格：粒子对撞机占地 5×5，IO 是占地外圈的一圈 cell。第 16 轮契约 §3
	// 起对撞机不与皮带直连，三台分拣器接上：进料（背西面东）、主产物（背西面东）、
	// 副产物（背北面南）。
	colliderFP := model.Footprint{Width: 5, Height: 5}
	var center *model.Position
	for y := 8; y < ws.MapHeight-8 && center == nil; y++ {
		for x := 8; x < ws.MapWidth-8; x++ {
			origin := model.Position{X: x, Y: y}
			if !ws.FootprintFits(origin, colliderFP, model.BuildingTypeMiniatureParticleCollider, "") {
				continue
			}
			free := true
			for _, p := range []model.Position{
				{X: x - 2, Y: y + 2}, {X: x - 1, Y: y + 2},
				{X: x + 5, Y: y + 2}, {X: x + 6, Y: y + 2},
				{X: x + 2, Y: y + 5}, {X: x + 2, Y: y + 6},
			} {
				if ws.TileBuilding[model.TileKey(p.X, p.Y)] != "" {
					free = false
					break
				}
			}
			if !free {
				continue
			}
			center = &origin
			break
		}
	}
	if center == nil {
		t.Fatal("no buildable collider site with belt ring cells")
	}
	inPos := model.Position{X: center.X - 2, Y: center.Y + 2}
	feedPos := model.Position{X: center.X - 1, Y: center.Y + 2}
	outPos := model.Position{X: center.X + 6, Y: center.Y + 2}
	drainPos := model.Position{X: center.X + 5, Y: center.Y + 2}
	sidePos := model.Position{X: center.X + 2, Y: center.Y + 6}
	sideDrainPos := model.Position{X: center.X + 2, Y: center.Y + 5}
	recipe, ok := model.Recipe("antimatter")
	if !ok {
		t.Fatal("antimatter recipe missing")
	}
	for _, entry := range []struct {
		pos      model.Position
		kind     model.BuildingType
		recipe   string
		rotation int
		filter   []string
	}{
		{pos: inPos, kind: model.BuildingTypeConveyorBeltMk1, rotation: -1},
		{pos: feedPos, kind: model.BuildingTypeSorterMk1, rotation: 90},
		{pos: *center, kind: model.BuildingTypeMiniatureParticleCollider, recipe: "antimatter", rotation: -1},
		{pos: drainPos, kind: model.BuildingTypeSorterMk1, rotation: 90, filter: itemAmountIDs(recipe.Outputs)},
		{pos: outPos, kind: model.BuildingTypeConveyorBeltMk1, rotation: -1},
		{pos: sideDrainPos, kind: model.BuildingTypeSorterMk1, rotation: 180, filter: itemAmountIDs(recipe.Byproducts)},
		{pos: sidePos, kind: model.BuildingTypeConveyorBeltMk1, rotation: -1},
	} {
		pos := entry.pos
		payload := map[string]any{"building_type": string(entry.kind), "recipe_id": entry.recipe, "direction": "east"}
		if entry.rotation >= 0 {
			payload["rotation"] = entry.rotation
		}
		if len(entry.filter) > 0 {
			payload["filter_items"] = entry.filter
		}
		result, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{Type: model.CmdBuild, Target: model.CommandTarget{Position: &pos}, Payload: payload})
		if result.Code != model.CodeOK {
			t.Fatalf("build %s at %+v: %+v", entry.kind, pos, result)
		}
	}
	for i := 0; i < 15; i++ {
		ws.Tick++
		core.settleConstructionQueue(ws)
	}
	input := ws.Buildings[ws.TileBuilding[model.TileKey(inPos.X, inPos.Y)]]
	collider := ws.Buildings[ws.TileBuilding[model.TileKey(center.X, center.Y)]]
	output := ws.Buildings[ws.TileBuilding[model.TileKey(outPos.X, outPos.Y)]]
	side := ws.Buildings[ws.TileBuilding[model.TileKey(sidePos.X, sidePos.Y)]]
	if input == nil || collider == nil || output == nil || side == nil {
		t.Fatal("line construction failed")
	}
	supplyProductionFixture(t, ws, collider)
	if accepted, _, err := input.Conveyor.Insert(model.ItemCriticalPhoton, 2); err != nil || accepted != 2 {
		t.Fatalf("feed photons: %d %v", accepted, err)
	}
	got := model.ItemInventory{}
	for i := 0; i < 135; i++ {
		ws.Tick++
		settleSorters(ws)
		settleProduction(ws)
		settleStorage(ws)
		for _, belt := range []*model.Building{output, side} {
			for _, stack := range belt.Conveyor.Buffer {
				got[stack.ItemID] += stack.Quantity
			}
			belt.Conveyor.Take(belt.Conveyor.TotalItems())
		}
	}
	if got[model.ItemAntimatter] != 2 || got[model.ItemHydrogen] != 2 || len(got) != 2 || input.Conveyor.TotalItems() != 0 || totalStorageItems(collider.Storage) != 0 {
		t.Fatalf("constructed line not conserved: input=%+v collider=%+v output=%+v", input.Conveyor, collider.Storage, got)
	}
}

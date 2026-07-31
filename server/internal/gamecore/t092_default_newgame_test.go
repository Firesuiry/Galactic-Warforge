package gamecore

import (
	"fmt"
	"testing"

	"siliconworld/internal/model"
)

func findOwnedBuildingByType(ws *model.WorldState, ownerID string, btype model.BuildingType) *model.Building {
	if ws == nil {
		return nil
	}
	for _, building := range ws.Buildings {
		if building == nil {
			continue
		}
		if building.OwnerID == ownerID && building.Type == btype {
			return building
		}
	}
	return nil
}

func waitForCompletedResearch(t *testing.T, core *GameCore, playerID, techID string) {
	t.Helper()

	for i := 0; i < 64; i++ {
		core.processTick()
		player := core.World().Players[playerID]
		if player != nil && player.Tech != nil && player.Tech.CompletedTechs[techID] > 0 {
			return
		}
	}

	player := core.World().Players[playerID]
	t.Fatalf("research %s did not complete, player tech state: %+v", techID, player.Tech)
}

// t092PlaceProducer places a running production building with a recipe and
// primes its inputs, mimicking a belt-fed factory segment.
func t092PlaceProducer(t *testing.T, ws *model.WorldState, id string, btype model.BuildingType, recipeID string, pos model.Position, inputs ...model.ItemAmount) *model.Building {
	t.Helper()

	building := newBuilding(id, btype, "p1", pos)
	building.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, building)
	building.Production.RecipeID = recipeID
	for _, input := range inputs {
		accepted, remaining, err := building.Storage.Receive(input.ItemID, input.Quantity)
		if err != nil || remaining != 0 {
			t.Fatalf("prime %s with %d %s failed: accepted=%d remaining=%d err=%v", id, input.Quantity, input.ItemID, accepted, remaining, err)
		}
	}
	return building
}

// t092ProduceUntil settles production until the building holds qty of item.
func t092ProduceUntil(t *testing.T, ws *model.WorldState, building *model.Building, itemID string, qty int) {
	t.Helper()

	for i := 0; i < 2000; i++ {
		settleProduction(ws)
		settleStorage(ws)
		if building.Storage.OutputQuantity(itemID) >= qty {
			return
		}
	}
	t.Fatalf("%s did not produce %d %s, storage: %+v", building.ID, qty, itemID, building.Storage)
}

// t092MoveItems simulates sorter transport between two buildings.
func t092MoveItems(t *testing.T, from, to *model.Building, itemID string, qty int) {
	t.Helper()

	provided, _, err := from.Storage.Provide(itemID, qty)
	if err != nil || provided != qty {
		t.Fatalf("provide %d %s from %s failed: provided=%d err=%v", qty, itemID, from.ID, provided, err)
	}
	accepted, remaining, err := to.Storage.Receive(itemID, provided)
	if err != nil || remaining != 0 {
		t.Fatalf("receive %d %s into %s failed: accepted=%d remaining=%d err=%v", provided, itemID, to.ID, accepted, remaining, err)
	}
}

// TestT092FreshNewGameCanReachEarlyResearchClosure pins the DSP-style
// opening chain: a fresh player can build the full basic industry from the
// initial tech, produce electromagnetic matrices through
// mine -> smelt -> assemble, and only then complete the first research.
func TestT092FreshNewGameCanReachEarlyResearchClosure(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	player := ws.Players["p1"]
	if player == nil {
		t.Fatal("expected player p1")
	}

	// Fresh players start with no matrices; the first research must come
	// from the industry chain.
	if got := player.Inventory[model.ItemElectromagneticMatrix]; got != 0 {
		t.Fatalf("expected fresh inventory without matrices, got %d", got)
	}

	for _, btype := range []model.BuildingType{
		model.BuildingTypeMatrixLab,
		model.BuildingTypeWindTurbine,
		model.BuildingTypeMiningMachine,
		model.BuildingTypeArcSmelter,
		model.BuildingTypeTeslaTower,
		model.BuildingTypeConveyorBeltMk1,
		model.BuildingTypeSorterMk1,
		model.BuildingTypeAssemblingMachineMk1,
	} {
		if !CanBuildTech(player, model.TechUnlockBuilding, string(btype)) {
			t.Fatalf("expected fresh new game to allow building %s from initial tech", btype)
		}
	}
	for _, btype := range []model.BuildingType{
		model.BuildingTypeDepotMk1,
		model.BuildingTypeSplitter,
		model.BuildingTypeSorterMk2,
		model.BuildingTypeTrafficMonitor,
	} {
		if CanBuildTech(player, model.TechUnlockBuilding, string(btype)) {
			t.Fatalf("expected %s to stay locked before research", btype)
		}
	}
	for _, recipeID := range []string{"smelt_magnet", "magnetic_coil", "circuit_board", "electromagnetic_matrix"} {
		if !CanUseRecipeTech(player, recipeID) {
			t.Fatalf("expected chain recipe %s to be usable without research", recipeID)
		}
	}
	if CanUseRecipeTech(player, "smelt_stone") {
		t.Fatal("expected smelt_stone to stay locked behind automatic_metallurgy")
	}

	// Removed techs must no longer be researchable.
	for _, techID := range []string{"electromagnetic_matrix", "improved_logistics"} {
		res, _ := core.execStartResearch(ws, "p1", model.Command{
			Type:    model.CmdStartResearch,
			Payload: map[string]any{"tech_id": techID},
		})
		if res.Code == model.CodeOK {
			t.Fatalf("expected removed tech %s to be unresearchable", techID)
		}
	}

	// Starter base: wind power + first matrix lab in research mode.
	base := findOwnedBuildingByType(ws, "p1", model.BuildingTypeBattlefieldAnalysisBase)
	if base == nil {
		t.Fatal("expected p1 base building")
	}
	windPos, err := findAdjacentOpenTile(ws, base.Position)
	if err != nil || windPos == nil {
		t.Fatalf("find adjacent wind tile: %v", err)
	}
	buildWindRes, _ := core.execBuild(ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: windPos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeWindTurbine),
		},
	})
	if buildWindRes.Code != model.CodeOK {
		t.Fatalf("build first wind turbine: %s (%s)", buildWindRes.Code, buildWindRes.Message)
	}
	for i := 0; i < 8; i++ {
		core.processTick()
	}

	labPos, err := findAdjacentOpenTile(ws, base.Position)
	if err != nil || labPos == nil {
		t.Fatalf("find adjacent lab tile: %v", err)
	}
	buildRes, _ := core.execBuild(ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: labPos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeMatrixLab),
		},
	})
	if buildRes.Code != model.CodeOK {
		t.Fatalf("build first matrix lab: %s (%s)", buildRes.Code, buildRes.Message)
	}
	for i := 0; i < 8; i++ {
		core.processTick()
	}

	lab := findOwnedBuildingByType(ws, "p1", model.BuildingTypeMatrixLab)
	if lab == nil {
		t.Fatal("expected matrix_lab to be constructed")
	}
	if lab.Runtime.State != model.BuildingWorkRunning {
		t.Fatalf("expected first matrix_lab to run after starter wind power is online, got %s", lab.Runtime.State)
	}
	if lab.Production == nil || lab.Production.RecipeID != "" {
		t.Fatalf("expected first matrix_lab to stay in research mode, got %+v", lab.Production)
	}

	// Industry chain for 10 matrices:
	//   20 iron ore -> 10 magnet + 10 iron ingot, 15 copper ore -> 15 copper ingot
	//   10 magnet + 5 copper ingot -> 10 magnetic coil
	//   10 iron ingot + 10 copper ingot -> 10 circuit board
	//   10 coil + 10 board -> 10 electromagnetic matrix
	magnetSmelter := t092PlaceProducer(t, ws, "smelter-magnet", model.BuildingTypeArcSmelter, "smelt_magnet", model.Position{X: 10, Y: 10}, model.ItemAmount{ItemID: model.ItemIronOre, Quantity: 10})
	ironSmelter := t092PlaceProducer(t, ws, "smelter-iron", model.BuildingTypeArcSmelter, "smelt_iron", model.Position{X: 12, Y: 10}, model.ItemAmount{ItemID: model.ItemIronOre, Quantity: 10})
	copperSmelter := t092PlaceProducer(t, ws, "smelter-copper", model.BuildingTypeArcSmelter, "smelt_copper", model.Position{X: 14, Y: 10}, model.ItemAmount{ItemID: model.ItemCopperOre, Quantity: 15})

	t092ProduceUntil(t, ws, magnetSmelter, model.ItemMagnet, 10)
	t092ProduceUntil(t, ws, ironSmelter, model.ItemIronIngot, 10)
	t092ProduceUntil(t, ws, copperSmelter, model.ItemCopperIngot, 15)

	coilAssembler := t092PlaceProducer(t, ws, "assembler-coil", model.BuildingTypeAssemblingMachineMk1, "magnetic_coil", model.Position{X: 10, Y: 12})
	t092MoveItems(t, magnetSmelter, coilAssembler, model.ItemMagnet, 10)
	t092MoveItems(t, copperSmelter, coilAssembler, model.ItemCopperIngot, 5)
	t092ProduceUntil(t, ws, coilAssembler, model.ItemMagneticCoil, 10)

	boardAssembler := t092PlaceProducer(t, ws, "assembler-board", model.BuildingTypeAssemblingMachineMk1, "circuit_board", model.Position{X: 12, Y: 12})
	t092MoveItems(t, ironSmelter, boardAssembler, model.ItemIronIngot, 10)
	t092MoveItems(t, copperSmelter, boardAssembler, model.ItemCopperIngot, 10)
	t092ProduceUntil(t, ws, boardAssembler, model.ItemCircuitBoard, 10)

	matrixAssembler := t092PlaceProducer(t, ws, "assembler-matrix", model.BuildingTypeAssemblingMachineMk1, "electromagnetic_matrix", model.Position{X: 14, Y: 12})
	t092MoveItems(t, coilAssembler, matrixAssembler, model.ItemMagneticCoil, 10)
	t092MoveItems(t, boardAssembler, matrixAssembler, model.ItemCircuitBoard, 10)
	t092ProduceUntil(t, ws, matrixAssembler, model.ItemElectromagneticMatrix, 10)

	// Carry the produced matrices into the lab and run the first research.
	provided, _, err := matrixAssembler.Storage.Provide(model.ItemElectromagneticMatrix, 10)
	if err != nil || provided != 10 {
		t.Fatalf("collect produced matrices: provided=%d err=%v", provided, err)
	}
	player.EnsureInventory()[model.ItemElectromagneticMatrix] += provided

	researchTech := func(techID string) {
		t.Helper()
		transferRes, _ := core.execTransferItem(ws, "p1", model.Command{
			Type: model.CmdTransferItem,
			Payload: map[string]any{
				"building_id": lab.ID,
				"item_id":     model.ItemElectromagneticMatrix,
				"quantity":    10,
			},
		})
		if transferRes.Code != model.CodeOK {
			t.Fatalf("transfer matrices for %s: %s (%s)", techID, transferRes.Code, transferRes.Message)
		}
		startRes, _ := core.execStartResearch(ws, "p1", model.Command{
			Type:    model.CmdStartResearch,
			Payload: map[string]any{"tech_id": techID},
		})
		if startRes.Code != model.CodeOK {
			t.Fatalf("start research %s: %s (%s)", techID, startRes.Code, startRes.Message)
		}
		waitForCompletedResearch(t, core, "p1", techID)
	}

	researchTech("electromagnetism")

	if !CanBuildTech(player, model.TechUnlockBuilding, string(model.BuildingTypeDepotMk1)) {
		t.Fatalf("expected %s buildable after electromagnetism", model.BuildingTypeDepotMk1)
	}
	if CanBuildTech(player, model.TechUnlockBuilding, string(model.BuildingTypeSplitter)) {
		t.Fatalf("expected %s to stay locked before basic_logistics_system", model.BuildingTypeSplitter)
	}

	// Follow-up early techs consume chain-produced matrices as well.
	for _, techID := range []string{
		"basic_logistics_system",
		"automatic_metallurgy",
		"basic_assembling_processes",
	} {
		coilAssembler.Storage.Load(model.ItemMagneticCoil, 10)
		boardAssembler.Storage.Load(model.ItemCircuitBoard, 10)
		t092MoveItems(t, coilAssembler, matrixAssembler, model.ItemMagneticCoil, 10)
		t092MoveItems(t, boardAssembler, matrixAssembler, model.ItemCircuitBoard, 10)
		// processTick's power settlement flips the manually-placed producer to
		// no-power; restore its running state before producing the next batch.
		matrixAssembler.Runtime.State = model.BuildingWorkRunning
		t092ProduceUntil(t, ws, matrixAssembler, model.ItemElectromagneticMatrix, 10)
		provided, _, err := matrixAssembler.Storage.Provide(model.ItemElectromagneticMatrix, 10)
		if err != nil || provided != 10 {
			t.Fatalf("collect matrices for %s: provided=%d err=%v", techID, provided, err)
		}
		player.EnsureInventory()[model.ItemElectromagneticMatrix] += provided
		researchTech(techID)
	}

	requiredBuildings := []model.BuildingType{
		model.BuildingTypeMatrixLab,
		model.BuildingTypeWindTurbine,
		model.BuildingTypeTeslaTower,
		model.BuildingTypeMiningMachine,
		model.BuildingTypeConveyorBeltMk1,
		model.BuildingTypeSorterMk1,
		model.BuildingTypeDepotMk1,
		model.BuildingTypeArcSmelter,
		model.BuildingTypeAssemblingMachineMk1,
		model.BuildingTypeSplitter,
		model.BuildingTypeSorterMk2,
		model.BuildingTypeTrafficMonitor,
	}
	for _, btype := range requiredBuildings {
		if !CanBuildTech(player, model.TechUnlockBuilding, string(btype)) {
			t.Fatalf("expected %s to be buildable after early research closure", btype)
		}
	}

	if !CanUseRecipeTech(player, "smelt_stone") {
		t.Fatal("expected smelt_stone usable after automatic_metallurgy")
	}

	if player.Tech == nil {
		t.Fatal("expected player tech state")
	}
	if player.Tech.CurrentResearch != nil {
		t.Fatalf("expected no active research after closure, got %+v", player.Tech.CurrentResearch)
	}
	for _, techID := range []string{
		"electromagnetism",
		"basic_logistics_system",
		"automatic_metallurgy",
		"basic_assembling_processes",
	} {
		if player.Tech.CompletedTechs[techID] == 0 {
			t.Fatalf("expected %s completed, got %+v", techID, player.Tech.CompletedTechs)
		}
	}

	if got := fmt.Sprintf("%v", lab.Production.RecipeID); got != "" {
		t.Fatalf("expected first matrix_lab to remain in research mode, got recipe %q", got)
	}
}

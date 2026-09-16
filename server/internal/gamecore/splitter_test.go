package gamecore

import (
	"fmt"
	"reflect"
	"testing"

	"siliconworld/internal/model"
)

func splitterFixture() (*model.WorldState, *model.Building, map[model.ConveyorDirection]*model.Building) {
	ws := model.NewWorldState("splitter-test", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	splitter := surfaceTestBuilding(ws, "splitter", model.BuildingTypeSplitter, model.Position{X: 3, Y: 3})
	model.InitBuildingConveyor(splitter)
	neighbors := make(map[model.ConveyorDirection]*model.Building)
	for _, dir := range conveyorDirOrder {
		pos, forward := ws.SurfaceStep(splitter.Position, dir)
		belt := newConveyorBuilding(string(dir), pos, forward)
		if dir == model.ConveyorWest {
			belt.Conveyor.Input, belt.Conveyor.Output = forward, forward.Opposite()
		}
		attachBuilding(ws, belt)
		neighbors[dir] = belt
	}
	return ws, splitter, neighbors
}

func TestSplitterBalancedOutputsAndSingleTickTravel(t *testing.T) {
	ws, splitter, belts := splitterFixture()
	source := belts[model.ConveyorWest]
	source.Conveyor.Insert(model.ItemIronOre, 10)
	settleConveyors(ws)
	if splitter.Conveyor.TotalItems() != 6 || source.Conveyor.TotalItems() != 4 {
		t.Fatal("input must obey shared six-item throughput")
	}
	for _, dir := range splitter.Splitter.OutputDirections {
		if belts[dir].Conveyor.TotalItems() != 0 {
			t.Fatal("new receipt traveled twice in same tick")
		}
	}
	ws.Tick++
	settleConveyors(ws)
	for _, dir := range splitter.Splitter.OutputDirections {
		if belts[dir].Conveyor.TotalItems() != 2 {
			t.Fatalf("%s output not balanced: %+v", dir, belts[dir].Conveyor)
		}
	}
	if splitter.Conveyor.TotalItems() != 4 || splitter.Splitter.TransferredItems != 6 || splitter.Splitter.LastTransferTick != ws.Tick {
		t.Fatal("splitter inventory or activity counter is wrong")
	}
}

func TestSplitterOutputPriorityFilterAndBlockedFallback(t *testing.T) {
	ws, splitter, belts := splitterFixture()
	splitter.Splitter.OutputDirections = []model.ConveyorDirection{model.ConveyorEast, model.ConveyorSouth}
	splitter.Splitter.OutputPriority = model.ConveyorEast
	splitter.Splitter.OutputFilters = map[model.ConveyorDirection]string{model.ConveyorEast: model.ItemIronOre, model.ConveyorSouth: model.ItemCopperOre}
	splitter.Conveyor.Insert(model.ItemCopperOre, 4)
	splitter.Conveyor.Insert(model.ItemIronOre, 4)
	settleConveyors(ws)
	if conveyorItemQty(belts[model.ConveyorEast].Conveyor, model.ItemIronOre) != 4 || conveyorItemQty(belts[model.ConveyorSouth].Conveyor, model.ItemCopperOre) != 2 || splitter.Conveyor.TotalItems() != 2 {
		t.Fatal("filter failed to find matching stack or output priority lost")
	}
	// A full preferred output must allow a usable, unfiltered fallback.
	belts[model.ConveyorEast].Conveyor.MaxStack = 4
	splitter.Conveyor.Take(99)
	splitter.Conveyor.Insert(model.ItemIronOre, 6)
	delete(splitter.Splitter.OutputFilters, model.ConveyorSouth)
	settleConveyors(ws)
	if conveyorItemQty(belts[model.ConveyorSouth].Conveyor, model.ItemIronOre) != 6 || splitter.Conveyor.TotalItems() != 0 {
		t.Fatal("blocked priority did not use available output")
	}
	// No configured output accepts stone: it must stay in the true buffer.
	splitter.Splitter.OutputFilters[model.ConveyorSouth] = model.ItemCopperOre
	splitter.Conveyor.Insert(model.ItemStoneOre, 3)
	settleConveyors(ws)
	if conveyorItemQty(splitter.Conveyor, model.ItemStoneOre) != 3 {
		t.Fatal("unmatched cargo disappeared")
	}
}

func TestSplitterInputPriorityAndFairness(t *testing.T) {
	for _, priority := range []model.ConveyorDirection{"", model.ConveyorWest} {
		t.Run(string(priority), func(t *testing.T) {
			ws, splitter, belts := splitterFixture()
			splitter.Splitter.InputDirections = []model.ConveyorDirection{model.ConveyorWest, model.ConveyorNorth}
			splitter.Splitter.OutputDirections = []model.ConveyorDirection{model.ConveyorEast}
			splitter.Splitter.InputPriority = priority
			north := belts[model.ConveyorNorth]
			north.Conveyor.Input, north.Conveyor.Output = model.ConveyorNorth, model.ConveyorSouth
			belts[model.ConveyorWest].Conveyor.Insert(model.ItemIronOre, 6)
			north.Conveyor.Insert(model.ItemCopperOre, 6)
			settleConveyors(ws)
			iron, copper := conveyorItemQty(splitter.Conveyor, model.ItemIronOre), conveyorItemQty(splitter.Conveyor, model.ItemCopperOre)
			if priority == "" && (iron != 3 || copper != 3) {
				t.Fatalf("unfair merge: %d iron %d copper", iron, copper)
			}
			if priority != "" && (iron != 6 || copper != 0) {
				t.Fatalf("priority lost: %d iron %d copper", iron, copper)
			}
			splitter.Conveyor.Take(99)
			belts[model.ConveyorWest].Conveyor.Take(99)
			settleConveyors(ws)
			if conveyorItemQty(splitter.Conveyor, model.ItemCopperOre) == 0 {
				t.Fatal("empty input priority blocked available input")
			}
		})
	}
}

func TestSplitterRejectsInactiveAndForeignConnections(t *testing.T) {
	for _, state := range []model.BuildingWorkState{model.BuildingWorkIdle, model.BuildingWorkPaused, model.BuildingWorkError, model.BuildingWorkNoPower} {
		t.Run(string(state), func(t *testing.T) {
			ws, s, belts := splitterFixture()
			s.Runtime.State = state
			s.Conveyor.Insert(model.ItemCopperOre, 3)
			belts[model.ConveyorWest].Conveyor.Insert(model.ItemIronOre, 3)
			settleConveyors(ws)
			if s.Conveyor.TotalItems() != 3 || belts[model.ConveyorWest].Conveyor.TotalItems() != 3 || belts[model.ConveyorEast].Conveyor.TotalItems() != 0 {
				t.Fatal("inactive splitter transferred cargo")
			}
		})
	}
	ws, s, belts := splitterFixture()
	for _, b := range belts {
		b.OwnerID = "enemy"
	}
	s.Conveyor.Insert(model.ItemCopperOre, 3)
	belts[model.ConveyorWest].Conveyor.Insert(model.ItemIronOre, 3)
	settleConveyors(ws)
	if s.Conveyor.TotalItems() != 3 || belts[model.ConveyorWest].Conveyor.TotalItems() != 3 {
		t.Fatal("foreign connection transferred cargo")
	}
}

func TestSplitterBuildInitializesTransportWithoutElectricity(t *testing.T) {
	core := newConstructionTestCore(t, 2, 2)
	ws := core.world
	pos, _ := findTwoOpenTiles(ws)
	before := ws.Players["p1"].Resources
	result, _ := core.execBuild(ws, "p1", model.Command{Type: model.CmdBuild, Target: model.CommandTarget{Position: &pos}, Payload: map[string]any{"building_type": "splitter", "direction": "east"}})
	if result.Status != model.StatusExecuted {
		t.Fatalf("build: %+v", result)
	}
	for _, task := range ws.Construction.Tasks {
		if _, err := core.completeConstructionTask(ws, task); err != nil {
			t.Fatal(err)
		}
	}
	var s *model.Building
	for _, b := range ws.Buildings {
		if b.Type == model.BuildingTypeSplitter {
			s = b
		}
	}
	if s == nil || s.Splitter == nil || s.Conveyor == nil {
		t.Fatal("build did not initialize splitter")
	}
	if s.Conveyor.Throughput != 6 || s.Conveyor.MaxStack != 24 || s.Conveyor.Input != model.ConveyorAuto || s.Conveyor.Output != model.ConveyorAuto || s.Runtime.Functions.Energy != nil {
		t.Fatalf("wrong splitter profile: %+v", s)
	}
	if err := s.Splitter.Validate(); err != nil {
		t.Fatal(err)
	}
	if ws.Players["p1"].Resources.Minerals != before.Minerals-20 || ws.Players["p1"].Resources.Energy != before.Energy-10 {
		t.Fatal("wrong splitter construction cost")
	}
}

func TestConfigureSplitterAtomicReplacementAndEventIsolation(t *testing.T) {
	ws, s, _ := splitterFixture()
	gc := &GameCore{}
	s.Splitter.OutputCursor = 2
	s.Splitter.TransferredItems = 9
	s.Splitter.LastTransferTick = 4
	s.Conveyor.Insert(model.ItemIronOre, 3)
	initial := s.Clone()
	invalid := []map[string]any{
		{},
		{"input_directions": []string{"west"}, "output_directions": []string{"west"}},
		{"input_directions": []string{"west", "west"}, "output_directions": []string{"east"}},
		{"input_directions": []string{"auto"}, "output_directions": []string{"east"}},
		{"input_directions": []string{"west"}, "output_directions": []string{}},
		{"input_directions": []string{"west"}, "output_directions": []string{"east"}, "output_priority": "south"},
		{"input_directions": []string{"west"}, "output_directions": []string{"east"}, "input_priority": true},
		{"input_directions": []string{"west"}, "output_directions": []string{"east"}, "output_filters": map[string]any{"east": "fake-item"}},
		{"input_directions": []string{"west"}, "output_directions": []string{"east"}, "output_filters": map[string]any{"south": model.ItemIronOre}},
		{"input_directions": []string{"west"}, "output_directions": []string{"east"}, "output_filters": map[string]any{"east": 123}},
	}
	for i, payload := range invalid {
		result, events := gc.execConfigureSplitter(ws, "p1", model.Command{Target: model.CommandTarget{EntityID: s.ID}, Payload: payload})
		if result.Status != model.StatusFailed || len(events) != 0 || !reflect.DeepEqual(s.Splitter, initial.Splitter) || !reflect.DeepEqual(s.Conveyor, initial.Conveyor) {
			t.Fatalf("invalid command %d mutated live state: %+v", i, result)
		}
	}
	payload := map[string]any{"input_directions": []string{"west", "north"}, "output_directions": []string{"east", "south"}, "output_priority": "east", "output_filters": map[string]any{"east": model.ItemIronOre}}
	command := model.Command{Target: model.CommandTarget{EntityID: s.ID}, Payload: payload}
	if result, _ := gc.execConfigureSplitter(ws, "enemy", command); result.Code != model.CodeNotOwner {
		t.Fatal("foreign configuration accepted")
	}
	result, events := gc.execConfigureSplitter(ws, "p1", command)
	if result.Status != model.StatusExecuted || len(events) != 1 || s.Splitter.OutputCursor != 0 || s.Splitter.TransferredItems != 9 || s.Splitter.LastTransferTick != 4 {
		t.Fatalf("configure failed: %+v", result)
	}
	eventState := events[0].Payload["splitter"].(*model.SplitterState)
	eventState.InputDirections[0] = model.ConveyorEast
	eventState.OutputFilters[model.ConveyorEast] = model.ItemCopperOre
	if s.Splitter.InputDirections[0] != model.ConveyorWest || s.Splitter.OutputFilters[model.ConveyorEast] != model.ItemIronOre {
		t.Fatal("event aliases live configuration")
	}
	delete(payload, "output_filters")
	delete(payload, "output_priority")
	result, _ = gc.execConfigureSplitter(ws, "p1", command)
	if result.Status != model.StatusExecuted || len(s.Splitter.OutputFilters) != 0 || s.Splitter.OutputPriority != "" || !reflect.DeepEqual(s.Conveyor, initial.Conveyor) {
		t.Fatal("replacement failed to clear optional fields or changed cargo")
	}
}

func TestSplitterAllSurfaceSeams(t *testing.T) {
	const size = 8
	for face := 0; face < 6; face++ {
		for d, dir := range conveyorDirOrder {
			t.Run(fmt.Sprintf("face%d-%s", face, dir), func(t *testing.T) {
				x, y := size/2, size/2
				switch d {
				case 0:
					y = 0
				case 1:
					x = size - 1
				case 2:
					y = size - 1
				case 3:
					x = 0
				}
				ws := model.NewWorldState("seam", size)
				origin := model.Position{X: (face%3)*size + x, Y: (face/3)*size + y}
				next, forward := ws.SurfaceStep(origin, dir)
				a := surfaceTestBuilding(ws, "a", model.BuildingTypeSplitter, origin)
				model.InitBuildingConveyor(a)
				b := surfaceTestBuilding(ws, "b", model.BuildingTypeSplitter, next)
				model.InitBuildingConveyor(b)
				a.Splitter.InputDirections = []model.ConveyorDirection{dir.Opposite()}
				a.Splitter.OutputDirections = []model.ConveyorDirection{dir}
				b.Splitter.InputDirections = []model.ConveyorDirection{forward.Opposite()}
				b.Splitter.OutputDirections = []model.ConveyorDirection{forward}
				a.Conveyor.Insert(model.ItemIronOre, 3)
				settleConveyors(ws)
				if a.Conveyor.TotalItems() != 0 || b.Conveyor.TotalItems() != 3 {
					t.Fatalf("seam failed %v -> %v (%s)", origin, next, forward)
				}
			})
		}
	}
}

func TestSplitterCyclePreservesMixedCargoAndSpray(t *testing.T) {
	ws := model.NewWorldState("loop", 8)
	positions := []model.Position{{X: 2, Y: 2}, {X: 3, Y: 2}, {X: 3, Y: 3}, {X: 2, Y: 3}}
	inputs := []model.ConveyorDirection{model.ConveyorSouth, model.ConveyorWest, model.ConveyorNorth, model.ConveyorEast}
	outputs := []model.ConveyorDirection{model.ConveyorEast, model.ConveyorSouth, model.ConveyorWest, model.ConveyorNorth}
	for i, pos := range positions {
		b := surfaceTestBuilding(ws, fmt.Sprintf("loop-%d", i), model.BuildingTypeSplitter, pos)
		model.InitBuildingConveyor(b)
		b.Splitter.InputDirections = []model.ConveyorDirection{inputs[i]}
		b.Splitter.OutputDirections = []model.ConveyorDirection{outputs[i]}
		if i == 0 {
			b.Conveyor.Buffer = []model.ItemStack{{ItemID: model.ItemIronOre, Quantity: 8, Spray: &model.SprayState{Level: 2, RemainingUses: 3}}, {ItemID: model.ItemCopperOre, Quantity: 5}, {ItemID: model.ItemIronOre, Quantity: 3, Spray: &model.SprayState{Level: 1, RemainingUses: 1}}}
		}
	}
	for tick := 0; tick < 100; tick++ {
		ws.Tick = int64(tick)
		settleConveyors(ws)
		totals := map[string]int{}
		for _, b := range ws.Buildings {
			if b.Conveyor.TotalItems() > b.Conveyor.MaxStack {
				t.Fatal("buffer overflow")
			}
			for _, stack := range b.Conveyor.Buffer {
				key := stack.ItemID
				if stack.Spray != nil {
					key += fmt.Sprintf("-%d-%d", stack.Spray.Level, stack.Spray.RemainingUses)
				}
				totals[key] += stack.Quantity
			}
		}
		want := map[string]int{model.ItemIronOre + "-2-3": 8, model.ItemCopperOre: 5, model.ItemIronOre + "-1-1": 3}
		if !reflect.DeepEqual(totals, want) {
			t.Fatalf("tick %d duplicated/lost cargo: %v", tick, totals)
		}
	}
	for _, b := range ws.Buildings {
		if b.Splitter.TransferredItems < 100 {
			t.Fatal("cycle stopped circulating")
		}
	}
}

func TestSplitterInputCursorPersistsUnderBackpressure(t *testing.T) {
	ws, s, belts := splitterFixture()
	s.Splitter.InputDirections = []model.ConveyorDirection{model.ConveyorWest, model.ConveyorNorth}
	s.Splitter.OutputDirections = []model.ConveyorDirection{model.ConveyorEast}
	s.Conveyor.MaxStack = 1
	north := belts[model.ConveyorNorth]
	north.Conveyor.Input, north.Conveyor.Output = model.ConveyorNorth, model.ConveyorSouth
	belts[model.ConveyorWest].Conveyor.Insert(model.ItemIronOre, 6)
	north.Conveyor.Insert(model.ItemCopperOre, 6)
	for tick := 0; tick < 6; tick++ {
		ws.Tick = int64(tick)
		settleConveyors(ws)
		expected := model.ItemIronOre
		if tick%2 == 1 {
			expected = model.ItemCopperOre
		}
		if conveyorItemQty(s.Conveyor, expected) != 1 {
			t.Fatalf("tick %d starved a waiting port: %+v", tick, s.Conveyor.Buffer)
		}
		s.Conveyor.Take(1)
	}
}

func TestSplitterCannotBypassPortRulesThroughMachinesOrSorters(t *testing.T) {
	ws := model.NewWorldState("isolated", 8)
	s := surfaceTestBuilding(ws, "splitter", model.BuildingTypeSplitter, model.Position{X: 3, Y: 3})
	model.InitBuildingConveyor(s)
	s.Conveyor.Insert(model.ItemIronOre, 3)
	depot := newDepotBuilding("depot", model.Position{X: 4, Y: 3})
	attachBuilding(ws, depot)
	settleBuildingIO(ws)
	if s.Conveyor.TotalItems() != 3 || totalStorageItems(depot.Storage) != 0 {
		t.Fatal("machine bypassed splitter output arbitration")
	}
	sorter := newSorterBuilding("sorter", model.Position{X: 2, Y: 3})
	attachBuilding(ws, sorter)
	for _, forInput := range []bool{false, true} {
		if _, ok := sorterFindConveyor(ws, sorter, model.ConveyorEast, 1, forInput); ok {
			t.Fatal("sorter accessed splitter buffer directly")
		}
	}
}

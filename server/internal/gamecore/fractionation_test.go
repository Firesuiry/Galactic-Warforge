package gamecore

import (
	"encoding/json"
	"reflect"
	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
	"testing"
)

func fractionationFixture() (*model.WorldState, *model.Building, map[model.ConveyorDirection]*model.Building) {
	ws := model.NewWorldState("fractionation", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	b := surfaceTestBuilding(ws, "fractionator", model.BuildingTypeFractionator, model.Position{X: 3, Y: 3})
	model.InitBuildingFractionation(b)
	belts := map[model.ConveyorDirection]*model.Building{}
	for _, dir := range []model.ConveyorDirection{model.ConveyorWest, model.ConveyorEast, model.ConveyorSouth} {
		pos, forward := ws.SurfaceStep(b.Position, dir)
		if dir == model.ConveyorWest {
			forward = forward.Opposite()
		}
		belt := newConveyorBuilding(string(dir), pos, forward)
		attachBuilding(ws, belt)
		belts[dir] = belt
	}
	return ws, b, belts
}

func fractionationTotal(ws *model.WorldState) int {
	count := 0
	for _, b := range ws.Buildings {
		if s := b.Fractionation; s != nil {
			count += stackBufferQuantity(s.InputBuffer) + stackBufferQuantity(s.HydrogenBuffer) + s.DeuteriumBuffer
		}
		if b.Conveyor != nil {
			count += b.Conveyor.TotalItems()
		}
		if s := b.SprayCoater; s != nil {
			count += stackBufferQuantity(s.InputBuffer) + stackBufferQuantity(s.OutputBuffer)
		}
	}
	return count
}

func TestFractionationActualSuccessAndFailurePreserveMatter(t *testing.T) {
	for _, tc := range []struct {
		name      string
		seed      uint32
		converted int64
	}{{"success", 1, 1}, {"return", 12345, 0}} {
		t.Run(tc.name, func(t *testing.T) {
			ws, b, belts := fractionationFixture()
			b.Fractionation.RNGState = tc.seed
			belts[model.ConveyorWest].Conveyor.Insert(model.ItemHydrogen, 1)
			events := settleFractionation(ws)
			s := b.Fractionation
			if s.Attempts != 1 || s.Converted != tc.converted || s.Converted+s.ReturnedHydrogen != 1 || fractionationTotal(ws) != 1 {
				t.Fatalf("wrong real conversion %+v", s)
			}
			if tc.converted == 1 && (len(events) != 1 || ws.ProductionSnapshot == nil) {
				t.Fatal("real output not counted")
			}
			for tick := 1; tick < 30; tick++ {
				ws.Tick = int64(tick)
				settleFractionation(ws)
			}
			if s.Attempts != 1 || fractionationTotal(ws) != 1 {
				t.Fatal("internal buffer was retried without external return")
			}
		})
	}
}

func TestFractionationSprayDecrementsRealHydrogenAndLeavesOtherStackUnchanged(t *testing.T) {
	ws, b, belts := fractionationFixture()
	b.Fractionation.RNGState = 12345
	b.Fractionation.Throughput = 1
	source := belts[model.ConveyorWest].Conveyor
	source.Buffer = []model.ItemStack{{ItemID: model.ItemHydrogen, Quantity: 2, Spray: &model.SprayState{Level: 3, RemainingUses: 2}}}
	settleFractionation(ws)
	s := b.Fractionation
	if s.LastProbability != 0.02 || s.LastSprayLevel != 3 || len(s.HydrogenBuffer) != 1 || s.HydrogenBuffer[0].Spray.RemainingUses != 1 || source.Buffer[0].Spray.RemainingUses != 2 {
		t.Fatalf("spray consumption/clone wrong: %+v source=%+v", s, source.Buffer)
	}
	// Retry requires physically returning the failed molecule to the input belt.
	source.Buffer = s.HydrogenBuffer
	s.HydrogenBuffer = nil
	s.RNGState = 12345
	settleFractionation(ws)
	if s.HydrogenBuffer[0].Spray != nil || s.LastProbability != 0.02 {
		t.Fatal("last real spray use not consumed")
	}
	source.Buffer = s.HydrogenBuffer
	s.HydrogenBuffer = nil
	s.RNGState = 12345
	settleFractionation(ws)
	if s.LastProbability != 0.01 || s.LastSprayLevel != 0 {
		t.Fatal("exhausted spray kept granting bonus")
	}
}

func TestFractionationBackpressureDoesNotConsumeOrReroll(t *testing.T) {
	for _, output := range []string{"hydrogen", "deuterium"} {
		t.Run(output, func(t *testing.T) {
			ws, b, belts := fractionationFixture()
			s := b.Fractionation
			if output == "hydrogen" {
				s.HydrogenBuffer = []model.ItemStack{{ItemID: model.ItemHydrogen, Quantity: s.BufferCapacity}}
				belts[model.ConveyorEast].Conveyor.Insert(model.ItemHydrogen, 10)
			} else {
				s.DeuteriumBuffer = s.BufferCapacity
				belts[model.ConveyorSouth].Conveyor.Insert(model.ItemDeuterium, 10)
			}
			s.InputBuffer = []model.ItemStack{{ItemID: model.ItemHydrogen, Quantity: 3, Spray: &model.SprayState{Level: 2, RemainingUses: 4}}}
			belts[model.ConveyorWest].Conveyor.Insert(model.ItemHydrogen, 4)
			before := s.Clone()
			total := fractionationTotal(ws)
			settleFractionation(ws)
			if s.State != "blocked" || s.RNGState != before.RNGState || s.Attempts != before.Attempts || !reflect.DeepEqual(s.InputBuffer, before.InputBuffer) || fractionationTotal(ws) != total || belts[model.ConveyorWest].Conveyor.TotalItems() != 4 {
				t.Fatal("backpressure consumed cargo/spray or rerolled")
			}
		})
	}
}

func TestFractionationNoPowerAndForeignBelts(t *testing.T) {
	ws, b, belts := fractionationFixture()
	belts[model.ConveyorWest].Conveyor.Insert(model.ItemHydrogen, 4)
	settleResources(ws)
	if b.Runtime.State != model.BuildingWorkNoPower {
		t.Fatalf("unpowered building running: %s", b.Runtime.State)
	}
	before := b.Fractionation.RNGState
	settleFractionation(ws)
	if b.Fractionation.Attempts != 0 || b.Fractionation.RNGState != before || belts[model.ConveyorWest].Conveyor.TotalItems() != 4 {
		t.Fatal("unpowered conversion")
	}
	b.Runtime.State = model.BuildingWorkRunning
	belts[model.ConveyorWest].OwnerID = "enemy"
	settleFractionation(ws)
	if b.Fractionation.Attempts != 0 {
		t.Fatal("stole foreign hydrogen")
	}
}

func TestFractionationPhysicalBeltLoopConservationAndSnapshotReplay(t *testing.T) {
	ws, b, belts := fractionationFixture()
	// Ring from the east return port back to the west input. South is product only.
	belts[model.ConveyorEast].Conveyor.MaxStack = 100
	belts[model.ConveyorWest].Conveyor.MaxStack = 100
	belts[model.ConveyorSouth].Conveyor.MaxStack = 100
	belts[model.ConveyorSouth].Conveyor.Output = model.ConveyorEast
	path := []struct {
		pos model.Position
		dir model.ConveyorDirection
	}{{model.Position{X: 5, Y: 3}, model.ConveyorSouth}, {model.Position{X: 5, Y: 4}, model.ConveyorSouth}, {model.Position{X: 5, Y: 5}, model.ConveyorWest}, {model.Position{X: 4, Y: 5}, model.ConveyorWest}, {model.Position{X: 3, Y: 5}, model.ConveyorWest}, {model.Position{X: 2, Y: 5}, model.ConveyorNorth}, {model.Position{X: 2, Y: 4}, model.ConveyorNorth}}
	for i, p := range path {
		belt := newConveyorBuilding(string(rune('a'+i)), p.pos, p.dir)
		belt.Conveyor.MaxStack = 100
		attachBuilding(ws, belt)
	}
	belts[model.ConveyorWest].Conveyor.Insert(model.ItemHydrogen, 100)
	run := func(world *model.WorldState, n int) {
		for i := 0; i < n; i++ {
			world.Tick++
			settleConveyors(world)
			settleFractionation(world)
			if fractionationTotal(world) != 100 {
				t.Fatalf("tick%d conservation violated: %d", world.Tick, fractionationTotal(world))
			}
		}
	}
	run(ws, 180)
	if b.Fractionation.Converted == 0 || b.Fractionation.ReturnedHydrogen < 100 || b.Fractionation.Attempts <= 100 {
		t.Fatalf("real external loop never fractionated: %+v", b.Fractionation)
	}
	data, err := json.Marshal(snapshot.CaptureWorld(ws))
	if err != nil {
		t.Fatal(err)
	}
	var saved snapshot.WorldSnapshot
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	replay, err := saved.Restore()
	if err != nil {
		t.Fatal(err)
	}
	// Restore normalizes deliberately enlarged test belts; keep both worlds equal.
	for id, building := range replay.Buildings {
		if building.Conveyor != nil {
			building.Conveyor.Throughput = ws.Buildings[id].Conveyor.Throughput
			building.Conveyor.MaxStack = ws.Buildings[id].Conveyor.MaxStack
		}
	}
	run(ws, 220)
	run(replay, 220)
	if !reflect.DeepEqual(ws.Buildings[b.ID].Fractionation, replay.Buildings[b.ID].Fractionation) {
		t.Fatalf("snapshot replay diverged random stream or inventory: live=%+v replay=%+v", ws.Buildings[b.ID].Fractionation, replay.Buildings[b.ID].Fractionation)
	}
	for id, building := range ws.Buildings {
		if !reflect.DeepEqual(building.Conveyor, replay.Buildings[id].Conveyor) {
			t.Fatalf("replay belt %s diverged", id)
		}
	}
}

func TestFractionationIgnoresNonHydrogenAndPipelines(t *testing.T) {
	ws, b, belts := fractionationFixture()
	belts[model.ConveyorWest].Conveyor.Insert(model.ItemCopperOre, 1)
	settleFractionation(ws)
	if b.Fractionation.Attempts != 0 || belts[model.ConveyorWest].Conveyor.TotalItems() != 1 {
		t.Fatal("accepted unrelated material")
	}
	for _, port := range b.Runtime.Params.IOPorts {
		if isPipelineEndpoint(b, port) {
			t.Fatal("count-only pipe must not bypass fractionation stack IO")
		}
	}
}

func TestFractionatorRealConstruction(t *testing.T) {
	core := newConstructionTestCore(t, 2, 2)
	ws := core.world
	pos, _ := findTwoOpenTiles(ws)
	result, _ := core.execBuild(ws, "p1", model.Command{Type: model.CmdBuild, Target: model.CommandTarget{Position: &pos}, Payload: map[string]any{"building_type": "fractionator"}})
	if result.Status != model.StatusExecuted {
		t.Fatalf("fractionator build: %+v", result)
	}
	for _, task := range ws.Construction.Tasks {
		if _, err := core.completeConstructionTask(ws, task); err != nil {
			t.Fatal(err)
		}
	}
	for _, b := range ws.Buildings {
		if b.Type == model.BuildingTypeFractionator {
			if b.Fractionation == nil || b.Storage != nil || b.Production != nil || model.PowerDemandForBuilding(b) != 6 {
				t.Fatal("incorrect fractionator runtime")
			}
			if err := b.Fractionation.Validate(); err != nil {
				t.Fatal(err)
			}
			return
		}
	}
	t.Fatal("missing constructed fractionator")
}

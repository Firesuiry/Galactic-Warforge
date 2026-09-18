package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func newPilerBuilding(id string, pos model.Position) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypeAutomaticPiler, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypeAutomaticPiler,
		OwnerID:     "p1",
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingConveyor(b)
	return b
}

func pilerWorld(t *testing.T) *model.WorldState {
	t.Helper()
	ws := model.NewWorldState("planet-1", 6)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	return ws
}

func TestAutomaticPilerCompressesLooseItemsIntoPiles(t *testing.T) {
	ws := pilerWorld(t)
	piler := newPilerBuilding("piler", model.Position{X: 1, Y: 1})
	attachBuilding(ws, piler)
	piler.Conveyor.AppendStacks([]model.ItemStack{
		{ItemID: model.ItemIronOre, Quantity: 1},
		{ItemID: model.ItemCopperOre, Quantity: 1},
		{ItemID: model.ItemIronOre, Quantity: 2},
	})

	settleConveyors(ws)

	want := []model.ItemStack{
		{ItemID: model.ItemIronOre, Quantity: 2},
		{ItemID: model.ItemCopperOre, Quantity: 1},
		{ItemID: model.ItemIronOre, Quantity: 1},
	}
	if len(piler.Conveyor.Buffer) != len(want) {
		t.Fatalf("expected %d piles, got %+v", len(want), piler.Conveyor.Buffer)
	}
	for i, stack := range want {
		got := piler.Conveyor.Buffer[i]
		if got.ItemID != stack.ItemID || got.Quantity != stack.Quantity {
			t.Fatalf("pile %d: want %+v, got %+v (buffer %+v)", i, stack, got, piler.Conveyor.Buffer)
		}
	}
}

func TestAutomaticPilerIntegrationTechRaisesPileHeightToFour(t *testing.T) {
	ws := pilerWorld(t)
	grantTechs(ws, "p1", "sorter_cargo_integration")
	piler := newPilerBuilding("piler", model.Position{X: 1, Y: 1})
	attachBuilding(ws, piler)
	piler.Conveyor.AppendStacks([]model.ItemStack{{ItemID: model.ItemIronOre, Quantity: 6}})

	settleConveyors(ws)

	buffer := piler.Conveyor.Buffer
	if len(buffer) != 2 || buffer[0].Quantity != 4 || buffer[1].Quantity != 2 {
		t.Fatalf("expected 4x piles [4 2], got %+v", buffer)
	}
	// Capacity is counted in pile slots: MaxStack(4) slots of 4x piles = 16 items.
	if got := pilerFreeCapacity(ws, piler); got != 10 {
		t.Fatalf("expected pile-aware free capacity 10, got %d", got)
	}
}

// Inserting a piler into a belt line must raise the line's sustained
// throughput: the piler carries whole piles per throughput unit while the
// plain belt segment carries single items.
func TestAutomaticPilerRaisesLineThroughput(t *testing.T) {
	runLine := func(withPiler bool, ticks int) int {
		ws := pilerWorld(t)
		source := newConveyorBuilding("source", model.Position{X: 0, Y: 0}, model.ConveyorEast)
		source.Conveyor.Throughput = 8
		source.Conveyor.MaxStack = 64
		var mid *model.Building
		if withPiler {
			mid = newPilerBuilding("mid", model.Position{X: 1, Y: 0})
		} else {
			mid = newConveyorBuilding("mid", model.Position{X: 1, Y: 0}, model.ConveyorEast)
			mid.Conveyor.Throughput = 2
			mid.Conveyor.MaxStack = 2
		}
		sink := newConveyorBuilding("sink", model.Position{X: 2, Y: 0}, model.ConveyorEast)
		sink.Conveyor.Throughput = 8
		sink.Conveyor.MaxStack = 64
		attachBuilding(ws, source)
		attachBuilding(ws, mid)
		attachBuilding(ws, sink)
		source.Conveyor.AppendStacks([]model.ItemStack{{ItemID: model.ItemIronOre, Quantity: 48}})

		for i := 0; i < ticks; i++ {
			settleConveyors(ws)
			ws.Tick++
		}
		if got := source.Conveyor.TotalItems() + mid.Conveyor.TotalItems() + sink.Conveyor.TotalItems(); got != 48 {
			t.Fatalf("line lost items: %d left of 48", got)
		}
		return sink.Conveyor.TotalItems()
	}

	beltLine := runLine(false, 10)
	pilerLine := runLine(true, 10)
	if pilerLine <= beltLine*2 {
		t.Fatalf("piler line throughput %d not meaningfully above belt line %d", pilerLine, beltLine)
	}
}

func TestAutomaticPilerBackpressureWhenTargetFull(t *testing.T) {
	ws := pilerWorld(t)
	piler := newPilerBuilding("piler", model.Position{X: 0, Y: 0})
	target := newConveyorBuilding("target", model.Position{X: 1, Y: 0}, model.ConveyorEast)
	target.Conveyor.MaxStack = 2
	target.Conveyor.AppendStacks([]model.ItemStack{{ItemID: model.ItemCopperOre, Quantity: 2}})
	attachBuilding(ws, piler)
	attachBuilding(ws, target)
	piler.Conveyor.AppendStacks([]model.ItemStack{{ItemID: model.ItemIronOre, Quantity: 4}})

	settleConveyors(ws)

	if got := piler.Conveyor.TotalItems(); got != 4 {
		t.Fatalf("piler lost cargo under backpressure: %d", got)
	}
	if got := target.Conveyor.TotalItems(); got != 2 {
		t.Fatalf("full target accepted items: %d", got)
	}
	for _, stack := range piler.Conveyor.Buffer {
		if stack.Quantity > 2 {
			t.Fatalf("piles must still be compressed to 2x under backpressure: %+v", piler.Conveyor.Buffer)
		}
	}
}

func TestAutomaticPilerInactiveNeitherCompressesNorMoves(t *testing.T) {
	for _, state := range []model.BuildingWorkState{model.BuildingWorkNoPower, model.BuildingWorkState("paused")} {
		t.Run(string(state), func(t *testing.T) {
			ws := pilerWorld(t)
			piler := newPilerBuilding("piler", model.Position{X: 0, Y: 0})
			target := newConveyorBuilding("target", model.Position{X: 1, Y: 0}, model.ConveyorEast)
			attachBuilding(ws, piler)
			attachBuilding(ws, target)
			piler.Conveyor.AppendStacks([]model.ItemStack{
				{ItemID: model.ItemIronOre, Quantity: 1},
				{ItemID: model.ItemCopperOre, Quantity: 1},
				{ItemID: model.ItemIronOre, Quantity: 2},
			})
			piler.Runtime.State = state

			settleConveyors(ws)

			if got := target.Conveyor.TotalItems(); got != 0 {
				t.Fatalf("inactive piler moved items: %d", got)
			}
			if len(piler.Conveyor.Buffer) != 3 {
				t.Fatalf("inactive piler compressed its buffer: %+v", piler.Conveyor.Buffer)
			}
		})
	}
}

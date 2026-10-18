package gamecore

import (
	"fmt"
	"testing"

	"siliconworld/internal/model"
)

func TestProbeBeltThroughputSweep(t *testing.T) {
	for _, stack := range []int{2, 3, 4, 5, 6, 8, 10, 12} {
		for _, tp := range []int{2, 4, 6, 10} {
			got := measureSweep(t, stack, tp)
			fmt.Printf("stack=%2d throughput=%2d -> %.3f items/tick\n", stack, tp, got)
		}
	}
}

func measureSweep(t *testing.T, stack, tp int) float64 {
	ws := model.NewWorldState("planet-1", 30)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	belts := make([]*model.Building, 0, 30)
	for x := 0; x < 30; x++ {
		b := newConveyorBuildingOfType(fmt.Sprintf("b%d", x), model.BuildingTypeConveyorBeltMk1, model.Position{X: x, Y: 0}, model.ConveyorEast)
		b.Conveyor.MaxStack = stack
		b.Conveyor.Throughput = tp
		attachBuilding(ws, b)
		belts = append(belts, b)
	}
	head, tail := belts[0], belts[29]
	sink := 0
	for tick := int64(0); tick < 600; tick++ {
		ws.Tick = tick
		for {
			a, _, _ := head.Conveyor.Insert(model.ItemIronOre, 1)
			if a <= 0 {
				break
			}
		}
		settleConveyors(ws)
		taken := tail.Conveyor.Take(tail.Conveyor.TotalItems())
		if tick >= 300 {
			sink += countStacks(taken)
		}
	}
	return float64(sink) / 300
}

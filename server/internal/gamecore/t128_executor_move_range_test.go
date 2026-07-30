package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func findFreeTileAtDistance(ws *model.WorldState, from model.Position, dist int) *model.Position {
	for dx := -dist; dx <= dist; dx++ {
		dy := dist - absInt(dx)
		for _, sign := range []int{1, -1} {
			x, y := from.X+dx, from.Y+dy*sign
			if !ws.InBounds(x, y) {
				continue
			}
			if _, occupied := ws.TileBuilding[model.TileKey(x, y)]; occupied {
				continue
			}
			return &model.Position{X: x, Y: y}
		}
	}
	return nil
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func TestT128ExecutorMoveRange(t *testing.T) {
	execStats := model.UnitStats(model.UnitTypeExecutor)
	if execStats.MoveRange != 12 {
		t.Fatalf("expected executor move range 12, got %d", execStats.MoveRange)
	}
	if got := model.UnitStats(model.UnitTypeWorker).MoveRange; got != 3 {
		t.Fatalf("worker move range should stay 3, got %d", got)
	}
	if got := model.UnitStats(model.UnitTypeSoldier).MoveRange; got != 2 {
		t.Fatalf("soldier move range should stay 2, got %d", got)
	}

	core := newE2ETestCore(t)
	ws := core.World()

	unit := &model.Unit{
		ID:          "u-exec-move",
		Type:        model.UnitTypeExecutor,
		OwnerID:     "p1",
		Position:    model.Position{X: 16, Y: 16},
		HP:          execStats.HP,
		MaxHP:       execStats.MaxHP,
		Attack:      execStats.Attack,
		Defense:     execStats.Defense,
		AttackRange: execStats.AttackRange,
		MoveRange:   execStats.MoveRange,
		VisionRange: execStats.VisionRange,
	}
	ws.Units[unit.ID] = unit
	unitKey := model.TileKey(unit.Position.X, unit.Position.Y)
	ws.TileUnits[unitKey] = append(ws.TileUnits[unitKey], unit.ID)

	moveTo := func(pos *model.Position) model.CommandResult {
		res, _ := core.execMove(ws, "p1", model.Command{
			Type:   model.CmdMove,
			Target: model.CommandTarget{EntityID: unit.ID, Position: pos},
		})
		return res
	}

	within := findFreeTileAtDistance(ws, unit.Position, 12)
	if within == nil {
		t.Fatal("no free destination tile at distance 12")
	}
	if res := moveTo(within); res.Code != model.CodeOK {
		t.Fatalf("expected move within range 12 to succeed, got %s (%s)", res.Code, res.Message)
	}
	if unit.Position != *within {
		t.Fatalf("expected unit at %+v, got %+v", *within, unit.Position)
	}

	beyond := findFreeTileAtDistance(ws, unit.Position, 13)
	if beyond == nil {
		t.Fatal("no free destination tile at distance 13")
	}
	if res := moveTo(beyond); res.Code != model.CodeOutOfRange {
		t.Fatalf("expected move beyond range 12 to be rejected with out_of_range, got %s (%s)", res.Code, res.Message)
	}
	if unit.Position != *within {
		t.Fatalf("rejected move should not change unit position, got %+v", unit.Position)
	}
}

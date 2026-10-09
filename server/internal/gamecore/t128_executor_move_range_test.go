package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// findWalkableTileAtDistance 沿真实相邻关系（SurfaceNeighbors）走 dist 步找一个可进入格，
// 保证「图上距离」就是 dist，不受球面展开坐标的干扰。
func findWalkableTileAtDistance(ws *model.WorldState, from model.Position, dist int, selfID string) *model.Position {
	seen := map[model.Position]bool{from: true}
	frontier := []model.Position{from}
	for step := 0; step < dist; step++ {
		var next []model.Position
		for _, p := range frontier {
			for _, n := range ws.SurfaceNeighbors(p) {
				n.Z = 0
				if seen[n] || !tileWalkableForUnit(ws, n, selfID) {
					continue
				}
				seen[n] = true
				next = append(next, n)
			}
		}
		if len(next) == 0 {
			return nil
		}
		frontier = next
	}
	target := frontier[0]
	return &target
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// move_range 仍是机甲的数据字段（驱动引擎科技 +2/级，客户端 /path 的 waypoints 也用它切段），
// 但移动命令本身不再受它限制：一条命令下达整条路径，按移速逐 tick 推进。
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
		MoveSpeed:   execStats.MoveSpeed,
		Mecha:       model.NewMechaState(),
	}
	unit.Mecha.Energy = 1000
	unit.Mecha.MaxEnergy = 1000
	ws.Units[unit.ID] = unit
	unitKey := model.TileKey(unit.Position.X, unit.Position.Y)
	ws.TileUnits[unitKey] = append(ws.TileUnits[unitKey], unit.ID)

	moveTo := func(pos *model.Position) model.CommandResult {
		res, _ := execCommand(core, model.CmdMove, ws, "p1", model.Command{
			Type:   model.CmdMove,
			Target: model.CommandTarget{EntityID: unit.ID, Position: pos},
		})
		return res
	}

	// 范围内：正常下单并逐 tick 走到位。
	within := findWalkableTileAtDistance(ws, unit.Position, 12, unit.ID)
	if within == nil {
		t.Fatal("no free destination tile at distance 12")
	}
	if res := moveTo(within); res.Code != model.CodeOK || !unit.HasPath() {
		t.Fatalf("expected in-range move to order a path, got %s (%s)", res.Code, res.Message)
	}
	for i := 0; i < 200 && unit.HasPath(); i++ {
		ws.Tick++
		settleUnitMovement(ws)
	}
	if unit.Position != *within {
		t.Fatalf("expected unit at %+v, got %+v", *within, unit.Position)
	}

	// 超出 move_range：不再拒绝，而是同一条命令走完整条路径。
	beyond := findWalkableTileAtDistance(ws, unit.Position, 20, unit.ID)
	if beyond == nil {
		t.Fatal("no free destination tile at distance 20")
	}
	res := moveTo(beyond)
	if res.Code != model.CodeOK {
		t.Fatalf("expected long move to be accepted, got %s (%s)", res.Code, res.Message)
	}
	if unit.Position == *beyond {
		t.Fatal("long move must not teleport")
	}
	for i := 0; i < 600 && unit.HasPath(); i++ {
		ws.Tick++
		settleUnitMovement(ws)
	}
	if unit.Position != *beyond {
		t.Fatalf("expected unit at %+v, got %+v", *beyond, unit.Position)
	}
}

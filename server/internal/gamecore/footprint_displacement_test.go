package gamecore

import (
	"errors"
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
)

// 落成时把占地里的地面单位推出去（bot 长跑 tick 14440 的真 bug：补给站
// b-86（3×3）落成时步兵 u-74 正站在占地里，落成后四邻全堵、永久砌在墙里）。
// 修法：落成前把占地里的地面单位推到占地外最近的空位（见 footprint_displacement.go）。

// clearBuildArea 找一块 3×3 占地连同外圈 8 格都空着（无建筑、无单位、地形可建）
// 的锚点，供"占地里站着单位"的用例使用。搜索从地图中心向外，结果确定。
func clearBuildArea(t *testing.T, ws *model.WorldState, btype model.BuildingType, fp model.Footprint) model.Position {
	t.Helper()
	center := model.Position{X: ws.MapWidth / 2, Y: ws.MapHeight / 2}
	for _, candidate := range ws.SurfaceDisc(center, 24) {
		if !ws.FootprintFits(candidate, fp, btype, "") {
			continue
		}
		clear := true
		for _, n := range ws.SurfaceDisc(candidate, 8) {
			if !ws.InBounds(n.X, n.Y) || !ws.Grid[n.Y][n.X].Terrain.Buildable() {
				clear = false
				break
			}
			if ws.TileBuilding[model.TileKey(n.X, n.Y)] != "" || len(ws.TileUnits[model.TileKey(n.X, n.Y)]) > 0 {
				clear = false
				break
			}
		}
		if clear {
			return candidate
		}
	}
	t.Fatal("找不到空着的 3×3 落点")
	return model.Position{}
}

// 落成时占地里有地面单位：单位被推到占地外，而不是被砌进墙里。
func TestUnitInsideFootprintIsPushedOutAtCompletion(t *testing.T) {
	core := newEnclosureTestCore(t)
	ws := core.World()
	def, ok := model.BuildingDefinitionByID(model.BuildingTypeSupplyStation)
	if !ok {
		t.Fatal("补给站定义缺失")
	}
	fp := model.RotatedFootprint(def.Footprint, model.PlanRotation0)
	anchor := clearBuildArea(t, ws, model.BuildingTypeSupplyStation, fp)
	tiles, err := ws.FootprintTiles(anchor, fp)
	if err != nil || len(tiles) != 9 {
		t.Fatalf("占地求解失败：%v（%d 格）", err, len(tiles))
	}
	inside := tiles[len(tiles)/2]
	unit := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", inside)

	// 建造命令照常排队（围死判定本来就跳过"站在占地里"的单位）。
	if res := buildAt(t, core, ws, anchor, model.BuildingTypeSupplyStation); res.Code != model.CodeOK {
		t.Fatalf("建造应排队：%s（%s）", res.Code, res.Message)
	}
	taskID := ws.Construction.ReservedTiles[model.TileKey(anchor.X, anchor.Y)]
	task := ws.Construction.Tasks[taskID]
	if task == nil {
		t.Fatal("施工任务不存在")
	}
	events, err := core.completeConstructionTask(ws, task)
	if err != nil {
		t.Fatalf("落成不应失败：%v", err)
	}

	if got := unit.Position; got == inside {
		t.Fatalf("单位仍站在占地里 %+v", got)
	}
	for _, tile := range tiles {
		if tile.X == unit.Position.X && tile.Y == unit.Position.Y {
			t.Fatalf("单位被落在占地内 %+v（占地 %+v）", unit.Position, tiles)
		}
	}
	if !tileWalkableForUnit(ws, unit.Position, unit.ID) {
		t.Fatalf("单位被推到不可通行的格 %+v", unit.Position)
	}
	if got := ws.TileUnits[model.TileKey(unit.Position.X, unit.Position.Y)]; len(got) != 1 || got[0] != unit.ID {
		t.Fatalf("TileUnits 索引未更新：%+v", got)
	}
	// 客户端要靠位移事件把单位挪出占地，否则会继续画在墙里。
	moved := false
	for _, evt := range events {
		if evt == nil || evt.EventType != model.EvtEntityMoved {
			continue
		}
		if evt.Payload["entity_id"] == unit.ID && evt.Payload["reason"] == "footprint_displaced" {
			moved = true
		}
	}
	if !moved {
		t.Fatalf("缺少 footprint_displaced 位移事件：%+v", events)
	}
}

// 占地里站着单位、而它一格空位都让不出来（四周被地形堵死）时：落成推迟，
// 任务保持"施工中"并写明 footprint_occupied；障碍消失后照常落成并把单位推出去。
func TestFootprintOccupiedDelaysCompletionUntilUnitCanLeave(t *testing.T) {
	core := newEnclosureTestCore(t)
	ws := core.World()
	def, _ := model.BuildingDefinitionByID(model.BuildingTypeSupplyStation)
	fp := model.RotatedFootprint(def.Footprint, model.PlanRotation0)
	anchor := clearBuildArea(t, ws, model.BuildingTypeSupplyStation, fp)
	tiles, err := ws.FootprintTiles(anchor, fp)
	if err != nil {
		t.Fatal(err)
	}
	inside := make(map[model.Position]bool, len(tiles))
	for _, tile := range tiles {
		inside[model.Position{X: tile.X, Y: tile.Y}] = true
	}
	unit := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", tiles[len(tiles)/2])

	// 占地外的 7 格内全设成不可建地形：单位没有可让开的空位。
	for _, cell := range ws.SurfaceDisc(unit.Position, 7) {
		pos := model.Position{X: cell.X, Y: cell.Y}
		if inside[pos] {
			continue
		}
		ws.Grid[cell.Y][cell.X].Terrain = terrain.TileBlocked
	}

	if res := buildAt(t, core, ws, anchor, model.BuildingTypeSupplyStation); res.Code != model.CodeOK {
		t.Fatalf("建造应排队：%s（%s）", res.Code, res.Message)
	}
	taskID := ws.Construction.ReservedTiles[model.TileKey(anchor.X, anchor.Y)]
	task := ws.Construction.Tasks[taskID]
	if task == nil {
		t.Fatal("施工任务不存在")
	}
	if _, err := core.completeConstructionTask(ws, task); !errors.Is(err, errFootprintOccupied) {
		t.Fatalf("无空位时应推迟落成，got %v", err)
	}

	// 走施工队列：任务保持施工中、写明等待原因，建筑不落成、材料不退款。
	ws.Tick = 5
	task.State = model.ConstructionInProgress
	task.StartTick = 1
	task.RemainingTicks = 0
	core.settleConstructionQueue(ws)
	if task.State != model.ConstructionInProgress {
		t.Fatalf("任务不应被取消/完成，got %s（%s）", task.State, task.Error)
	}
	if task.WaitReason != WaitReasonFootprintOccupied {
		t.Fatalf("应写明等待原因 %s，got %q", WaitReasonFootprintOccupied, task.WaitReason)
	}
	for _, b := range ws.Buildings {
		if b != nil && b.Type == model.BuildingTypeSupplyStation {
			t.Fatal("占地被单位占住时不应落成建筑")
		}
	}

	// 单位走开后照常落成，并被推到占地外。
	for _, cell := range ws.SurfaceDisc(unit.Position, 7) {
		ws.Grid[cell.Y][cell.X].Terrain = terrain.TileBuildable
	}
	core.settleConstructionQueue(ws)
	if ws.Construction.Tasks[taskID] != nil {
		t.Fatalf("单位让开后应落成，任务仍在：%+v（%s）", task, task.Error)
	}
	placed := false
	for _, b := range ws.Buildings {
		if b != nil && b.Type == model.BuildingTypeSupplyStation && b.Position == anchor {
			placed = true
		}
	}
	if !placed {
		t.Fatal("单位让开后建筑应落成")
	}
	for _, tile := range tiles {
		if tile.X == unit.Position.X && tile.Y == unit.Position.Y {
			t.Fatalf("单位仍被砌在占地里 %+v", unit.Position)
		}
	}
}

// bot 选址不选罩住自家地面单位的落点（否则落成时那台单位要被推挤走）。
func TestBotBuildSpotAvoidsCoveringOwnUnit(t *testing.T) {
	core := newBotTestCore(t, "normal")
	ws := core.World()
	home := botPlayerHome(t, ws, "p2")
	def, _ := model.BuildingDefinitionByID(model.BuildingTypeWindTurbine)
	fp := model.RotatedFootprint(def.Footprint, model.PlanRotation0)

	first := botBuildSpotNear(ws, home, 24, model.BuildingTypeWindTurbine, "p2")
	if first == nil {
		t.Fatal("空地上应能找到落点")
	}
	// 把自家单位正好放在"最近的落点"上：没有这条校验时 bot 还会选它。
	unit := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", *first)

	next := botBuildSpotNear(ws, home, 24, model.BuildingTypeWindTurbine, "p2")
	if next == nil {
		t.Fatal("还有别的空位时 bot 不该放弃")
	}
	if *next == *first {
		t.Fatalf("bot 仍选了罩住自家单位的落点 %+v", *first)
	}
	if spotCoversGroundUnit(ws, *next, fp, "p2") {
		t.Fatalf("bot 选的落点 %+v 罩住了自家单位 %+v", *next, unit.Position)
	}
	if !tileWalkableForUnit(ws, unit.Position, unit.ID) {
		t.Fatalf("单位所在格应仍可通行：%+v", unit.Position)
	}
}

// botMiners 不选罩住自家单位的矿机落点：单位正站在矿点上时，那个 3×3 占地
// 虽然能采到矿，也不能压上去。
func TestBotMinersAvoidCoveringOwnUnit(t *testing.T) {
	core := newBotTestCore(t, "normal")
	ws := core.World()
	tuning := botTuningFor("normal")
	ctx := core.surveyBotWorld(ws, "p2")
	if ctx.home == nil {
		t.Fatal("bot 没有基地")
	}
	grantItems(ws, "p2",
		model.ItemAmount{ItemID: model.ItemCircuitBoard, Quantity: 2},
		model.ItemAmount{ItemID: model.ItemGear, Quantity: 2},
		model.ItemAmount{ItemID: model.ItemIronIngot, Quantity: 4},
		model.ItemAmount{ItemID: model.ItemMagneticCoil, Quantity: 2},
	)
	// 只留基地附近最近的一个可采矿点，保证候选唯一、结果可复现。
	kindRank := map[string]bool{
		model.ItemIronOre: true, model.ItemCopperOre: true,
		model.ItemCoal: true, model.ItemStoneOre: true,
	}
	var node *model.ResourceNodeState
	bestDist := -1
	for _, candidate := range ws.Resources {
		if candidate == nil || candidate.Remaining <= 0 || candidate.Depleted || !kindRank[candidate.Kind] {
			continue
		}
		d := ws.SurfaceDistance(*ctx.home, candidate.Position)
		if d > 72 {
			continue
		}
		if bestDist < 0 || d < bestDist || (d == bestDist && candidate.ID < node.ID) {
			node, bestDist = candidate, d
		}
	}
	if node == nil {
		t.Fatal("基地 72 格内没有可采矿点")
	}
	ws.Resources = map[string]*model.ResourceNodeState{node.ID: node}

	def, _ := model.BuildingDefinitionByID(model.BuildingTypeMiningMachine)
	fp := model.RotatedFootprint(def.Footprint, model.PlanRotation0)
	// 夹具前置：以矿点格为锚点本身是合法落点（能采到矿），唯一的拒绝理由只能是
	// 单位站在里面。
	if !ws.FootprintFits(node.Position, fp, model.BuildingTypeMiningMachine, "") {
		t.Fatalf("夹具前置：矿点 %+v 上应能放下 3×3 矿机", node.Position)
	}
	if model.ValidateCollectorSite(ws, model.BuildingTypeMiningMachine, model.PlanRotation0, node.Position) != nil {
		t.Fatal("夹具前置：矿点格应是合法采集落点")
	}
	unit := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", node.Position)

	var issued []model.Command
	issue := func(cmd model.Command) bool {
		issued = append(issued, cmd)
		return true
	}
	core.botMiners(ws, "p2", tuning, ctx, issue)

	for _, cmd := range issued {
		if cmd.Target.Position == nil {
			continue
		}
		if spotCoversGroundUnit(ws, *cmd.Target.Position, fp, "p2") {
			t.Fatalf("矿机落点 %+v 罩住了自家单位 %+v", *cmd.Target.Position, unit.Position)
		}
	}
}

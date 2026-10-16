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

// blockFootprintExit 把占地外的整圈（含 7 格内）都设成不可建地形，制造"占地里的
// 单位一格都让不出来"的夹具。
func blockFootprintExit(ws *model.WorldState, unit *model.Unit, tiles []model.Position) {
	inside := make(map[model.Position]bool, len(tiles))
	for _, tile := range tiles {
		inside[model.Position{X: tile.X, Y: tile.Y}] = true
	}
	for _, cell := range ws.SurfaceDisc(unit.Position, 7) {
		pos := model.Position{X: cell.X, Y: cell.Y}
		if inside[pos] {
			continue
		}
		ws.Grid[cell.Y][cell.X].Terrain = terrain.TileBlocked
	}
}

// isUnitSealedIn 该单位四邻是否全被永久障碍（建筑/不可建地形）堵死——即"被砌在墙里"。
func isUnitSealedIn(ws *model.WorldState, unit *model.Unit) bool {
	neighbors := ws.SurfaceNeighbors(unit.Position)
	if len(neighbors) == 0 {
		return true
	}
	for _, n := range neighbors {
		if !ws.InBounds(n.X, n.Y) {
			continue
		}
		if ws.Grid[n.Y][n.X].Terrain.Buildable() && ws.Grid[n.Y][n.X].BuildingID == "" {
			return false
		}
	}
	return true
}

// minerKinds botMiners 认的四种矿（与 bot.go 的 kindRank 同一集合）。
var minerKinds = map[string]bool{
	model.ItemIronOre: true, model.ItemCopperOre: true,
	model.ItemCoal: true, model.ItemStoneOre: true,
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
	// 落成后的绝对不变量：单位不能被砌在墙里（四邻至少留一个永久通道）。
	if isUnitSealedIn(ws, unit) {
		t.Fatalf("单位落成后四邻全堵 %+v", unit.Position)
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

// 与 TestUnitInsideFootprintIsPushedOutAtCompletion 同一场景，但落成走的是
// 每 tick 的施工队列（bot 长跑里出事的就是这条路径，tick 14440 补给站 b-86 落成
// 时步兵 u-74 正站在占地里）：队列落成同样把单位挪出占地，不留卡死的单位。
func TestConstructionQueuePushesUnitOutAtCompletion(t *testing.T) {
	core := newEnclosureTestCore(t)
	ws := core.World()
	def, _ := model.BuildingDefinitionByID(model.BuildingTypeSupplyStation)
	fp := model.RotatedFootprint(def.Footprint, model.PlanRotation0)
	anchor := clearBuildArea(t, ws, model.BuildingTypeSupplyStation, fp)
	tiles, err := ws.FootprintTiles(anchor, fp)
	if err != nil || len(tiles) != 9 {
		t.Fatalf("占地求解失败：%v（%d 格）", err, len(tiles))
	}
	unit := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", tiles[len(tiles)/2])
	if res := buildAt(t, core, ws, anchor, model.BuildingTypeSupplyStation); res.Code != model.CodeOK {
		t.Fatalf("建造应排队：%s（%s）", res.Code, res.Message)
	}
	taskID := ws.Construction.ReservedTiles[model.TileKey(anchor.X, anchor.Y)]
	task := ws.Construction.Tasks[taskID]
	if task == nil {
		t.Fatal("施工任务不存在")
	}
	// 施工推进到最后一刻，由施工队列完成落成。
	ws.Tick = 5
	task.State = model.ConstructionInProgress
	task.StartTick = 1
	task.RemainingTicks = 0
	core.settleConstructionQueue(ws)

	if ws.Construction.Tasks[taskID] != nil {
		t.Fatalf("任务应完成并出队：%+v（%s）", task, task.Error)
	}
	placed := false
	for _, b := range ws.Buildings {
		if b != nil && b.Type == model.BuildingTypeSupplyStation && b.Position == anchor {
			placed = true
		}
	}
	if !placed {
		t.Fatal("建筑应落成")
	}
	for _, tile := range tiles {
		if tile.X == unit.Position.X && tile.Y == unit.Position.Y {
			t.Fatalf("单位被砌在占地里 %+v", unit.Position)
		}
	}
	if isUnitSealedIn(ws, unit) {
		t.Fatalf("单位落成后四邻全堵 %+v", unit.Position)
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
	unit := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", tiles[len(tiles)/2])
	blockFootprintExit(ws, unit, tiles)

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

// 占地里站着单位、但占地外的"空位"只是另一个一格宽的小口袋时：那不算让开
// （单位照样出不来），落成同样推迟。
func TestFootprintOccupiedWhenOnlyPocketRemains(t *testing.T) {
	core := newEnclosureTestCore(t)
	ws := core.World()
	def, _ := model.BuildingDefinitionByID(model.BuildingTypeSupplyStation)
	fp := model.RotatedFootprint(def.Footprint, model.PlanRotation0)
	anchor := clearBuildArea(t, ws, model.BuildingTypeSupplyStation, fp)
	tiles, err := ws.FootprintTiles(anchor, fp)
	if err != nil {
		t.Fatal(err)
	}
	unit := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", tiles[len(tiles)/2])
	// 先按"一格都让不出来"封锁，再在占地角外留一个孤立格当口袋：它可通行、可落位，
	// 但四邻仍全是障碍，落进去的单位永远出不来。
	blockFootprintExit(ws, unit, tiles)
	pocket := ws.SurfaceOffset(anchor, -1, -1)
	ws.Grid[pocket.Y][pocket.X].Terrain = terrain.TileBuildable
	if !tileWalkableForUnit(ws, pocket, unit.ID) {
		t.Fatalf("夹具前置：口袋格 %+v 应可站立", pocket)
	}
	if footprintRegionOpen(ws, pocket, map[model.Position]bool{}) {
		t.Fatalf("夹具前置：口袋格 %+v 不应算开阔区域", pocket)
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
		t.Fatalf("只剩小口袋时应推迟落成，got %v", err)
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
	// 同一局面必须给出同一落点（bot 决策可复现）。
	if again := botBuildSpotNear(ws, home, 24, model.BuildingTypeWindTurbine, "p2"); again == nil || *again != *next {
		t.Fatalf("选址应可复现：%v != %v", again, *next)
	}
}

// bot 选址不因自家空中单位让路（占地不占空域，罩住无人机不影响它）。
func TestBotBuildSpotIgnoresOwnAirUnit(t *testing.T) {
	core := newBotTestCore(t, "normal")
	ws := core.World()
	home := botPlayerHome(t, ws, "p2")

	first := botBuildSpotNear(ws, home, 24, model.BuildingTypeWindTurbine, "p2")
	if first == nil {
		t.Fatal("空地上应能找到落点")
	}
	air := spawnWorldTestUnit(ws, model.UnitTypeAttackDrone, "p2", *first)
	if !unitIsAir(ws, air.ID) {
		t.Fatalf("夹具前置：%s 应是空中单位", air.Type)
	}
	next := botBuildSpotNear(ws, home, 24, model.BuildingTypeWindTurbine, "p2")
	if next == nil {
		t.Fatal("空中单位不该挡掉落点")
	}
	if *next != *first {
		t.Fatalf("空中单位不该影响选址：%v != %v", *next, *first)
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
	def, _ := model.BuildingDefinitionByID(model.BuildingTypeMiningMachine)
	fp := model.RotatedFootprint(def.Footprint, model.PlanRotation0)

	// 挑一个「以矿点格为锚点就能合法落位、且能采到该矿」的矿点：唯一的拒绝理由
	// 只能是单位站在里面。（开局补矿簇在 HQ 边上，多数矿点格本身放不下 3×3。）
	var node *model.ResourceNodeState
	for _, candidate := range ws.Resources {
		if candidate == nil || candidate.Remaining <= 0 || candidate.Depleted {
			continue
		}
		if _, ok := minerKinds[candidate.Kind]; !ok {
			continue
		}
		if !ws.FootprintFits(candidate.Position, fp, model.BuildingTypeMiningMachine, "") {
			continue
		}
		if model.MiningItemAt(ws, model.BuildingTypeMiningMachine, model.PlanRotation0, candidate.Position) != candidate.Kind {
			continue
		}
		if node == nil || candidate.ID < node.ID {
			node = candidate
		}
	}
	if node == nil {
		t.Fatal("找不到「锚点即合法矿机落点」的矿点")
	}
	ws.Resources = map[string]*model.ResourceNodeState{node.ID: node}

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

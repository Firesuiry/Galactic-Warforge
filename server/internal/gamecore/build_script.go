package gamecore

import (
	"fmt"
	"sort"

	"siliconworld/internal/model"
)

// 本文件是「脚本化开局 / 存档点重建」共用的引擎侧助手：
//
//   - SubmitAndAdvance：下发一条命令并推进一个 tick，返回结果（与 HTTP 队列同路径）。
//   - PlanBuildSpot：按整块占地可落位、不压矿脉、不围死地面单位选建筑空位。
//   - PlanMinerSpot：给采矿机挑「覆盖框内只有一种矿」的落点。
//   - PlanBeltLink：在建筑外圈放一条传送带 + 一栋下游建筑，让产物自动流过去。
//
// 为什么放在引擎里：细分网格之后建筑占 2×2/3×3/5×5 个 cell，坐标手写一遍就会
// 随地图与网格改动过期（1014 的存档点全部因此失效）。重建工具不写死坐标，改用
// 这些规则在**读档后的真实局面**上现场选点。

// SubmitAndAdvance 以玩家身份下发一条命令并推进一个 tick，返回该命令的结果。
//
// 与 POST /commands 同一条路径（入队 → 下一 tick 结算），因此重建/脚本化的节奏
// 与真人下命令一致：一条命令消耗一个 tick。返回的 CommandResult 由审计日志还原
// （status/code/message），被拒时 Status 为 rejected/failed，调用方据此报出
// 「第几步、哪条命令、拒绝原因」。
func (gc *GameCore) SubmitAndAdvance(playerID string, cmd model.Command) (model.CommandResult, error) {
	if gc == nil || gc.world == nil {
		return model.CommandResult{}, fmt.Errorf("game core is not ready")
	}
	if gc.queue == nil {
		return model.CommandResult{}, fmt.Errorf("command queue is not configured")
	}
	if playerID == "" {
		return model.CommandResult{}, fmt.Errorf("player id is required")
	}
	requestID := fmt.Sprintf("script-%s-%d-%s", playerID, gc.CurrentTick(), cmd.Type)
	req := &model.QueuedRequest{
		Request: model.CommandRequest{
			RequestID:  requestID,
			IssuerType: "player",
			IssuerID:   playerID,
			Commands:   []model.Command{cmd},
		},
		PlayerID:    playerID,
		EnqueueTick: gc.CurrentTick(),
	}
	if !gc.queue.Enqueue(req) {
		return model.CommandResult{}, fmt.Errorf("request_id 冲突（同一 tick 下发了同名命令）")
	}
	gc.processTick()

	// 结果优先从审计日志还原（线上服务端路径）；审计库没接上的场合
	// （测试/重建环境）退回本 tick 的命令日志——两者记的是同一个
	// CommandResult，只是审计库多了 issuer/permission 这些排查字段。
	entries, err := gc.QueryAudit(model.AuditQuery{RequestID: requestID})
	if err != nil || len(entries) == 0 {
		if logged, ok := gc.lastCommandResult(requestID); ok {
			if logged.Status == model.StatusRejected || logged.Status == model.StatusFailed {
				return logged, fmt.Errorf("%s %s", logged.Code, logged.Message)
			}
			return logged, nil
		}
		if err != nil {
			return model.CommandResult{}, fmt.Errorf("读取审计日志: %v", err)
		}
		return model.CommandResult{}, fmt.Errorf("审计日志里没有这条命令的结果")
	}
	entry := entries[len(entries)-1]
	status, _ := entry.Details["status"].(string)
	code, _ := entry.Details["code"].(string)
	message, _ := entry.Details["message"].(string)
	result := model.CommandResult{
		Status:  model.CommandStatus(status),
		Code:    model.ResultCode(code),
		Message: message,
	}
	if status == string(model.StatusRejected) || status == string(model.StatusFailed) {
		return result, fmt.Errorf("%s %s", code, message)
	}
	return result, nil
}

// lastCommandResult 从命令日志里取某个 request_id 的第一条结果（审计库不可用时的兜底）。
func (gc *GameCore) lastCommandResult(requestID string) (model.CommandResult, bool) {
	if gc == nil || gc.cmdLog == nil {
		return model.CommandResult{}, false
	}
	for _, entry := range gc.cmdLog.All() {
		if entry.RequestID != requestID || len(entry.Results) == 0 {
			continue
		}
		return entry.Results[0], true
	}
	return model.CommandResult{}, false
}

// PlanBuildSpot 返回 home 附近可以放下 btype 的空位（锚点 = 占地左上角）。
// 返回 nil 表示 maxRadius 内没有合法空位。
//
// 与 bot 选址同规则，另加两条：
//   - 占地内不压资源脉（压在矿脉上的建筑会让那条脉永远采不了）；
//   - 占地不罩住自家地面单位（建造不会把单位推出去，占地落成后单位永久卡死）。
func PlanBuildSpot(ws *model.WorldState, home model.Position, maxRadius int, btype model.BuildingType) *model.Position {
	if ws == nil || maxRadius < 1 {
		return nil
	}
	def, ok := model.BuildingDefinitionByID(btype)
	if !ok {
		return nil
	}
	fp := model.RotatedFootprint(def.Footprint, model.PlanRotation0)
	for radius := 3; radius <= maxRadius; radius++ {
		candidates := ws.SurfaceDisc(home, radius)
		sort.SliceStable(candidates, func(i, j int) bool {
			return ws.SurfaceDistance(home, candidates[i]) < ws.SurfaceDistance(home, candidates[j])
		})
		for _, candidate := range candidates {
			if ws.SurfaceDistance(home, candidate) != radius || !ws.InBounds(candidate.X, candidate.Y) {
				continue
			}
			if !ws.Grid[candidate.Y][candidate.X].Terrain.Buildable() {
				continue
			}
			if ws.Grid[candidate.Y][candidate.X].BuildingID != "" || ws.Grid[candidate.Y][candidate.X].ResourceNodeID != "" {
				continue
			}
			if ws.Construction != nil && ws.Construction.IsTileReserved(model.TileKey(candidate.X, candidate.Y)) {
				continue
			}
			if !ws.FootprintFits(candidate, fp, btype, "") {
				continue
			}
			// 施工中的建筑会把它整个占地预约掉，而 FootprintFits 只看已落成的
			// TileBuilding——只查锚点会让候选点压到在建建筑的别的格上，命令被
			// POSITION_OCCUPIED 拒掉（实测重试到整层卡死）。
			if footprintReserved(ws, candidate, fp) {
				continue
			}
			blocked := false
			if tiles, err := ws.FootprintTiles(candidate, fp); err == nil {
				for _, tile := range tiles {
					if ws.Grid[tile.Y][tile.X].ResourceNodeID != "" {
						blocked = true
						break
					}
				}
			}
			if blocked {
				continue
			}
			if buildingEnclosure(ws, btype, model.PlanRotation0, candidate) != nil {
				continue
			}
			if spotCoversGroundUnit(ws, candidate, fp) {
				continue
			}
			c := candidate
			return &c
		}
	}
	return nil
}

// PlanMinerSpot 给采矿机选落点：在 node 附近找「整块 3×3 占地可落位」的锚点。
// pureKind 非空时还要求覆盖框（占地 + 外扩 1 圈）里只有这一种矿——矿机压在混合
// 矿簇上会被先攒满的矿种堵死（详见 skirmish_from_zero_test.go 的开局注释）。
func PlanMinerSpot(ws *model.WorldState, node *model.ResourceNodeState, pureKind string) (model.Position, bool) {
	if ws == nil || node == nil {
		return model.Position{}, false
	}
	def, ok := model.BuildingDefinitionByID(model.BuildingTypeMiningMachine)
	if !ok {
		return model.Position{}, false
	}
	fp := model.RotatedFootprint(def.Footprint, model.PlanRotation0)
	for _, candidate := range ws.SurfaceDisc(node.Position, 6) {
		if !ws.InBounds(candidate.X, candidate.Y) {
			continue
		}
		if !ws.FootprintFits(candidate, fp, model.BuildingTypeMiningMachine, "") {
			continue
		}
		if footprintReserved(ws, candidate, fp) {
			continue
		}
		if model.ValidateCollectorSite(ws, model.BuildingTypeMiningMachine, model.PlanRotation0, candidate) != nil {
			continue
		}
		if buildingEnclosure(ws, model.BuildingTypeMiningMachine, model.PlanRotation0, candidate) != nil {
			continue
		}
		if spotCoversGroundUnit(ws, candidate, fp) {
			continue
		}
		if pureKind != "" && !minerCoverIsPure(ws, candidate, pureKind) {
			continue
		}
		return candidate, true
	}
	return model.Position{}, false
}

// MinerCoverKinds 返回采矿机锚点覆盖框（占地 + 外扩 1 圈）内各矿种的数量。
func MinerCoverKinds(ws *model.WorldState, anchor model.Position) map[string]int {
	out := map[string]int{}
	if ws == nil {
		return out
	}
	for oy := -1; oy < 4; oy++ {
		for ox := -1; ox < 4; ox++ {
			cell := ws.SurfaceOffset(anchor, ox, oy)
			if !ws.InBounds(cell.X, cell.Y) {
				continue
			}
			id := ws.Grid[cell.Y][cell.X].ResourceNodeID
			if id == "" {
				continue
			}
			node := ws.Resources[id]
			if node == nil {
				continue
			}
			out[node.Kind]++
		}
	}
	return out
}

func minerCoverIsPure(ws *model.WorldState, anchor model.Position, kind string) bool {
	kinds := MinerCoverKinds(ws, anchor)
	if len(kinds) == 0 {
		return false
	}
	_, ok := kinds[kind]
	return ok && len(kinds) == 1
}

// footprintReserved 报告整块占地里是否有格子被施工任务预约（在建建筑 + 排队中）。
func footprintReserved(ws *model.WorldState, origin model.Position, fp model.Footprint) bool {
	if ws == nil || ws.Construction == nil {
		return false
	}
	tiles, err := ws.FootprintTiles(origin, fp)
	if err != nil {
		return true
	}
	for _, tile := range tiles {
		if ws.Construction.IsTileReserved(model.TileKey(tile.X, tile.Y)) {
			return true
		}
	}
	return false
}

// spotCoversGroundUnit 该占地是否罩住了自家地面单位（含机甲）。建造不会把单位
// 推出去，占地落成后单位会永久卡在建筑格上，所以选点必须主动避开。
func spotCoversGroundUnit(ws *model.WorldState, origin model.Position, fp model.Footprint) bool {
	if ws == nil {
		return false
	}
	tiles, err := ws.FootprintTiles(origin, fp)
	if err != nil {
		return true
	}
	for id, u := range ws.Units {
		if u == nil || u.HP <= 0 || unitIsAir(ws, id) {
			continue
		}
		for _, t := range tiles {
			if t.X == u.Position.X && t.Y == u.Position.Y {
				return true
			}
		}
	}
	return false
}

// BeltLink 描述「上游建筑 → 一条传送带 → 分拣器 → 下游建筑」的落位。
//
// 第 16 轮契约 §3 起，生产建筑与传送带之间必须夹一台分拣器（只有 direct_belt_io
// 的采集类 / 物流站 / 带上设备保留直连）。所以一条最短产线是四格：
// 上游占地外圈「带子」→「分拣器」（背面朝带、正面朝下游）→ 下游占地内。
// 分拣器的朝向用 SorterRotation 表达（0°=正面北、90°=东、180°=南、270°=西）。
type BeltLink struct {
	Belt   model.Position
	Dir    model.ConveyorDirection
	Sorter model.Position
	// SorterRotation 是分拣器的建造朝向：正面 = 放货端（下游），背面 = 取货端（带子）。
	SorterRotation model.PlanRotation
	Target         model.Position // 下游建筑的占地锚点
}

// PlanBeltLink 在 src 建筑占地外圈找一个方向，放「传送带 + 分拣器 + 下游建筑」，
// 让 src 的产出经分拣器自动流进下游建筑的输入端口。返回 false 表示四个方向都不行。
//
// 端口规则（见 docs/guide/细分网格与DSP界面.md §1.2 与实物经济与分拣器.md §2）：
// 建筑 IO 是「占地外圈一圈相邻 cell」。分拣器是 1×1，取货端沿朝向的反方向扫
// Range 格、放货端沿朝向扫 Range 格，所以「带子 → 分拣器 → 下游占地」这条
// 直线在 Range ≥ 2 时两个端点都能连上（mk1 的 Range=1 只够接一侧）。
func PlanBeltLink(ws *model.WorldState, src *model.Building, targetType model.BuildingType) (BeltLink, bool) {
	if ws == nil || src == nil {
		return BeltLink{}, false
	}
	def, ok := model.BuildingDefinitionByID(targetType)
	if !ok {
		return BeltLink{}, false
	}
	fp := model.RotatedFootprint(def.Footprint, model.PlanRotation0)
	tiles, err := ws.BuildingTiles(src)
	if err != nil || len(tiles) == 0 {
		return BeltLink{}, false
	}
	minX, minY, maxX, maxY := tiles[0].X, tiles[0].Y, tiles[0].X, tiles[0].Y
	for _, t := range tiles {
		minX, minY = min(minX, t.X), min(minY, t.Y)
		maxX, maxY = max(maxX, t.X), max(maxY, t.Y)
	}
	// 四个方向各取一条候选带子（沿占地中轴），带子后面是分拣器，再往外是下游建筑。
	type candidate struct {
		belt   model.Position
		dir    model.ConveyorDirection
		sorter model.Position
		rot    model.PlanRotation
		target model.Position
	}
	var candidates []candidate
	midX, midY := (minX+maxX)/2, (minY+maxY)/2
	// 东/西：带子在中轴上，分拣器与下游建筑沿中轴再往外。
	candidates = append(candidates,
		candidate{belt: model.Position{X: maxX + 1, Y: midY}, dir: model.ConveyorEast,
			sorter: model.Position{X: maxX + 2, Y: midY}, rot: model.PlanRotation90,
			target: model.Position{X: maxX + 3, Y: midY - fp.Height/2}},
		candidate{belt: model.Position{X: minX - 1, Y: midY}, dir: model.ConveyorWest,
			sorter: model.Position{X: minX - 2, Y: midY}, rot: model.PlanRotation270,
			target: model.Position{X: minX - 2 - fp.Width, Y: midY - fp.Height/2}},
		candidate{belt: model.Position{X: midX, Y: maxY + 1}, dir: model.ConveyorSouth,
			sorter: model.Position{X: midX, Y: maxY + 2}, rot: model.PlanRotation180,
			target: model.Position{X: midX - fp.Width/2, Y: maxY + 3}},
		candidate{belt: model.Position{X: midX, Y: minY - 1}, dir: model.ConveyorNorth,
			sorter: model.Position{X: midX, Y: minY - 2}, rot: model.PlanRotation0,
			target: model.Position{X: midX - fp.Width/2, Y: minY - 2 - fp.Height}},
	)
	for _, c := range candidates {
		if !ws.InBounds(c.belt.X, c.belt.Y) || !ws.InBounds(c.sorter.X, c.sorter.Y) {
			continue
		}
		if !ws.Grid[c.belt.Y][c.belt.X].Terrain.Buildable() || !ws.Grid[c.sorter.Y][c.sorter.X].Terrain.Buildable() {
			continue
		}
		if ws.Grid[c.belt.Y][c.belt.X].BuildingID != "" || ws.Grid[c.belt.Y][c.belt.X].ResourceNodeID != "" {
			continue
		}
		if ws.Grid[c.sorter.Y][c.sorter.X].BuildingID != "" || ws.Grid[c.sorter.Y][c.sorter.X].ResourceNodeID != "" {
			continue
		}
		if !ws.FootprintFits(c.target, fp, targetType, "") {
			continue
		}
		if footprintReserved(ws, c.target, fp) {
			continue
		}
		// 分拣器必须贴着下游占地：它的放货端扫 Range 格，正前方一格是占地内。
		next, _ := ws.SurfaceStep(c.sorter, c.dir)
		targetTiles, err := ws.FootprintTiles(c.target, fp)
		if err != nil {
			continue
		}
		inside := false
		for _, tile := range targetTiles {
			if tile.X == next.X && tile.Y == next.Y {
				inside = true
				break
			}
		}
		if !inside {
			continue
		}
		if buildingEnclosure(ws, targetType, model.PlanRotation0, c.target) != nil {
			continue
		}
		if spotCoversGroundUnit(ws, c.target, fp) {
			continue
		}
		return BeltLink{Belt: c.belt, Dir: c.dir, Sorter: c.sorter, SorterRotation: c.rot, Target: c.target}, true
	}
	return BeltLink{}, false
}

// BuildCommand 组装一条建造命令（与 POST /commands 的 body 一致）。
func BuildCommand(x, y int, btype model.BuildingType, recipeID string, dir model.ConveyorDirection) model.Command {
	payload := map[string]any{"building_type": string(btype)}
	if recipeID != "" {
		payload["recipe_id"] = recipeID
	}
	if dir != "" {
		payload["direction"] = string(dir)
	}
	return model.Command{
		Type: model.CmdBuild,
		Target: model.CommandTarget{
			Layer:    "planet",
			Position: &model.Position{X: x, Y: y},
		},
		Payload: payload,
	}
}

// BuildRotatedCommand 与 BuildCommand 相同，但带建造朝向（分拣器的取/放端由它决定：
// 背面取货、正面放货）。rotation 是角度（0/90/180/270），与 POST /commands 的
// build 载荷一致。
func BuildRotatedCommand(x, y int, btype model.BuildingType, rotation model.PlanRotation) model.Command {
	cmd := BuildCommand(x, y, btype, "", model.ConveyorAuto)
	cmd.Payload["rotation"] = planRotationDegrees(rotation)
	return cmd
}

// planRotationDegrees 把 PlanRotation 转成 build 载荷里的角度。
func planRotationDegrees(rotation model.PlanRotation) int {
	switch rotation {
	case model.PlanRotation90:
		return 90
	case model.PlanRotation180:
		return 180
	case model.PlanRotation270:
		return 270
	default:
		return 0
	}
}

// TransferCommand 组装一条「装入/取出建筑」命令。
func TransferCommand(buildingID, itemID string, quantity int, direction string) model.Command {
	payload := map[string]any{
		"building_id": buildingID,
		"item_id":     itemID,
		"quantity":    quantity,
	}
	if direction != "" {
		payload["direction"] = direction
	}
	return model.Command{
		Type:    model.CmdTransferItem,
		Target:  model.CommandTarget{Layer: "planet", EntityID: buildingID},
		Payload: payload,
	}
}

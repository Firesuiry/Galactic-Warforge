package gamecore

import (
	"fmt"
	"regexp"
	"sort"

	"siliconworld/internal/model"
)

// operatorPattern 是 issuer_id / operator 的合法形态（契约 §1）：1–64 位
// 字母、数字与 _ . : -。
var operatorPattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,64}$`)

// ValidOperatorID 报告一个发令者/操作者 ID 是否合规则。
func ValidOperatorID(id string) bool {
	return operatorPattern.MatchString(id)
}

type assignMechaPayload struct {
	Operator string `json:"operator" payload:"required,allowempty"`
}

// execAssignMecha 绑定/解绑一台本方机甲。同玩家的任何发令者都能改任何本方机甲
// 的绑定（协作关系，不设防）。
//
// 第 22 轮起取消抢占语义：绑定只写这一台档案的 Operator，不会把同 operator 的
// 其它机甲自动解绑——一个发令者可以同时绑多台（契约 §3）。
func (gc *GameCore) execAssignMecha(ws *model.WorldState, playerID string, cmd model.Command, p assignMechaPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	player := ws.Players[playerID]
	if player == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = "未找到玩家"
		return res, nil
	}
	mechaID := cmd.Target.EntityID
	if mechaID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "assign_mecha 缺少 target.entity_id"
		return res, nil
	}
	record := player.MechaByUnitID(mechaID)
	if record == nil {
		if unit := ws.Units[mechaID]; unit != nil {
			if unit.OwnerID != playerID {
				res.Code = model.CodeNotOwner
				res.Message = "不能改绑其他玩家的机甲"
				return res, nil
			}
			res.Code = model.CodeEntityNotFound
			res.Message = fmt.Sprintf("机甲 %s 没有档案", mechaID)
			return res, nil
		}
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("未找到机甲 %s", mechaID)
		return res, nil
	}
	operator := p.Operator
	if operator != "" && !ValidOperatorID(operator) {
		res.Code = model.CodeValidationFailed
		res.Message = "operator 只允许 1–64 位字母、数字与 _ . : -"
		return res, nil
	}
	record.Operator = operator
	events := []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload:         map[string]any{"mecha_id": record.UnitID, "operator": operator},
	}}
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	if operator == "" {
		res.Message = fmt.Sprintf("机甲 %s 已解绑（空闲）", record.UnitID)
	} else {
		res.Message = fmt.Sprintf("机甲 %s 已绑定给 %s", record.UnitID, operator)
	}
	return res, events
}

// execDispatchMecha 把发令者的一台机甲瞬移到 target.planet_id 指定的已加载行星
// （契约 §2；本轮不做飞行时间）。
//
// 执行者不是 handleMecha：投送时机甲还在源行星，而 handleMecha 是在路由后的
// 目标行星世界里找机甲，必然报「不在本星球」。这里自己解析：目标星球 = ws，
// 源星球 = 档案的 PlanetID。
func (gc *GameCore) execDispatchMecha(ws *model.WorldState, playerID, issuerID string, cmd model.Command, _ noPayload) (model.CommandResult, []*model.GameEvent) {
	fail := func(code model.ResultCode, message string) (model.CommandResult, []*model.GameEvent) {
		return model.CommandResult{Status: model.StatusFailed, Code: code, Message: message}, nil
	}
	if cmd.Target.PlanetID == "" {
		return fail(model.CodeValidationFailed, "dispatch_mecha 缺少 target.planet_id")
	}
	if ws == nil {
		return fail(model.CodeInvalidTarget, fmt.Sprintf("星球运行时 %s 未加载", cmd.Target.PlanetID))
	}
	player := ws.Players[playerID]
	if player == nil {
		return fail(model.CodeEntityNotFound, "未找到玩家")
	}
	// 1) 目标星球必须已被发现。
	if !gc.discovery.IsPlanetDiscovered(playerID, ws.PlanetID) {
		return fail(model.CodeValidationFailed, "目标星球未被发现")
	}

	// 2) 选中要投送的机甲：显式点名，或缺省「只有一台才自动选」。
	var record *model.MechaRecord
	if cmd.Target.MechaID != "" {
		record = player.MechaByUnitID(cmd.Target.MechaID)
		if record == nil {
			return fail(model.CodeEntityNotFound, fmt.Sprintf("未找到机甲 %s", cmd.Target.MechaID))
		}
		if record.Operator != issuerID {
			return fail(model.CodeNotOperator, fmt.Sprintf("机甲 %s 绑定给 %s，不是你", record.UnitID, record.Operator))
		}
	} else {
		bound := player.MechasByOperator(issuerID)
		switch len(bound) {
		case 0:
			return fail(model.CodeExecutorUnavailable, fmt.Sprintf("%s 还没有绑定机甲：先用 assign_mecha 接管一台（mecha list 查看）", issuerID))
		case 1:
			record = bound[0]
		default:
			return fail(model.CodeValidationFailed, fmt.Sprintf("你有 %d 台机甲，dispatch_mecha 需要 target.mecha_id 点名", len(bound)))
		}
	}

	// 3) 机甲不能已经在这颗行星上。
	sourcePlanetID := record.PlanetID
	if sourcePlanetID == ws.PlanetID {
		return fail(model.CodeValidationFailed, fmt.Sprintf("机甲 %s 已在 %s", record.UnitID, ws.PlanetID))
	}
	source := gc.WorldForPlanet(sourcePlanetID)
	if source == nil {
		return fail(model.CodeExecutorUnavailable, fmt.Sprintf("机甲 %s 所在的 %s 未加载", record.UnitID, sourcePlanetID))
	}
	unit := source.Units[record.UnitID]
	if unit == nil || unit.HP <= 0 {
		if record.RespawnAtTick > 0 {
			return fail(model.CodeExecutorUnavailable, fmt.Sprintf("机甲 %s 已阵亡，tick %d 复活", record.UnitID, record.RespawnAtTick))
		}
		return fail(model.CodeExecutorUnavailable, fmt.Sprintf("机甲 %s 已阵亡，等待复活", record.UnitID))
	}
	// 4) 有未完成作业的机甲不能投送（作业与位置强绑定）。
	if unit.Mecha != nil && unit.Mecha.Job != nil {
		return fail(model.CodeValidationFailed, fmt.Sprintf("机甲 %s 正在作业，先 cancel_mecha_job", record.UnitID))
	}

	// 5) 落点：本方基站旁 → 行星中心附近 → 都没有则拒绝。
	pos := dispatchLandingTile(ws, playerID)
	if pos == nil {
		return fail(model.CodeValidationFailed, fmt.Sprintf("%s 上没有机甲落点", ws.PlanetID))
	}

	// 6) 从源世界摘除，在目标世界用同一个 unit ID 重建（满血满能量、空作业）。
	removeUnitFromTile(source, model.TileKey(unit.Position.X, unit.Position.Y), unit.ID)
	delete(source.Units, unit.ID)
	record.PlanetID = ws.PlanetID
	stats := model.UnitStats(model.UnitTypeExecutor)
	dispatched := &stats
	dispatched.ID = record.UnitID
	dispatched.OwnerID = playerID
	dispatched.Position = *pos
	model.SyncMechaCapabilities(dispatched, player)
	ws.Units[dispatched.ID] = dispatched
	key := model.TileKey(pos.X, pos.Y)
	ws.TileUnits[key] = append(ws.TileUnits[key], dispatched.ID)

	return model.CommandResult{
			Status:  model.StatusExecuted,
			Code:    model.CodeOK,
			Message: fmt.Sprintf("机甲 %s 已投送到 %s", record.UnitID, ws.PlanetID),
		}, []*model.GameEvent{{
			EventType:       model.EvtEntityUpdated,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"entity_type":    "mecha",
				"mecha_id":       record.UnitID,
				"planet_id":      ws.PlanetID,
				"from_planet_id": sourcePlanetID,
			},
		}}
}

// dispatchLandingTile 在目标行星上找投送落点：本方基站旁（多个基站按 ID 升序试），
// 没有基站时用行星中心附近的空地；都找不到返回 nil。
func dispatchLandingTile(ws *model.WorldState, playerID string) *model.Position {
	if ws == nil {
		return nil
	}
	var hqs []*model.Building
	for _, b := range ws.Buildings {
		if b != nil && b.OwnerID == playerID && b.HP > 0 && b.Type == model.BuildingTypeBattlefieldAnalysisBase {
			hqs = append(hqs, b)
		}
	}
	sort.Slice(hqs, func(i, j int) bool { return hqs[i].ID < hqs[j].ID })
	for _, hq := range hqs {
		if pos := findUnitSpawnTile(ws, hq.Position, false, unitSpawnRadius); pos != nil {
			return pos
		}
	}
	center := model.Position{X: ws.MapWidth / 2, Y: ws.MapHeight / 2}
	pos := findNearestOpenTile(ws, center)
	if !dispatchTileUsable(ws, pos) {
		return nil
	}
	return &pos
}

// dispatchTileUsable 报告一格是否真的能站一台地面单位。
func dispatchTileUsable(ws *model.WorldState, pos model.Position) bool {
	if ws == nil || !ws.InBounds(pos.X, pos.Y) {
		return false
	}
	if !ws.Grid[pos.Y][pos.X].Terrain.Buildable() {
		return false
	}
	if ws.TileBuilding[model.TileKey(pos.X, pos.Y)] != "" {
		return false
	}
	return !tileHasLiveUnit(ws, pos, false)
}

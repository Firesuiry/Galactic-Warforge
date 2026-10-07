package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

type taskForceCreatePayload struct {
	TaskForceID string                   `json:"task_force_id" payload:"required"`
	Name        string                   `json:"name"`
	Stance      model.WarTaskForceStance `json:"stance"`
}

type taskForceAssignPayload struct {
	TaskForceID string   `json:"task_force_id" payload:"required"`
	MemberKind  string   `json:"member_kind" payload:"required"`
	MemberIDs   []string `json:"member_ids" payload:"required"`
}

type taskForceSetStancePayload struct {
	TaskForceID string `json:"task_force_id" payload:"required"`
	Stance      string `json:"stance" payload:"required"`
}

type taskForceDeployPayload struct {
	TaskForceID string                     `json:"task_force_id" payload:"required"`
	TheaterID   string                     `json:"theater_id"`
	SystemID    string                     `json:"system_id"`
	PlanetID    string                     `json:"planet_id"`
	Position    *positionPayload           `json:"position"`
	FrontlineID string                     `json:"frontline_id"`
	GroundOrder model.GroundTaskForceOrder `json:"ground_order"`
	SupportMode model.OrbitalSupportMode   `json:"support_mode"`
}

type theaterCreatePayload struct {
	TheaterID string `json:"theater_id" payload:"required"`
	Name      string `json:"name"`
}

type theaterDefineZonePayload struct {
	TheaterID string           `json:"theater_id" payload:"required"`
	ZoneType  string           `json:"zone_type" payload:"required"`
	SystemID  string           `json:"system_id"`
	PlanetID  string           `json:"planet_id"`
	Position  *positionPayload `json:"position"`
	Radius    int              `json:"radius"`
}

type theaterSetObjectivePayload struct {
	TheaterID     string `json:"theater_id" payload:"required"`
	ObjectiveType string `json:"objective_type" payload:"required"`
	SystemID      string `json:"system_id"`
	PlanetID      string `json:"planet_id"`
	EntityID      string `json:"entity_id"`
	Description   string `json:"description"`
}

// positionPayload 是载荷里的地表坐标；x、y 必填。
type positionPayload struct {
	X *int `json:"x" payload:"required"`
	Y *int `json:"y" payload:"required"`
	Z int  `json:"z"`
}

func (p *positionPayload) toPosition() *model.Position {
	if p == nil {
		return nil
	}
	return &model.Position{X: *p.X, Y: *p.Y, Z: p.Z}
}

func (gc *GameCore) execTaskForceCreate(ws *model.WorldState, playerID string, cmd model.Command, p taskForceCreatePayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	taskForceID := p.TaskForceID

	player := ws.Players[playerID]
	if player == nil {
		res.Code = model.CodeUnauthorized
		res.Message = "未找到玩家"
		return res, nil
	}
	coordination := player.EnsureWarCoordination()
	if coordination.TaskForces[taskForceID] != nil {
		res.Code = model.CodeDuplicate
		res.Message = fmt.Sprintf("编队 %s 已存在", taskForceID)
		return res, nil
	}

	stance := model.WarTaskForceStanceHold
	if p.Stance != "" {
		stance = p.Stance
	}
	if !model.ValidWarTaskForceStance(stance) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("无效的编队姿态：%s", stance)
		return res, nil
	}

	taskForce := &model.WarTaskForce{
		ID:          taskForceID,
		OwnerID:     playerID,
		Stance:      stance,
		CreatedTick: ws.Tick,
		UpdatedTick: ws.Tick,
	}
	taskForce.Name = p.Name
	coordination.TaskForces[taskForceID] = taskForce

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("已创建编队 %s", taskForceID)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityCreated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "task_force",
			"entity_id":   taskForceID,
			"task_force":  taskForce,
		},
	}}
}

func (gc *GameCore) execTaskForceAssign(ws *model.WorldState, playerID string, cmd model.Command, p taskForceAssignPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	taskForceID := p.TaskForceID
	kindRaw := p.MemberKind
	memberKind := model.WarTaskForceMemberKind(kindRaw)
	if !model.ValidWarTaskForceMemberKind(memberKind) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("无效的编队成员类型：%s", memberKind)
		return res, nil
	}
	memberIDs := p.MemberIDs

	player := ws.Players[playerID]
	if player == nil {
		res.Code = model.CodeUnauthorized
		res.Message = "未找到玩家"
		return res, nil
	}
	coordination := player.EnsureWarCoordination()
	taskForce := coordination.TaskForces[taskForceID]
	if taskForce == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("未找到编队 %s", taskForceID)
		return res, nil
	}

	for _, memberID := range memberIDs {
		if err := gc.requireTaskForceMemberOwnership(ws, playerID, memberKind, memberID); err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = err.Error()
			return res, nil
		}
		if current := model.FindWarTaskForceByMember(player, memberKind, memberID); current != nil {
			current.Members = removeTaskForceMember(current.Members, memberKind, memberID)
			current.UpdatedTick = ws.Tick
		}
		if !taskForceHasMember(taskForce, memberKind, memberID) {
			taskForce.Members = append(taskForce.Members, model.WarTaskForceMemberRef{
				Kind:     memberKind,
				EntityID: memberID,
			})
		}
	}
	taskForce.UpdatedTick = ws.Tick

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("编队 %s 已分配 %d 名成员", taskForceID, len(memberIDs))
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "task_force",
			"entity_id":   taskForceID,
			"task_force":  taskForce,
		},
	}}
}

func (gc *GameCore) execTaskForceSetStance(ws *model.WorldState, playerID string, cmd model.Command, p taskForceSetStancePayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	taskForceID := p.TaskForceID
	stanceRaw := p.Stance
	stance := model.WarTaskForceStance(stanceRaw)
	if !model.ValidWarTaskForceStance(stance) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("无效的编队姿态：%s", stance)
		return res, nil
	}
	player := ws.Players[playerID]
	if player == nil || player.WarCoordination == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("未找到编队 %s", taskForceID)
		return res, nil
	}
	taskForce := player.WarCoordination.TaskForces[taskForceID]
	if taskForce == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("未找到编队 %s", taskForceID)
		return res, nil
	}
	taskForce.Stance = stance
	taskForce.UpdatedTick = ws.Tick

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("编队 %s 姿态已设为 %s", taskForceID, stance)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "task_force",
			"entity_id":   taskForceID,
			"task_force":  taskForce,
		},
	}}
}

func (gc *GameCore) execTaskForceDeploy(ws *model.WorldState, playerID string, cmd model.Command, p taskForceDeployPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	taskForceID := p.TaskForceID
	player := ws.Players[playerID]
	if player == nil || player.WarCoordination == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("未找到编队 %s", taskForceID)
		return res, nil
	}
	taskForce := player.WarCoordination.TaskForces[taskForceID]
	if taskForce == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("未找到编队 %s", taskForceID)
		return res, nil
	}

	deployment := &model.WarTaskForceDeployment{}
	deployment.SystemID = p.SystemID
	deployment.PlanetID = p.PlanetID
	deployment.Position = p.Position.toPosition()
	deployment.FrontlineID = p.FrontlineID
	if p.GroundOrder != "" {
		deployment.GroundOrder = p.GroundOrder
		if !model.ValidGroundTaskForceOrder(deployment.GroundOrder) {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("无效的地面指令：%s", p.GroundOrder)
			return res, nil
		}
	}
	if p.SupportMode != "" {
		deployment.OrbitalSupportMode = p.SupportMode
		if !model.ValidOrbitalSupportMode(deployment.OrbitalSupportMode) {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("无效的轨道支援模式：%s", p.SupportMode)
			return res, nil
		}
	}
	if deployment.SystemID == "" && deployment.PlanetID == "" && deployment.Position == nil && deployment.FrontlineID == "" && deployment.GroundOrder == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "task_force_deploy 至少需要一个目标字段"
		return res, nil
	}
	if theaterID := p.TheaterID; theaterID != "" {
		theater := player.WarCoordination.Theaters[theaterID]
		if theater == nil {
			res.Code = model.CodeEntityNotFound
			res.Message = fmt.Sprintf("未找到战区 %s", theaterID)
			return res, nil
		}
		taskForce.TheaterID = theaterID
	}
	taskForce.Deployment = deployment
	taskForce.UpdatedTick = ws.Tick

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("编队 %s 部署已更新", taskForceID)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "task_force",
			"entity_id":   taskForceID,
			"task_force":  taskForce,
		},
	}}
}

func (gc *GameCore) execTheaterCreate(ws *model.WorldState, playerID string, cmd model.Command, p theaterCreatePayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	theaterID := p.TheaterID
	player := ws.Players[playerID]
	if player == nil {
		res.Code = model.CodeUnauthorized
		res.Message = "未找到玩家"
		return res, nil
	}
	coordination := player.EnsureWarCoordination()
	if coordination.Theaters[theaterID] != nil {
		res.Code = model.CodeDuplicate
		res.Message = fmt.Sprintf("战区 %s 已存在", theaterID)
		return res, nil
	}
	theater := &model.WarTheater{
		ID:          theaterID,
		OwnerID:     playerID,
		CreatedTick: ws.Tick,
		UpdatedTick: ws.Tick,
	}
	theater.Name = p.Name
	coordination.Theaters[theaterID] = theater

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("已创建战区 %s", theaterID)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityCreated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "theater",
			"entity_id":   theaterID,
			"theater":     theater,
		},
	}}
}

func (gc *GameCore) execTheaterDefineZone(ws *model.WorldState, playerID string, cmd model.Command, p theaterDefineZonePayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	theaterID := p.TheaterID
	zoneTypeRaw := p.ZoneType
	zoneType := model.WarTheaterZoneType(zoneTypeRaw)
	if !model.ValidWarTheaterZoneType(zoneType) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("无效的战区区域类型：%s", zoneType)
		return res, nil
	}
	player := ws.Players[playerID]
	if player == nil || player.WarCoordination == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("未找到战区 %s", theaterID)
		return res, nil
	}
	theater := player.WarCoordination.Theaters[theaterID]
	if theater == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("未找到战区 %s", theaterID)
		return res, nil
	}

	zone := model.WarTheaterZone{ZoneType: zoneType}
	zone.SystemID = p.SystemID
	zone.PlanetID = p.PlanetID
	zone.Position = p.Position.toPosition()
	zone.Radius = p.Radius

	replaced := false
	for index := range theater.Zones {
		if theater.Zones[index].ZoneType == zone.ZoneType {
			theater.Zones[index] = zone
			replaced = true
			break
		}
	}
	if !replaced {
		theater.Zones = append(theater.Zones, zone)
	}
	theater.UpdatedTick = ws.Tick

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("战区 %s 的区域 %s 已更新", theaterID, zoneType)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "theater",
			"entity_id":   theaterID,
			"theater":     theater,
		},
	}}
}

func (gc *GameCore) execTheaterSetObjective(ws *model.WorldState, playerID string, cmd model.Command, p theaterSetObjectivePayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	theaterID := p.TheaterID
	objectiveType := p.ObjectiveType
	player := ws.Players[playerID]
	if player == nil || player.WarCoordination == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("未找到战区 %s", theaterID)
		return res, nil
	}
	theater := player.WarCoordination.Theaters[theaterID]
	if theater == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("未找到战区 %s", theaterID)
		return res, nil
	}

	objective := &model.WarTheaterObjective{ObjectiveType: objectiveType}
	objective.SystemID = p.SystemID
	objective.PlanetID = p.PlanetID
	objective.EntityID = p.EntityID
	objective.Description = p.Description
	theater.Objective = objective
	theater.UpdatedTick = ws.Tick

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("战区 %s 目标已更新", theaterID)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "theater",
			"entity_id":   theaterID,
			"theater":     theater,
		},
	}}
}

func (gc *GameCore) requireTaskForceMemberOwnership(ws *model.WorldState, playerID string, kind model.WarTaskForceMemberKind, entityID string) error {
	switch kind {
	case model.WarTaskForceMemberKindSquad:
		for _, world := range gc.worlds {
			if world == nil || world.CombatRuntime == nil {
				continue
			}
			squad := world.CombatRuntime.Squads[entityID]
			if squad == nil {
				continue
			}
			if squad.OwnerID != playerID {
				return fmt.Errorf("作战小队 %s 不属于 %s", entityID, playerID)
			}
			return nil
		}
		return fmt.Errorf("未找到作战小队 %s", entityID)
	case model.WarTaskForceMemberKindFleet:
		_, fleet := findOwnedFleet(gc.spaceRuntime, playerID, entityID)
		if fleet == nil {
			return fmt.Errorf("未找到舰队 %s", entityID)
		}
		return nil
	default:
		return fmt.Errorf("无效的编队成员类型：%s", kind)
	}
}

func taskForceHasMember(taskForce *model.WarTaskForce, kind model.WarTaskForceMemberKind, entityID string) bool {
	if taskForce == nil {
		return false
	}
	for _, member := range taskForce.Members {
		if member.Kind == kind && member.EntityID == entityID {
			return true
		}
	}
	return false
}

func removeTaskForceMember(members []model.WarTaskForceMemberRef, kind model.WarTaskForceMemberKind, entityID string) []model.WarTaskForceMemberRef {
	if len(members) == 0 {
		return members
	}
	out := make([]model.WarTaskForceMemberRef, 0, len(members))
	for _, member := range members {
		if member.Kind == kind && member.EntityID == entityID {
			continue
		}
		out = append(out, member)
	}
	return out
}

package gamecore

import (
	"reflect"
	"sort"

	"siliconworld/internal/model"
)

const (
	mechaMineTicks = 10
	// mechaMineEnergy 手动采集每件耗能（1 块煤补 25，采煤净赚能量）。
	mechaMineEnergy = 3
	// mechaCraftEnergyDivisor 手搓每批耗能 = 配方时长 / 该值（下限 1），如铁块 60 tick 耗 3。
	mechaCraftEnergyDivisor = 20
)

// mechaCraftEnergy 手搓一批的耗能。
func mechaCraftEnergy(recipe model.RecipeDefinition) int {
	return max(1, recipe.Duration/mechaCraftEnergyDivisor)
}

func mechaJobTarget(ws *model.WorldState, playerID string, cmd model.Command) (*model.Unit, *model.PlayerState, model.CommandResult) {
	fail := func(code model.ResultCode, message string) (*model.Unit, *model.PlayerState, model.CommandResult) {
		return nil, nil, model.CommandResult{Status: model.StatusFailed, Code: code, Message: message}
	}
	unit := ws.Units[cmd.Target.EntityID]
	if unit == nil {
		return fail(model.CodeEntityNotFound, "未找到机甲单位")
	}
	if unit.OwnerID != playerID {
		return fail(model.CodeNotOwner, "不能操作其他玩家的机甲")
	}
	if unit.Type != model.UnitTypeExecutor || unit.HP <= 0 {
		return fail(model.CodeInvalidTarget, "作业需要存活的玩家机甲")
	}
	player := ws.Players[playerID]
	if player == nil {
		return fail(model.CodeEntityNotFound, "未找到玩家")
	}
	model.SyncMechaCapabilities(unit, player)
	return unit, player, model.CommandResult{}
}

func mechaJobFailed(code model.ResultCode, message string) (model.CommandResult, []*model.GameEvent) {
	return model.CommandResult{Status: model.StatusFailed, Code: code, Message: message}, nil
}

func manualMineItem(node *model.ResourceNodeState) (string, bool) {
	if node == nil {
		return "", false
	}
	item, ok := model.Item(node.Kind)
	return node.Kind, ok && item.Form == model.ResourceSolid &&
		(node.Behavior == "finite" || node.Behavior == "renewable")
}

type mineResourcePayload struct {
	ResourceID string `json:"resource_id" payload:"required"`
	Quantity   int    `json:"quantity" payload:"required"`
}

func (gc *GameCore) execMineResource(ws *model.WorldState, playerID string, cmd model.Command, p mineResourcePayload) (model.CommandResult, []*model.GameEvent) {
	unit, _, failure := mechaJobTarget(ws, playerID, cmd)
	if unit == nil {
		return failure, nil
	}
	if unit.Mecha.Job != nil {
		return mechaJobFailed(model.CodeInvalidTarget, "机甲已有作业，请先取消")
	}
	resourceID, quantity := p.ResourceID, p.Quantity
	if quantity <= 0 {
		return mechaJobFailed(model.CodeValidationFailed, "payload.quantity 必须为正整数")
	}
	node := ws.Resources[resourceID]
	if node == nil {
		return mechaJobFailed(model.CodeEntityNotFound, "未找到资源节点")
	}
	if _, ok := manualMineItem(node); !ok {
		return mechaJobFailed(model.CodeInvalidTarget, "只能手动采集固体资源节点")
	}
	if ws.SurfaceDistance(unit.Position, node.Position) > 2 {
		return mechaJobFailed(model.CodeOutOfRange, "资源须在 2 格地表范围内")
	}
	if node.Remaining < quantity {
		return mechaJobFailed(model.CodeInsufficientResource, "资源节点剩余量少于请求数量")
	}
	unit.Mecha.Job = &model.MechaJob{Kind: "mine", ResourceID: resourceID, RemainingTicks: mechaMineTicks, TicksPerBatch: mechaMineTicks, RemainingBatches: quantity, EnergyPerBatch: mechaMineEnergy, State: "running"}
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "已开始手动采集"}, []*model.GameEvent{mechaStateEvent(unit)}
}

type craftItemPayload struct {
	RecipeID string `json:"recipe_id" payload:"required"`
	Quantity int    `json:"quantity" payload:"required"`
}

func (gc *GameCore) execCraftItem(ws *model.WorldState, playerID string, cmd model.Command, p craftItemPayload) (model.CommandResult, []*model.GameEvent) {
	unit, player, failure := mechaJobTarget(ws, playerID, cmd)
	if unit == nil {
		return failure, nil
	}
	if unit.Mecha.Job != nil {
		return mechaJobFailed(model.CodeInvalidTarget, "机甲已有作业，请先取消")
	}
	recipeID, quantity := p.RecipeID, p.Quantity
	if quantity <= 0 {
		return mechaJobFailed(model.CodeValidationFailed, "payload.quantity 必须为正整数")
	}
	recipe, ok := model.Recipe(recipeID)
	if !ok || !recipe.HandcraftAllowed {
		return mechaJobFailed(model.CodeInvalidTarget, "该配方不可手工制造")
	}
	if !CanUseRecipeTech(player, recipeID) {
		return mechaJobFailed(model.CodeValidationFailed, "配方需先研究解锁")
	}
	reserved := make([]model.ItemAmount, 0, len(recipe.Inputs))
	maxInt := int(^uint(0) >> 1)
	for _, item := range append(append([]model.ItemAmount(nil), recipe.Inputs...), recipe.AllOutputs()...) {
		def, exists := model.Item(item.ItemID)
		if !exists || def.Form != model.ResourceSolid {
			return mechaJobFailed(model.CodeInvalidTarget, "手工制造的输入和输出必须为固体")
		}
		if item.Quantity <= 0 || quantity > maxInt/item.Quantity {
			return mechaJobFailed(model.CodeValidationFailed, "批量数量过大")
		}
	}
	for _, item := range recipe.Inputs {
		reserved = append(reserved, model.ItemAmount{ItemID: item.ItemID, Quantity: item.Quantity * quantity})
	}
	if !player.DeductItems(reserved) {
		return mechaJobFailed(model.CodeInsufficientResource, "玩家背包中缺少手工制造原料")
	}
	// 手搓是机甲个人作业，不受工厂产出节奏 pace_output 影响。
	duration := recipe.Duration
	unit.Mecha.Job = &model.MechaJob{Kind: "craft", RecipeID: recipeID, RemainingTicks: duration, TicksPerBatch: duration, RemainingBatches: quantity, EnergyPerBatch: mechaCraftEnergy(recipe), State: "running", ReservedInputs: reserved}
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "已开始手工制造，原料已预留"}, []*model.GameEvent{mechaStateEvent(unit)}
}

// refundMechaJob is shared by explicit cancellation and all unit death paths.
// Clearing the job makes the refund idempotent; completed batches have already
// removed their ingredients from ReservedInputs.
func refundMechaJob(ws *model.WorldState, unit *model.Unit) {
	if unit == nil || unit.Mecha == nil || unit.Mecha.Job == nil {
		return
	}
	if player := ws.Players[unit.OwnerID]; player != nil {
		player.AddItems(unit.Mecha.Job.ReservedInputs)
	}
	unit.Mecha.Job = nil
}

func (gc *GameCore) execCancelMechaJob(ws *model.WorldState, playerID string, cmd model.Command, p noPayload) (model.CommandResult, []*model.GameEvent) {
	unit, _, failure := mechaJobTarget(ws, playerID, cmd)
	if unit == nil {
		return failure, nil
	}
	if unit.Mecha.Job == nil {
		return mechaJobFailed(model.CodeInvalidTarget, "机甲没有进行中的作业")
	}
	refundMechaJob(ws, unit)
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "机甲作业已取消，未完成部分的原料已退回"}, []*model.GameEvent{mechaStateEvent(unit)}
}

func settleMechaJobs(ws *model.WorldState) []*model.GameEvent {
	var events []*model.GameEvent
	ids := make([]string, 0, len(ws.Units))
	for id := range ws.Units {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		unit := ws.Units[id]
		if unit == nil || unit.Type != model.UnitTypeExecutor || unit.Mecha == nil || unit.Mecha.Job == nil {
			continue
		}
		player := ws.Players[unit.OwnerID]
		if player == nil {
			continue
		}
		before := unit.Mecha.Clone()
		if unit.HP <= 0 {
			refundMechaJob(ws, unit)
		} else {
			events = append(events, advanceMechaJob(ws, unit, player)...)
		}
		if !reflect.DeepEqual(before, unit.Mecha) {
			events = append(events, mechaStateEvent(unit))
		}
	}
	return events
}

func advanceMechaJob(ws *model.WorldState, unit *model.Unit, player *model.PlayerState) []*model.GameEvent {
	job := unit.Mecha.Job
	// 被自动防御暂停的手搓：保留进度与预留原料，等威胁消失后由交战结算恢复。
	if job.Paused {
		return nil
	}
	var node *model.ResourceNodeState
	var recipe model.RecipeDefinition
	switch job.Kind {
	case "mine":
		node = ws.Resources[job.ResourceID]
		if _, ok := manualMineItem(node); !ok || node.Remaining <= 0 {
			refundMechaJob(ws, unit)
			return nil
		}
		if ws.SurfaceDistance(unit.Position, node.Position) > 2 {
			job.State = "out_of_range"
			return nil
		}
	case "craft":
		var ok bool
		recipe, ok = model.Recipe(job.RecipeID)
		if !ok || !recipe.HandcraftAllowed {
			refundMechaJob(ws, unit)
			return nil
		}
	default:
		refundMechaJob(ws, unit)
		return nil
	}
	if job.RemainingTicks >= job.TicksPerBatch {
		// 每批开工时一次性扣能；不足则暂停，补能后继续。
		if unit.Mecha.Energy < job.EnergyPerBatch {
			job.State = "no_energy"
			return nil
		}
		unit.Mecha.Energy -= job.EnergyPerBatch
	}
	job.State = "running"
	job.RemainingTicks--
	if job.RemainingTicks > 0 {
		return nil
	}
	var output []model.ItemAmount
	if job.Kind == "mine" {
		node.Remaining--
		node.SyncDepleted()
		output = []model.ItemAmount{{ItemID: node.Kind, Quantity: 1}}
	} else {
		output = append([]model.ItemAmount(nil), recipe.AllOutputs()...)
		for i := range job.ReservedInputs {
			for _, item := range recipe.Inputs {
				if item.ItemID == job.ReservedInputs[i].ItemID {
					job.ReservedInputs[i].Quantity -= item.Quantity
				}
			}
		}
	}
	player.AddItems(output)
	job.CompletedBatches++
	job.RemainingBatches--
	job.RemainingTicks = job.TicksPerBatch
	payload := map[string]any{"entity_id": unit.ID, "items": output, "job_kind": job.Kind, "completed_batches": job.CompletedBatches}
	if node != nil {
		payload["resource_id"], payload["remaining"] = node.ID, node.Remaining
	}
	if job.RemainingBatches <= 0 || (node != nil && node.Remaining <= 0) {
		unit.Mecha.Job = nil
	}
	return []*model.GameEvent{{EventType: model.EvtResourceChanged, VisibilityScope: unit.OwnerID, Payload: payload}}
}

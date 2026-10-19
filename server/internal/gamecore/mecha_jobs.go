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

func (gc *GameCore) execMineResource(ws *model.WorldState, playerID string, cmd model.Command, p mineResourcePayload, mecha mechaContext) (model.CommandResult, []*model.GameEvent) {
	unit := mecha.Unit
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
	// 细分网格：距离类数值整体 ×3，采集判定半径由 2 格放宽到 6 格，
	// 与 bot 的 botMineKind 移动阈值保持一致，否则执行器永远停在判定圈外。
	if ws.SurfaceDistance(unit.Position, node.Position) > 6 {
		return mechaJobFailed(model.CodeOutOfRange, "资源须在 6 格地表范围内")
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

func (gc *GameCore) execCraftItem(ws *model.WorldState, playerID string, cmd model.Command, p craftItemPayload, mecha mechaContext) (model.CommandResult, []*model.GameEvent) {
	unit, player, record := mecha.Unit, mecha.Player, mecha.Record
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
	if !record.DeductItems(reserved) {
		return mechaJobFailed(model.CodeInsufficientResource, "机甲背包中缺少手工制造原料")
	}
	// 手搓是机甲个人作业，不受工厂产出节奏 pace_output 影响。
	duration := recipe.Duration
	unit.Mecha.Job = &model.MechaJob{Kind: "craft", RecipeID: recipeID, RemainingTicks: duration, TicksPerBatch: duration, RemainingBatches: quantity, EnergyPerBatch: mechaCraftEnergy(recipe), State: "running", ReservedInputs: reserved}
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "已开始手工制造，原料已预留"}, []*model.GameEvent{mechaStateEvent(unit)}
}

// refundMechaJob is shared by explicit cancellation and all unit death paths.
// Clearing the job makes the refund idempotent; completed batches have already
// removed their ingredients from ReservedInputs. 退款同样受背包上限约束：
// 取消/阵亡时背包已满的话，未完成批次的原料直接丢失（背包永远不会超上限）。
func refundMechaJob(ws *model.WorldState, unit *model.Unit) {
	if unit == nil || unit.Mecha == nil || unit.Mecha.Job == nil {
		return
	}
	if player := ws.Players[unit.OwnerID]; player != nil {
		if record := player.MechaByUnitID(unit.ID); record != nil {
			record.AddItems(unit.Mecha.Job.ReservedInputs, mechaInventorySlots(player))
		}
	}
	unit.Mecha.Job = nil
}

func (gc *GameCore) execCancelMechaJob(ws *model.WorldState, playerID string, cmd model.Command, p noPayload, mecha mechaContext) (model.CommandResult, []*model.GameEvent) {
	unit := mecha.Unit
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
		record := mechaRecordForUnit(ws, unit)
		if player == nil || record == nil {
			continue
		}
		before := unit.Mecha.Clone()
		if unit.HP <= 0 {
			refundMechaJob(ws, unit)
		} else {
			events = append(events, advanceMechaJob(ws, unit, record, player)...)
		}
		if !reflect.DeepEqual(before, unit.Mecha) {
			events = append(events, mechaStateEvent(unit))
		}
	}
	return events
}

func advanceMechaJob(ws *model.WorldState, unit *model.Unit, record *model.MechaRecord, player *model.PlayerState) []*model.GameEvent {
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
		// 细分网格：判定半径随距离类数值 ×3 放宽到 6 格，与 execMineResource 一致。
		if ws.SurfaceDistance(unit.Position, node.Position) > 6 {
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
	var output []model.ItemAmount
	if job.Kind == "mine" {
		output = []model.ItemAmount{{ItemID: node.Kind, Quantity: 1}}
	} else {
		output = append([]model.ItemAmount(nil), recipe.AllOutputs()...)
	}
	slots := mechaInventorySlots(player)
	if job.RemainingTicks >= job.TicksPerBatch {
		// 每批开工前先确认背包装得下整批产出（按格计：每件物品折算 ceil(数量/
		// stack_limit) 格），装不下就停在这里等腾空，既不扣能也不推进；否则背包
		// 满时每批都会白扣一份核心能量却毫无产出。绝不允许绕过格数上限把背包顶满
		// （试玩 1014：手搓产出无视上限，背包 200/200 时搓出 1 个磁铁变成 201/200）。
		if need := itemAmountTotal(output); mechaInventoryFree(record, slots, output[0].ItemID, need) < need {
			job.State = "inventory_full"
			return nil
		}
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
	// 兜底：批内背包被塞满时本批不结算（节点/原料都不动，进度保留），
	// 玩家腾出空位后自动继续，产出与原料都不会丢。
	accepted := record.AddItems(output, slots)
	if accepted < itemAmountTotal(output) {
		job.State = "inventory_full"
		return []*model.GameEvent{{EventType: model.EvtResourceChanged, VisibilityScope: unit.OwnerID, Payload: map[string]any{
			"entity_id": unit.ID, "items": output, "job_kind": job.Kind,
			"completed_batches": job.CompletedBatches, "blocked": "inventory_full",
			"inventory_slots_used": record.Inventory.SlotsUsed(), "inventory_slots_total": slots,
		}}}
	}
	// 入包成功才结算本批：消耗矿点余量、扣减预留原料。
	if job.Kind == "mine" {
		node.Remaining--
		node.SyncDepleted()
	} else {
		for i := range job.ReservedInputs {
			for _, item := range recipe.Inputs {
				if item.ItemID == job.ReservedInputs[i].ItemID {
					job.ReservedInputs[i].Quantity -= item.Quantity
				}
			}
		}
	}
	job.State = "running"
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

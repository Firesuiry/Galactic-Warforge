package gamecore

import (
	"reflect"
	"sort"

	"siliconworld/internal/model"
)

const mechaMineTicks = 10

func mechaJobTarget(ws *model.WorldState, playerID string, cmd model.Command) (*model.Unit, *model.PlayerState, model.CommandResult) {
	fail := func(code model.ResultCode, message string) (*model.Unit, *model.PlayerState, model.CommandResult) {
		return nil, nil, model.CommandResult{Status: model.StatusFailed, Code: code, Message: message}
	}
	unit := ws.Units[cmd.Target.EntityID]
	if unit == nil {
		return fail(model.CodeEntityNotFound, "mecha unit not found")
	}
	if unit.OwnerID != playerID {
		return fail(model.CodeNotOwner, "cannot operate another player's mecha")
	}
	if unit.Type != model.UnitTypeExecutor || unit.HP <= 0 {
		return fail(model.CodeInvalidTarget, "job requires a living player executor")
	}
	player := ws.Players[playerID]
	if player == nil {
		return fail(model.CodeEntityNotFound, "player not found")
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
	return node.Kind, ok && item.Form == model.ResourceSolid && node.Behavior == "finite"
}

func (gc *GameCore) execMineResource(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	unit, _, failure := mechaJobTarget(ws, playerID, cmd)
	if unit == nil {
		return failure, nil
	}
	if unit.Mecha.Job != nil {
		return mechaJobFailed(model.CodeInvalidTarget, "mecha already has a job; cancel it first")
	}
	resourceID, err := payloadStrictString(cmd.Payload, "resource_id")
	if err != nil {
		return mechaJobFailed(model.CodeValidationFailed, err.Error())
	}
	quantity, err := payloadStrictInt(cmd.Payload, "quantity")
	if err != nil || quantity <= 0 {
		return mechaJobFailed(model.CodeValidationFailed, "payload.quantity must be a positive integer")
	}
	node := ws.Resources[resourceID]
	if node == nil {
		return mechaJobFailed(model.CodeEntityNotFound, "resource node not found")
	}
	if _, ok := manualMineItem(node); !ok {
		return mechaJobFailed(model.CodeInvalidTarget, "only finite solid resource nodes can be mined by hand")
	}
	if ws.SurfaceDistance(unit.Position, node.Position) > 2 {
		return mechaJobFailed(model.CodeOutOfRange, "resource must be within 2 surface tiles")
	}
	if node.Remaining < quantity {
		return mechaJobFailed(model.CodeInsufficientResource, "resource node has fewer items remaining than requested")
	}
	unit.Mecha.Job = &model.MechaJob{Kind: "mine", ResourceID: resourceID, RemainingTicks: mechaMineTicks, TicksPerBatch: mechaMineTicks, RemainingBatches: quantity, EnergyPerTick: 1, State: "running"}
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "manual mining started"}, []*model.GameEvent{mechaStateEvent(unit)}
}

func (gc *GameCore) execCraftItem(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	unit, player, failure := mechaJobTarget(ws, playerID, cmd)
	if unit == nil {
		return failure, nil
	}
	if unit.Mecha.Job != nil {
		return mechaJobFailed(model.CodeInvalidTarget, "mecha already has a job; cancel it first")
	}
	recipeID, err := payloadStrictString(cmd.Payload, "recipe_id")
	if err != nil {
		return mechaJobFailed(model.CodeValidationFailed, err.Error())
	}
	quantity, err := payloadStrictInt(cmd.Payload, "quantity")
	if err != nil || quantity <= 0 {
		return mechaJobFailed(model.CodeValidationFailed, "payload.quantity must be a positive integer")
	}
	recipe, ok := model.Recipe(recipeID)
	if !ok || !recipe.HandcraftAllowed {
		return mechaJobFailed(model.CodeInvalidTarget, "recipe is not available for handcrafting")
	}
	if !CanUseRecipeTech(player, recipeID) {
		return mechaJobFailed(model.CodeValidationFailed, "recipe requires research to unlock")
	}
	reserved := make([]model.ItemAmount, 0, len(recipe.Inputs))
	maxInt := int(^uint(0) >> 1)
	for _, item := range append(append([]model.ItemAmount(nil), recipe.Inputs...), recipe.AllOutputs()...) {
		def, exists := model.Item(item.ItemID)
		if !exists || def.Form != model.ResourceSolid {
			return mechaJobFailed(model.CodeInvalidTarget, "handcrafting requires solid inputs and outputs")
		}
		if item.Quantity <= 0 || quantity > maxInt/item.Quantity {
			return mechaJobFailed(model.CodeValidationFailed, "batch quantity is too large")
		}
	}
	for _, item := range recipe.Inputs {
		reserved = append(reserved, model.ItemAmount{ItemID: item.ItemID, Quantity: item.Quantity * quantity})
	}
	if !player.DeductItems(reserved) {
		return mechaJobFailed(model.CodeInsufficientResource, "missing handcraft ingredients in player inventory")
	}
	duration := max(1, recipe.Duration)
	unit.Mecha.Job = &model.MechaJob{Kind: "craft", RecipeID: recipeID, RemainingTicks: duration, TicksPerBatch: duration, RemainingBatches: quantity, EnergyPerTick: 1, State: "running", ReservedInputs: reserved}
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "handcrafting started; ingredients reserved"}, []*model.GameEvent{mechaStateEvent(unit)}
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

func (gc *GameCore) execCancelMechaJob(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	unit, _, failure := mechaJobTarget(ws, playerID, cmd)
	if unit == nil {
		return failure, nil
	}
	if unit.Mecha.Job == nil {
		return mechaJobFailed(model.CodeInvalidTarget, "mecha has no active job")
	}
	refundMechaJob(ws, unit)
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "mecha job cancelled; uncompleted ingredients returned"}, []*model.GameEvent{mechaStateEvent(unit)}
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
	if unit.Mecha.Energy < job.EnergyPerTick {
		job.State = "no_energy"
		return nil
	}
	job.State = "running"
	unit.Mecha.Energy -= job.EnergyPerTick
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

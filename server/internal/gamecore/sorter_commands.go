package gamecore

import "siliconworld/internal/model"

func (gc *GameCore) execConfigureSorter(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	b := ws.Buildings[cmd.Target.EntityID]
	if b == nil {
		return mechaJobFailed(model.CodeEntityNotFound, "sorter not found")
	}
	if b.OwnerID != playerID {
		return mechaJobFailed(model.CodeNotOwner, "cannot configure another player's sorter")
	}
	if b.Sorter == nil {
		return mechaJobFailed(model.CodeInvalidTarget, "target is not a sorter")
	}
	staged := b.Sorter.Clone()
	used := map[string]bool{}
	for _, key := range []string{"input_directions", "output_directions"} {
		dirs, err := payloadStringSlice(cmd.Payload, key)
		if err != nil || len(dirs) == 0 {
			return mechaJobFailed(model.CodeValidationFailed, "sorter needs nonempty input and output directions")
		}
		values := make([]model.ConveyorDirection, 0, len(dirs))
		for _, value := range dirs {
			dir := model.ConveyorDirection(value)
			if !dir.Valid() || dir == model.ConveyorAuto || used[value] {
				return mechaJobFailed(model.CodeValidationFailed, "directions must be unique cardinal directions with no overlap")
			}
			used[value] = true
			values = append(values, dir)
		}
		if key == "input_directions" {
			staged.InputDirections = values
		} else {
			staged.OutputDirections = values
		}
	}
	staged.Filter = model.SorterFilter{Mode: model.SorterFilterAllow}
	if _, ok := cmd.Payload["filter_mode"]; ok {
		value, err := payloadStrictString(cmd.Payload, "filter_mode")
		if err != nil || value != "allow" && value != "deny" {
			return mechaJobFailed(model.CodeValidationFailed, "filter_mode must be allow or deny")
		}
		staged.Filter.Mode = model.SorterFilterMode(value)
	}
	if _, ok := cmd.Payload["filter_items"]; ok {
		values, err := payloadStringSlice(cmd.Payload, "filter_items")
		if err != nil {
			return mechaJobFailed(model.CodeValidationFailed, err.Error())
		}
		seen := map[string]bool{}
		for _, id := range values {
			if _, ok := model.Item(id); !ok || seen[id] {
				return mechaJobFailed(model.CodeValidationFailed, "filter_items must contain unique catalog item IDs")
			}
			seen[id] = true
		}
		staged.Filter.Items = values
	}
	b.Sorter = staged
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "sorter configured"}, []*model.GameEvent{{EventType: model.EvtBuildingStateChanged, VisibilityScope: playerID, Payload: map[string]any{"entity_id": b.ID, "sorter": staged.Clone()}}}
}

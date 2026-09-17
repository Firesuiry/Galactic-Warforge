package gamecore

import "siliconworld/internal/model"

func (gc *GameCore) execConfigureMechaLogistics(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	unit, _, failure := mechaJobTarget(ws, playerID, cmd)
	if unit == nil {
		return failure, nil
	}
	fail := func(message string) (model.CommandResult, []*model.GameEvent) {
		return mechaJobFailed(model.CodeValidationFailed, message)
	}
	raw, ok := cmd.Payload["requests"].(map[string]any)
	if !ok || len(raw) > 8 {
		return fail("requests must be an object with at most 8 item slots")
	}
	requests := make(map[string]model.MechaLogisticsRequest, len(raw))
	for itemID, value := range raw {
		if item, ok := model.Item(itemID); !ok || item.Form != model.ResourceSolid {
			return fail("unknown logistics request item: " + itemID)
		}
		entry, ok := value.(map[string]any)
		if !ok || len(entry) != 2 {
			return fail("each request must contain min and max")
		}
		minimum, err := payloadValueInt(entry["min"])
		if err != nil {
			return fail("request min must be an integer")
		}
		maximum, err := payloadValueInt(entry["max"])
		if err != nil {
			return fail("request max must be an integer")
		}
		if minimum < 0 || maximum < 1 || maximum > 1000 || minimum > maximum {
			return fail("request bounds require 0 <= min <= max <= 1000 and positive max")
		}
		requests[itemID] = model.MechaLogisticsRequest{Min: minimum, Max: maximum}
	}
	unit.Mecha.LogisticsRequests = requests
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "mecha logistics requests replaced"}, []*model.GameEvent{mechaStateEvent(unit)}
}

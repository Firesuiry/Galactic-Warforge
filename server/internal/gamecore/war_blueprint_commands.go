package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

func (gc *GameCore) execBlueprintCreate(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	blueprintID, err := payloadStrictString(cmd.Payload, "blueprint_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	name, err := payloadStrictString(cmd.Payload, "name")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	baseFrameID, _ := optionalPayloadString(cmd.Payload, "base_frame_id")
	baseHullID, _ := optionalPayloadString(cmd.Payload, "base_hull_id")
	if (baseFrameID == "") == (baseHullID == "") {
		res.Code = model.CodeValidationFailed
		res.Message = "exactly one of payload.base_frame_id or payload.base_hull_id is required"
		return res, nil
	}
	baseID := baseFrameID
	if baseID == "" {
		baseID = baseHullID
	}

	player, store, result := requirePlayerBlueprintStore(ws, playerID)
	if result != nil {
		return *result, nil
	}
	if _, exists := store[blueprintID]; exists {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s already exists", blueprintID)
		return res, nil
	}
	if _, exists := model.PublicWarBlueprintByID(blueprintID); exists {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint id %s reserved by public blueprint", blueprintID)
		return res, nil
	}

	blueprint, err := model.NewPlayerWarBlueprintDraft(player.PlayerID, blueprintID, name, baseID)
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if blueprint.VisibleTechID != "" {
		if err := requireUnitTechUnlocked(ws, playerID, blueprint.VisibleTechID); err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = err.Error()
			return res, nil
		}
	}

	store[blueprint.ID] = blueprint
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("blueprint %s created", blueprint.ID)
	res.Details = blueprintDetails(blueprint)
	return res, nil
}

func (gc *GameCore) execBlueprintSetComponent(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	blueprintID, err := payloadStrictString(cmd.Payload, "blueprint_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	slotID, err := payloadStrictString(cmd.Payload, "slot_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	componentID, err := payloadStrictString(cmd.Payload, "component_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	blueprint, result := requireOwnedBlueprint(ws, playerID, blueprintID)
	if result != nil {
		return *result, nil
	}
	if !model.WarBlueprintEditable(blueprint.Status) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s cannot be edited in status %s", blueprint.ID, blueprint.Status)
		return res, nil
	}
	component, ok := model.PublicWarComponentByID(componentID)
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("component %s not found", componentID)
		return res, nil
	}
	if component.VisibleTechID != "" {
		if err := requireUnitTechUnlocked(ws, playerID, component.VisibleTechID); err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = err.Error()
			return res, nil
		}
	}
	if err := blueprint.ApplyComponent(slotID, componentID); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		res.Details = blueprintIssuesDetails([]model.WarBlueprintValidationIssue{{
			Code:        model.WarBlueprintIssueCode(err.Error()),
			SlotID:      slotID,
			ComponentID: componentID,
			Message:     err.Error(),
		}})
		return res, nil
	}

	var events []*model.GameEvent
	if blueprint.LastValidation != nil || blueprint.Status == model.WarBlueprintStatusValidated {
		blueprint.Status = model.WarBlueprintStatusDraft
		blueprint.LastValidation = nil
		events = append(events, blueprintValidationEvent(model.EvtBlueprintInvalidated, playerID, blueprint, nil, "component_changed"))
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("blueprint %s slot %s set to %s", blueprint.ID, slotID, componentID)
	res.Details = blueprintDetails(blueprint)
	return res, events
}

func (gc *GameCore) execBlueprintValidate(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	blueprintID, err := payloadStrictString(cmd.Payload, "blueprint_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	blueprint, result := requireOwnedBlueprint(ws, playerID, blueprintID)
	if result != nil {
		return *result, nil
	}
	if !model.WarBlueprintEditable(blueprint.Status) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s cannot be validated in status %s", blueprint.ID, blueprint.Status)
		return res, nil
	}

	validation := model.ValidateWarBlueprint(blueprint.Clone())
	copyValidation := validation.Clone()
	blueprint.LastValidation = &copyValidation

	eventType := model.EvtBlueprintValidated
	if validation.Valid {
		blueprint.Status = model.WarBlueprintStatusValidated
		res.Status = model.StatusExecuted
		res.Code = model.CodeOK
		res.Message = fmt.Sprintf("blueprint %s validated", blueprint.ID)
	} else {
		blueprint.Status = model.WarBlueprintStatusDraft
		eventType = model.EvtBlueprintInvalidated
		res.Status = model.StatusFailed
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s validation failed", blueprint.ID)
	}
	res.Details = blueprintValidationDetails(blueprint, validation)
	return res, []*model.GameEvent{blueprintValidationEvent(eventType, playerID, blueprint, &validation, "")}
}

func (gc *GameCore) execBlueprintFinalize(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	blueprintID, err := payloadStrictString(cmd.Payload, "blueprint_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	blueprint, result := requireOwnedBlueprint(ws, playerID, blueprintID)
	if result != nil {
		return *result, nil
	}
	if blueprint.Status != model.WarBlueprintStatusValidated || blueprint.LastValidation == nil || !blueprint.LastValidation.Valid {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s must be validated before finalize", blueprint.ID)
		res.Details = blueprintDetails(blueprint)
		return res, nil
	}
	blueprint.Status = model.WarBlueprintStatusPrototype
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("blueprint %s finalized as prototype", blueprint.ID)
	res.Details = blueprintDetails(blueprint)
	return res, nil
}

func (gc *GameCore) execBlueprintVariant(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	parentID, err := payloadStrictString(cmd.Payload, "parent_blueprint_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	blueprintID, err := payloadStrictString(cmd.Payload, "blueprint_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	name, _ := optionalPayloadString(cmd.Payload, "name")
	if name == "" {
		name = blueprintID
	}

	player, store, result := requirePlayerBlueprintStore(ws, playerID)
	if result != nil {
		return *result, nil
	}
	if _, exists := store[blueprintID]; exists {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s already exists", blueprintID)
		return res, nil
	}
	if _, exists := model.PublicWarBlueprintByID(blueprintID); exists {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint id %s reserved by public blueprint", blueprintID)
		return res, nil
	}

	parent, ok := resolveVariantParent(player, parentID)
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("parent blueprint %s not found", parentID)
		return res, nil
	}
	if parent.VisibleTechID != "" {
		if err := requireUnitTechUnlocked(ws, playerID, parent.VisibleTechID); err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = err.Error()
			return res, nil
		}
	}
	child, err := model.CreateWarBlueprintVariant(player.PlayerID, blueprintID, name, parent)
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		res.Details = blueprintIssuesDetails([]model.WarBlueprintValidationIssue{{
			Code:    model.WarBlueprintIssueCode(err.Error()),
			Message: err.Error(),
		}})
		return res, nil
	}
	store[child.ID] = child
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("variant %s created from %s", child.ID, parent.ID)
	res.Details = blueprintDetails(child)
	return res, nil
}

func (gc *GameCore) execBlueprintSetStatus(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	blueprintID, err := payloadStrictString(cmd.Payload, "blueprint_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	statusRaw, err := payloadStrictString(cmd.Payload, "status")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	targetStatus, ok := model.ParseWarBlueprintStatus(statusRaw)
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("unknown blueprint status %s", statusRaw)
		return res, nil
	}
	blueprint, result := requireOwnedBlueprint(ws, playerID, blueprintID)
	if result != nil {
		return *result, nil
	}
	if !model.WarBlueprintCanTransition(blueprint.Status, targetStatus) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("cannot transition blueprint %s from %s to %s", blueprint.ID, blueprint.Status, targetStatus)
		return res, nil
	}
	if targetStatus != model.WarBlueprintStatusObsolete && (blueprint.LastValidation == nil || !blueprint.LastValidation.Valid) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s requires a valid validation record before promotion", blueprint.ID)
		return res, nil
	}

	blueprint.Status = targetStatus
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("blueprint %s status set to %s", blueprint.ID, targetStatus)
	res.Details = blueprintDetails(blueprint)
	return res, nil
}

func requirePlayerBlueprintStore(ws *model.WorldState, playerID string) (*model.PlayerState, map[string]*model.WarBlueprintDefinition, *model.CommandResult) {
	res := &model.CommandResult{Status: model.StatusFailed}
	if ws == nil {
		res.Code = model.CodeInvalidTarget
		res.Message = "world state missing"
		return nil, nil, res
	}
	player := ws.Players[playerID]
	if player == nil || !player.IsAlive {
		res.Code = model.CodeValidationFailed
		res.Message = "player not found or eliminated"
		return nil, nil, res
	}
	return player, player.EnsureWarBlueprints(), nil
}

func requireOwnedBlueprint(ws *model.WorldState, playerID, blueprintID string) (*model.WarBlueprintDefinition, *model.CommandResult) {
	res := &model.CommandResult{Status: model.StatusFailed}
	_, store, result := requirePlayerBlueprintStore(ws, playerID)
	if result != nil {
		return nil, result
	}
	blueprint := store[blueprintID]
	if blueprint == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("blueprint %s not found", blueprintID)
		return nil, res
	}
	return blueprint, nil
}

func resolveVariantParent(player *model.PlayerState, blueprintID string) (model.WarBlueprintDefinition, bool) {
	if player != nil {
		if blueprint := player.WarBlueprints[blueprintID]; blueprint != nil {
			return blueprint.Clone(), true
		}
	}
	return model.PublicWarBlueprintDefinitionByID(blueprintID)
}

func optionalPayloadString(payload map[string]any, key string) (string, error) {
	raw, ok := payload[key]
	if !ok {
		return "", nil
	}
	return payloadValueString(raw)
}

func blueprintDetails(blueprint *model.WarBlueprintDefinition) map[string]any {
	if blueprint == nil {
		return nil
	}
	copyBlueprint := blueprint.Clone()
	return map[string]any{
		"blueprint": copyBlueprint,
	}
}

func blueprintValidationDetails(blueprint *model.WarBlueprintDefinition, validation model.WarBlueprintValidationResult) map[string]any {
	details := blueprintDetails(blueprint)
	if details == nil {
		details = make(map[string]any)
	}
	details["validation"] = validation.Clone()
	return details
}

func blueprintIssuesDetails(issues []model.WarBlueprintValidationIssue) map[string]any {
	if len(issues) == 0 {
		return nil
	}
	copyIssues := append([]model.WarBlueprintValidationIssue(nil), issues...)
	return map[string]any{
		"issues": copyIssues,
	}
}

func blueprintValidationEvent(
	eventType model.EventType,
	playerID string,
	blueprint *model.WarBlueprintDefinition,
	validation *model.WarBlueprintValidationResult,
	reason string,
) *model.GameEvent {
	if blueprint == nil {
		return nil
	}
	copyBlueprint := blueprint.Clone()
	payload := map[string]any{
		"blueprint_id": copyBlueprint.ID,
		"blueprint":    copyBlueprint,
	}
	if validation != nil {
		copyValidation := validation.Clone()
		payload["validation"] = copyValidation
	}
	if reason != "" {
		payload["reason"] = reason
	}
	return &model.GameEvent{
		EventType:       eventType,
		VisibilityScope: playerID,
		Payload:         payload,
	}
}

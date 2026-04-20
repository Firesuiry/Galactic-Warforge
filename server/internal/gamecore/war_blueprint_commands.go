package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

func (gc *GameCore) execBlueprintCreate(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	player := warBlueprintPlayer(ws, playerID)
	if player == nil {
		res.Code = model.CodeUnauthorized
		res.Message = fmt.Sprintf("player %s not found", playerID)
		return res, nil
	}

	blueprintID, err := payloadStrictString(cmd.Payload, "blueprint_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if _, exists := player.EnsureWarBlueprints()[blueprintID]; exists {
		res.Code = model.CodeDuplicate
		res.Message = fmt.Sprintf("blueprint %s already exists", blueprintID)
		return res, nil
	}
	if _, exists := model.PublicWarBlueprintByID(blueprintID); exists {
		res.Code = model.CodeDuplicate
		res.Message = fmt.Sprintf("blueprint %s conflicts with preset blueprint", blueprintID)
		return res, nil
	}

	name := blueprintID
	if raw, ok := cmd.Payload["name"]; ok {
		name, err = payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.name must be a non-empty string"
			return res, nil
		}
	}
	domainRaw, err := payloadStrictString(cmd.Payload, "domain")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	domain := model.UnitDomain(domainRaw)

	baseFrameID, _ := optionalPayloadString(cmd.Payload, "base_frame_id")
	baseHullID, _ := optionalPayloadString(cmd.Payload, "base_hull_id")
	if (baseFrameID == "" && baseHullID == "") || (baseFrameID != "" && baseHullID != "") {
		res.Code = model.CodeValidationFailed
		res.Message = "blueprint_create requires exactly one of payload.base_frame_id or payload.base_hull_id"
		return res, nil
	}

	index := model.PublicWarBlueprintCatalogIndex()
	blueprint := &model.WarBlueprint{
		ID:          blueprintID,
		OwnerID:     playerID,
		Name:        name,
		Source:      model.WarBlueprintSourcePlayer,
		State:       model.WarBlueprintStateDraft,
		Domain:      domain,
		BaseFrameID: baseFrameID,
		BaseHullID:  baseHullID,
		CreatedTick: ws.Tick,
		UpdatedTick: ws.Tick,
	}
	if !warBlueprintSupportsDomain(index, blueprint) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint base does not support domain %s", domain)
		return res, nil
	}

	player.EnsureWarBlueprints()[blueprintID] = blueprint
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("blueprint %s created", blueprintID)
	return res, nil
}

func (gc *GameCore) execBlueprintSetComponent(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	_, blueprint := warPlayerBlueprint(ws, playerID, cmd)
	if blueprint == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = "blueprint not found"
		return res, nil
	}
	if blueprint.State != model.WarBlueprintStateDraft && blueprint.State != model.WarBlueprintStateValidated {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s in state %s cannot be edited directly", blueprint.ID, blueprint.State)
		res.Validation = invalidBlueprintAction(model.WarBlueprintIssueInvalidStateTransition, res.Message)
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

	index := model.PublicWarBlueprintCatalogIndex()
	if _, ok := index.ComponentByID(componentID); !ok {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("component %s not found", componentID)
		return res, nil
	}
	slotMap, ok := warBlueprintSlotMap(index, blueprint)
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s base not found", blueprint.ID)
		return res, nil
	}
	if _, ok := slotMap[slotID]; !ok {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("slot %s not defined on blueprint %s", slotID, blueprint.ID)
		return res, nil
	}
	if !blueprint.CanEditSlot(slotID) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("slot %s is locked by variant controls", slotID)
		res.Validation = invalidBlueprintAction(model.WarBlueprintIssueVariantSlotLocked, res.Message)
		return res, nil
	}

	blueprint.Components = upsertWarBlueprintComponent(blueprint.Components, slotID, componentID)
	blueprint.State = model.WarBlueprintStateDraft
	blueprint.Validation = nil
	blueprint.UpdatedTick = ws.Tick
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("blueprint %s slot %s updated", blueprint.ID, slotID)
	return res, nil
}

func (gc *GameCore) execBlueprintValidate(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	_, blueprint := warPlayerBlueprint(ws, playerID, cmd)
	if blueprint == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = "blueprint not found"
		return res, nil
	}
	if blueprint.State != model.WarBlueprintStateDraft && blueprint.State != model.WarBlueprintStateValidated {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s in state %s cannot be validated", blueprint.ID, blueprint.State)
		res.Validation = invalidBlueprintAction(model.WarBlueprintIssueInvalidStateTransition, res.Message)
		return res, nil
	}

	validation := model.ValidateWarBlueprint(model.PublicWarBlueprintCatalogIndex(), *blueprint)
	blueprint.Validation = &validation
	blueprint.UpdatedTick = ws.Tick
	if !validation.Valid {
		blueprint.State = model.WarBlueprintStateDraft
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s invalid", blueprint.ID)
		res.Validation = &validation
		return res, nil
	}

	blueprint.State = model.WarBlueprintStateValidated
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("blueprint %s validated", blueprint.ID)
	res.Validation = &validation
	return res, nil
}

func (gc *GameCore) execBlueprintFinalize(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	_, blueprint := warPlayerBlueprint(ws, playerID, cmd)
	if blueprint == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = "blueprint not found"
		return res, nil
	}

	targetState := blueprint.DefaultFinalizeTarget()
	if raw, ok := cmd.Payload["target_state"]; ok {
		value, err := payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.target_state must be a non-empty string"
			return res, nil
		}
		targetState = model.WarBlueprintState(value)
	}
	if targetState == "" || !blueprint.CanTransitionTo(targetState) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s cannot transition from %s to %s", blueprint.ID, blueprint.State, targetState)
		res.Validation = invalidBlueprintAction(model.WarBlueprintIssueInvalidStateTransition, res.Message)
		return res, nil
	}
	if blueprint.State == model.WarBlueprintStateValidated {
		if blueprint.Validation == nil || !blueprint.Validation.Valid {
			validation := model.ValidateWarBlueprint(model.PublicWarBlueprintCatalogIndex(), *blueprint)
			blueprint.Validation = &validation
		}
		if blueprint.Validation == nil || !blueprint.Validation.Valid {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("blueprint %s must validate before finalize", blueprint.ID)
			res.Validation = blueprint.Validation
			return res, nil
		}
	}

	blueprint.State = targetState
	blueprint.UpdatedTick = ws.Tick
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("blueprint %s promoted to %s", blueprint.ID, targetState)
	res.Validation = blueprint.Validation
	return res, nil
}

func (gc *GameCore) execBlueprintVariant(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	player := warBlueprintPlayer(ws, playerID)
	if player == nil {
		res.Code = model.CodeUnauthorized
		res.Message = fmt.Sprintf("player %s not found", playerID)
		return res, nil
	}

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
	if _, exists := player.EnsureWarBlueprints()[blueprintID]; exists {
		res.Code = model.CodeDuplicate
		res.Message = fmt.Sprintf("blueprint %s already exists", blueprintID)
		return res, nil
	}
	if _, exists := model.PublicWarBlueprintByID(blueprintID); exists {
		res.Code = model.CodeDuplicate
		res.Message = fmt.Sprintf("blueprint %s conflicts with preset blueprint", blueprintID)
		return res, nil
	}

	parent, ok := model.ResolveWarBlueprintForPlayer(player, parentID)
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("parent blueprint %s not found", parentID)
		return res, nil
	}
	if !parent.CanCreateVariant() {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s in state %s cannot spawn variants", parent.ID, parent.State)
		res.Validation = invalidBlueprintAction(model.WarBlueprintIssueInvalidStateTransition, res.Message)
		return res, nil
	}

	allowedSlots, err := payloadStringSlice(cmd.Payload, "allowed_slot_ids")
	if err != nil || len(allowedSlots) == 0 {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.allowed_slot_ids must be a non-empty string array"
		return res, nil
	}
	slotMap, ok := warBlueprintSlotMap(model.PublicWarBlueprintCatalogIndex(), &parent)
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("parent blueprint %s base not found", parent.ID)
		return res, nil
	}
	for _, slotID := range allowedSlots {
		if _, exists := slotMap[slotID]; !exists {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("slot %s not defined on parent blueprint %s", slotID, parent.ID)
			return res, nil
		}
	}

	name := blueprintID
	if raw, ok := cmd.Payload["name"]; ok {
		name, err = payloadValueString(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.name must be a non-empty string"
			return res, nil
		}
	}

	player.EnsureWarBlueprints()[blueprintID] = &model.WarBlueprint{
		ID:                  blueprintID,
		OwnerID:             playerID,
		Name:                name,
		Source:              model.WarBlueprintSourcePlayer,
		State:               model.WarBlueprintStateDraft,
		Domain:              parent.Domain,
		BaseFrameID:         parent.BaseFrameID,
		BaseHullID:          parent.BaseHullID,
		ParentBlueprintID:   parent.ID,
		AllowedVariantSlots: append([]string(nil), allowedSlots...),
		Components:          append([]model.WarBlueprintComponentSlot(nil), parent.Components...),
		CreatedTick:         ws.Tick,
		UpdatedTick:         ws.Tick,
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("variant %s created from %s", blueprintID, parent.ID)
	return res, nil
}

func warBlueprintPlayer(ws *model.WorldState, playerID string) *model.PlayerState {
	if ws == nil || ws.Players == nil {
		return nil
	}
	return ws.Players[playerID]
}

func warPlayerBlueprint(ws *model.WorldState, playerID string, cmd model.Command) (*model.PlayerState, *model.WarBlueprint) {
	player := warBlueprintPlayer(ws, playerID)
	if player == nil {
		return nil, nil
	}
	blueprintID, err := payloadStrictString(cmd.Payload, "blueprint_id")
	if err != nil {
		return player, nil
	}
	return player, player.EnsureWarBlueprints()[blueprintID]
}

func optionalPayloadString(payload map[string]any, key string) (string, bool) {
	raw, ok := payload[key]
	if !ok {
		return "", false
	}
	value, err := payloadValueString(raw)
	if err != nil {
		return "", false
	}
	return value, true
}

func payloadStringSlice(payload map[string]any, key string) ([]string, error) {
	raw, ok := payload[key]
	if !ok {
		return nil, fmt.Errorf("payload.%s required", key)
	}
	switch values := raw.(type) {
	case []string:
		return append([]string(nil), values...), nil
	case []any:
		out := make([]string, 0, len(values))
		for _, rawValue := range values {
			value, err := payloadValueString(rawValue)
			if err != nil {
				return nil, err
			}
			out = append(out, value)
		}
		return out, nil
	default:
		return nil, fmt.Errorf("string array required")
	}
}

func warBlueprintSupportsDomain(index model.WarBlueprintCatalogIndex, blueprint *model.WarBlueprint) bool {
	if blueprint == nil {
		return false
	}
	if blueprint.BaseFrameID != "" {
		frame, ok := index.BaseFrameByID(blueprint.BaseFrameID)
		return ok && containsDomain(frame.SupportedDomains, blueprint.Domain)
	}
	if blueprint.BaseHullID != "" {
		hull, ok := index.BaseHullByID(blueprint.BaseHullID)
		return ok && containsDomain(hull.SupportedDomains, blueprint.Domain)
	}
	return false
}

func warBlueprintSlotMap(index model.WarBlueprintCatalogIndex, blueprint *model.WarBlueprint) (map[string]model.WarSlotSpec, bool) {
	if blueprint == nil {
		return nil, false
	}
	out := map[string]model.WarSlotSpec{}
	if blueprint.BaseFrameID != "" {
		frame, ok := index.BaseFrameByID(blueprint.BaseFrameID)
		if !ok {
			return nil, false
		}
		for _, slot := range frame.Slots {
			out[slot.ID] = slot
		}
		return out, true
	}
	hull, ok := index.BaseHullByID(blueprint.BaseHullID)
	if !ok {
		return nil, false
	}
	for _, slot := range hull.Slots {
		out[slot.ID] = slot
	}
	return out, true
}

func upsertWarBlueprintComponent(components []model.WarBlueprintComponentSlot, slotID, componentID string) []model.WarBlueprintComponentSlot {
	out := append([]model.WarBlueprintComponentSlot(nil), components...)
	for i := range out {
		if out[i].SlotID != slotID {
			continue
		}
		out[i].ComponentID = componentID
		return out
	}
	return append(out, model.WarBlueprintComponentSlot{SlotID: slotID, ComponentID: componentID})
}

func invalidBlueprintAction(code model.WarBlueprintValidationIssueCode, message string) *model.WarBlueprintValidationResult {
	return &model.WarBlueprintValidationResult{
		Valid: false,
		Issues: []model.WarBlueprintValidationIssue{{
			Code:    code,
			Message: message,
		}},
	}
}

func containsDomain(domains []model.UnitDomain, target model.UnitDomain) bool {
	for _, domain := range domains {
		if domain == target {
			return true
		}
	}
	return false
}

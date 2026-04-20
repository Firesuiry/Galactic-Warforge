package query

import (
	"sort"

	"siliconworld/internal/model"
)

// WarBlueprints returns player-owned warfare blueprint details.
func (ql *Layer) WarBlueprints(ws *model.WorldState, playerID string) *model.WarBlueprintListView {
	view := &model.WarBlueprintListView{Blueprints: []model.WarBlueprintDetailView{}}
	if ws == nil {
		return view
	}
	ws.RLock()
	defer ws.RUnlock()

	player := ws.Players[playerID]
	if player == nil || len(player.WarBlueprints) == 0 {
		return view
	}
	index := model.PublicWarBlueprintCatalogIndex()
	ids := make([]string, 0, len(player.WarBlueprints))
	for id := range player.WarBlueprints {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		blueprint := player.WarBlueprints[id]
		if blueprint == nil {
			continue
		}
		view.Blueprints = append(view.Blueprints, buildWarBlueprintDetail(index, blueprint))
	}
	return view
}

// WarBlueprint returns one player or preset blueprint detail.
func (ql *Layer) WarBlueprint(ws *model.WorldState, playerID, blueprintID string) (model.WarBlueprintDetailView, bool) {
	if ws == nil {
		return model.WarBlueprintDetailView{}, false
	}
	ws.RLock()
	defer ws.RUnlock()

	index := model.PublicWarBlueprintCatalogIndex()
	if player := ws.Players[playerID]; player != nil && player.WarBlueprints != nil {
		if blueprint := player.WarBlueprints[blueprintID]; blueprint != nil {
			return buildWarBlueprintDetail(index, blueprint), true
		}
	}
	preset, ok := model.PresetWarBlueprintByID(blueprintID)
	if !ok {
		return model.WarBlueprintDetailView{}, false
	}
	return buildWarBlueprintDetail(index, &preset), true
}

func buildWarBlueprintDetail(index model.WarBlueprintCatalogIndex, blueprint *model.WarBlueprint) model.WarBlueprintDetailView {
	validation := model.ValidateWarBlueprint(index, *blueprint)
	return model.WarBlueprintDetailView{
		ID:                  blueprint.ID,
		OwnerID:             blueprint.OwnerID,
		Name:                blueprint.Name,
		Source:              blueprint.Source,
		State:               blueprint.State,
		Domain:              blueprint.Domain,
		BaseFrameID:         blueprint.BaseFrameID,
		BaseHullID:          blueprint.BaseHullID,
		ParentBlueprintID:   blueprint.ParentBlueprintID,
		AllowedVariantSlots: append([]string(nil), blueprint.AllowedVariantSlots...),
		Components:          append([]model.WarBlueprintComponentSlot(nil), blueprint.Components...),
		Validation:          validation,
		AllowedActions:      blueprint.AllowedActions(),
	}
}

package query

import (
	"sort"

	"siliconworld/internal/model"
)

// WarBlueprintListView exposes player-owned war blueprints.
type WarBlueprintListView struct {
	PlayerID   string                         `json:"player_id"`
	Blueprints []model.WarBlueprintDefinition `json:"blueprints"`
}

// WarBlueprints returns the current player's stored war blueprints.
func (ql *Layer) WarBlueprints(ws *model.WorldState, playerID string) *WarBlueprintListView {
	view := &WarBlueprintListView{
		PlayerID:   playerID,
		Blueprints: []model.WarBlueprintDefinition{},
	}
	if ws == nil {
		return view
	}
	ws.RLock()
	defer ws.RUnlock()

	player := ws.Players[playerID]
	if player == nil || len(player.WarBlueprints) == 0 {
		return view
	}
	ids := make([]string, 0, len(player.WarBlueprints))
	for blueprintID, blueprint := range player.WarBlueprints {
		if blueprint == nil {
			continue
		}
		ids = append(ids, blueprintID)
	}
	sort.Strings(ids)
	view.Blueprints = make([]model.WarBlueprintDefinition, 0, len(ids))
	for _, blueprintID := range ids {
		blueprint := player.WarBlueprints[blueprintID]
		if blueprint == nil {
			continue
		}
		view.Blueprints = append(view.Blueprints, blueprint.Clone())
	}
	return view
}

// WarBlueprint returns one player-owned war blueprint definition.
func (ql *Layer) WarBlueprint(ws *model.WorldState, playerID, blueprintID string) (*model.WarBlueprintDefinition, bool) {
	if ws == nil {
		return nil, false
	}
	ws.RLock()
	defer ws.RUnlock()

	player := ws.Players[playerID]
	if player == nil {
		return nil, false
	}
	blueprint := player.WarBlueprints[blueprintID]
	if blueprint == nil {
		return nil, false
	}
	copyBlueprint := blueprint.Clone()
	return &copyBlueprint, true
}

package gamecore

import "siliconworld/internal/model"

func grantTechs(ws *model.WorldState, playerID string, techIDs ...string) {
	if ws == nil {
		return
	}
	player := ws.Players[playerID]
	if player == nil {
		return
	}
	if player.Tech == nil {
		player.Tech = model.NewPlayerTechState(playerID)
	}
	for _, techID := range techIDs {
		if techID == "" {
			continue
		}
		player.Tech.CompletedTechs[techID] = 1
	}
}

func grantAllTechs(ws *model.WorldState, playerIDs ...string) {
	for _, playerID := range playerIDs {
		for _, def := range model.AllTechDefinitions() {
			if def == nil {
				continue
			}
			grantTechs(ws, playerID, def.ID)
		}
	}
}

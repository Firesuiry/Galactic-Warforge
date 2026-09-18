package gamecore

import "siliconworld/internal/model"

// settleTechAssetSync refreshes research-derived stats on player-owned assets
// that live outside a single world's unit list: logistics drones (drone_engine
// speed) and solar sail orbits (solar_sail_life longevity). It runs once per
// tick before drone dispatch and sail decay consume those stats, and is
// idempotent so snapshot restores converge on the next tick.
func settleTechAssetSync(gc *GameCore, frame *settlementFrame) {
	if gc == nil || frame == nil {
		return
	}
	for _, ws := range frame.worlds {
		model.SyncLogisticsDroneStats(ws)
	}
	model.SyncSolarSailLifetimes(gc.spaceRuntime, techAssetPlayers(frame.worlds))
}

// techAssetPlayers maps player IDs to their tech-bearing state, preferring the
// first world that lists the player (research keeps tech replicated across
// planet worlds).
func techAssetPlayers(worlds []*model.WorldState) map[string]*model.PlayerState {
	players := make(map[string]*model.PlayerState)
	for _, ws := range worlds {
		if ws == nil {
			continue
		}
		for id, player := range ws.Players {
			if player == nil {
				continue
			}
			if _, ok := players[id]; !ok {
				players[id] = player
			}
		}
	}
	return players
}

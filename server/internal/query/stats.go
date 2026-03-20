package query

import (
	"siliconworld/internal/model"
)

// Stats returns player statistics
func (ql *Layer) Stats(ws *model.WorldState, playerID string) *model.PlayerStats {
	ws.RLock()
	defer ws.RUnlock()

	player := ws.Players[playerID]
	if player == nil || player.Stats == nil {
		return &model.PlayerStats{PlayerID: playerID, Tick: ws.Tick}
	}

	stats := *player.Stats
	return &stats
}
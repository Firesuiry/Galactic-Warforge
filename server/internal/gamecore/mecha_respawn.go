package gamecore

import (
	"siliconworld/internal/model"
	"sort"
)

// Respawns retain the executor identity, but reset combat, energy and jobs.
// A living owned HQ and a free adjacent tile are required on this planet.
func settleExecutorRespawns(ws *model.WorldState) []*model.GameEvent {
	if ws == nil {
		return nil
	}
	ids := make([]string, 0, len(ws.Players))
	for id := range ws.Players {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var events []*model.GameEvent
	for _, id := range ids {
		p := ws.Players[id]
		if p == nil || !p.IsAlive {
			continue
		}
		exec := p.Executors[ws.PlanetID]
		if exec == nil || exec.RespawnAtTick <= 0 || exec.RespawnAtTick > ws.Tick || ws.Units[exec.UnitID] != nil {
			continue
		}
		var hqs []*model.Building
		for _, b := range ws.Buildings {
			if b != nil && b.OwnerID == id && b.HP > 0 && b.Type == model.BuildingTypeBattlefieldAnalysisBase {
				hqs = append(hqs, b)
			}
		}
		sort.Slice(hqs, func(i, j int) bool { return hqs[i].ID < hqs[j].ID })
		for _, hq := range hqs {
			pos := findAdjacentFree(ws, hq.Position)
			if pos == nil {
				continue
			}
			u := model.UnitStats(model.UnitTypeExecutor)
			u.ID, u.OwnerID, u.Position = exec.UnitID, id, *pos
			model.SyncMechaCapabilities(&u, p)
			ws.Units[u.ID] = &u
			key := model.TileKey(pos.X, pos.Y)
			ws.TileUnits[key] = append(ws.TileUnits[key], u.ID)
			exec.RespawnAtTick = 0
			p.SetPlanetExecutor(ws.PlanetID, exec)
			events = append(events, &model.GameEvent{EventType: model.EvtEntityCreated, VisibilityScope: id, Payload: map[string]any{"entity_type": "unit", "entity_id": u.ID, "unit": u.Clone(), "planet_id": ws.PlanetID, "respawn": true}})
			break
		}
	}
	return events
}

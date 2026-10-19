package gamecore

import (
	"siliconworld/internal/model"
	"sort"
)

// Respawns retain the mecha identity (unit ID, backpack), but reset combat,
// energy and jobs. A living owned HQ and a free adjacent tile are required on
// the record's planet. Every mecha dossier is handled independently.
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
		for _, record := range p.SortedMechas() {
			if record == nil || record.RespawnAtTick <= 0 || record.RespawnAtTick > ws.Tick || record.PlanetID != ws.PlanetID || ws.Units[record.UnitID] != nil {
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
				// 复活点走与出厂同一个找空位函数：不复用被占格，避免与地面单位堆叠。
				pos := findUnitSpawnTile(ws, hq.Position, false, unitSpawnRadius)
				if pos == nil {
					continue
				}
				u := model.UnitStats(model.UnitTypeExecutor)
				u.ID, u.OwnerID, u.Position = record.UnitID, id, *pos
				model.SyncMechaCapabilities(&u, p)
				ws.Units[u.ID] = &u
				key := model.TileKey(pos.X, pos.Y)
				ws.TileUnits[key] = append(ws.TileUnits[key], u.ID)
				record.RespawnAtTick = 0
				events = append(events, &model.GameEvent{EventType: model.EvtEntityCreated, VisibilityScope: id, Payload: map[string]any{"entity_type": "unit", "entity_id": u.ID, "unit": u.Clone(), "planet_id": ws.PlanetID, "respawn": true}})
				break
			}
		}
	}
	return events
}

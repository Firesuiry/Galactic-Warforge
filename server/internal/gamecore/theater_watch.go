package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

// 战区防区警戒（U8）：周期性扫描战区行星区域，发现敌方实体
// （非拥有者单位/建筑、黑雾巢穴等静态敌对势力）时向拥有者发
// theater_zone_alert 告警事件；敌情持续期间按冷却重报，清空后自动复位。
const (
	theaterZoneDefaultRadius      = 8
	theaterZoneAlertCooldownTicks = 300
)

type theaterWatchRef struct {
	ownerID string
	theater *model.WarTheater
}

func settleTheaterWatch(worlds map[string]*model.WorldState, currentTick int64) []*model.GameEvent {
	if len(worlds) == 0 {
		return nil
	}

	// 同一玩家可能出现在多个世界的 Players 中，按 (ownerID, theaterID) 去重。
	seen := make(map[string]struct{})
	var refs []theaterWatchRef
	worldIDs := make([]string, 0, len(worlds))
	for planetID := range worlds {
		worldIDs = append(worldIDs, planetID)
	}
	sort.Strings(worldIDs)
	for _, planetID := range worldIDs {
		ws := worlds[planetID]
		if ws == nil {
			continue
		}
		playerIDs := make([]string, 0, len(ws.Players))
		for playerID := range ws.Players {
			playerIDs = append(playerIDs, playerID)
		}
		sort.Strings(playerIDs)
		for _, playerID := range playerIDs {
			player := ws.Players[playerID]
			if player == nil || player.WarCoordination == nil {
				continue
			}
			theaterIDs := make([]string, 0, len(player.WarCoordination.Theaters))
			for theaterID := range player.WarCoordination.Theaters {
				theaterIDs = append(theaterIDs, theaterID)
			}
			sort.Strings(theaterIDs)
			for _, theaterID := range theaterIDs {
				key := playerID + "/" + theaterID
				if _, ok := seen[key]; ok {
					continue
				}
				seen[key] = struct{}{}
				theater := player.WarCoordination.Theaters[theaterID]
				if theater == nil {
					continue
				}
				refs = append(refs, theaterWatchRef{ownerID: playerID, theater: theater})
			}
		}
	}

	var events []*model.GameEvent
	for _, ref := range refs {
		for index := range ref.theater.Zones {
			zone := &ref.theater.Zones[index]
			if zone.PlanetID == "" || zone.Position == nil {
				continue
			}
			ws := worlds[zone.PlanetID]
			if ws == nil {
				continue
			}
			hostile := countTheaterZoneHostiles(ws, ref.ownerID, zone)
			zone.HostileCount = hostile
			if hostile <= 0 {
				zone.Alerted = false
				continue
			}
			if zone.Alerted && currentTick-zone.LastAlertTick < theaterZoneAlertCooldownTicks {
				continue
			}
			zone.Alerted = true
			zone.LastAlertTick = currentTick
			events = append(events, &model.GameEvent{
				EventType:       model.EvtTheaterZoneAlert,
				VisibilityScope: ref.ownerID,
				Payload: map[string]any{
					"theater_id":    ref.theater.ID,
					"theater_name":  ref.theater.Name,
					"zone_type":     string(zone.ZoneType),
					"planet_id":     zone.PlanetID,
					"position":      zone.Position,
					"radius":        theaterZoneRadius(zone),
					"hostile_count": hostile,
				},
			})
		}
	}
	return events
}

func theaterZoneRadius(zone *model.WarTheaterZone) int {
	if zone == nil || zone.Radius <= 0 {
		return theaterZoneDefaultRadius
	}
	return zone.Radius
}

func countTheaterZoneHostiles(ws *model.WorldState, ownerID string, zone *model.WarTheaterZone) int {
	if ws == nil || zone == nil || zone.Position == nil {
		return 0
	}
	radius := theaterZoneRadius(zone)
	center := *zone.Position
	hostile := 0
	for _, unit := range ws.Units {
		if unit == nil || unit.HP <= 0 || unit.OwnerID == "" || unit.OwnerID == ownerID {
			continue
		}
		if ws.SurfaceDistance(center, unit.Position) <= radius {
			hostile++
		}
	}
	for _, building := range ws.Buildings {
		if building == nil || building.HP <= 0 || building.OwnerID == "" || building.OwnerID == ownerID {
			continue
		}
		if ws.SurfaceDistance(center, building.Position) <= radius {
			hostile++
		}
	}
	if ws.EnemyForces != nil {
		for i := range ws.EnemyForces.Forces {
			force := &ws.EnemyForces.Forces[i]
			if force.Strength <= 0 {
				continue
			}
			if ws.SurfaceDistance(center, force.Position) <= radius {
				hostile++
			}
		}
	}
	return hostile
}

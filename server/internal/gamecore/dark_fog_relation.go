package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

// 黑雾被动敌对：黑雾默认对所有玩家中立，不派波次、不自动攻击；
// 某玩家伤害黑雾单位/巢穴后，黑雾对该玩家敌对到 tick+calm，
// 期间每次再伤害都会顺延；到期恢复中立。

// darkFogCalmTicks 当前世界的冷静期（tick）。
func darkFogCalmTicks(ws *model.WorldState) int64 {
	if ws.DarkFogCalmTicks > 0 {
		return ws.DarkFogCalmTicks
	}
	return model.DefaultDarkFogCalmTicks
}

// provokeDarkFog 记录玩家对黑雾造成了伤害；首次转为敌对时发 dark_fog_provoked。
func provokeDarkFog(ws *model.WorldState, ownerID string) []*model.GameEvent {
	if ws == nil || ownerID == "" || ownerID == model.DarkFogOwnerID {
		return nil
	}
	player := ws.Players[ownerID]
	if player == nil {
		return nil
	}
	player.DarkFog.HostileUntilTick = ws.Tick + darkFogCalmTicks(ws)
	if player.DarkFog.Hostile {
		return nil
	}
	player.DarkFog.Hostile = true
	return []*model.GameEvent{{
		EventType:       model.EvtDarkFogProvoked,
		VisibilityScope: "all",
		Payload: map[string]any{
			"player_id":  ownerID,
			"until_tick": player.DarkFog.HostileUntilTick,
		},
	}}
}

// settleDarkFogCalm 到期的敌对关系恢复中立（玩家表跨世界共享，每 tick 只结算一次）。
func settleDarkFogCalm(players map[string]*model.PlayerState, tick int64) []*model.GameEvent {
	ids := make([]string, 0, len(players))
	for id, player := range players {
		if player != nil && player.DarkFog.Hostile && tick >= player.DarkFog.HostileUntilTick {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	events := make([]*model.GameEvent, 0, len(ids))
	for _, id := range ids {
		players[id].DarkFog = model.DarkFogRelation{}
		events = append(events, &model.GameEvent{
			EventType:       model.EvtDarkFogCalmed,
			VisibilityScope: "all",
			Payload:         map[string]any{"player_id": id},
		})
	}
	return events
}

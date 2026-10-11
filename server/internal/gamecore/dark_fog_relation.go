package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

// 黑雾被动敌对：黑雾默认对所有玩家中立，不派波次、不自动攻击；
// 某玩家**主动挑衅**黑雾后，黑雾对该玩家敌对到 tick+calm，
// 期间每次再挑衅都会顺延；到期恢复中立。
//
// 主动挑衅 = 伤害黑雾建筑（巢穴/中继等静态强度点），或攻击一个当时没有在攻击
// 该玩家的黑雾单位。自卫还手（对正在攻击自己/己方单位/己方建筑的黑雾单位开火）
// 不顺延计时——否则只要黑雾在打你，自动还手就会把敌对计时无限续下去，
// 玩家永远回不到中立（试玩 1014 TC-07）。

// darkFogCalmTicks 当前世界的冷静期（tick）。
func darkFogCalmTicks(ws *model.WorldState) int64 {
	if ws.DarkFogCalmTicks > 0 {
		return ws.DarkFogCalmTicks
	}
	return model.DefaultDarkFogCalmTicks
}

// provokeDarkFog 记录玩家对黑雾造成了伤害。
// aggressive=false 表示这是自卫还手（打的是正在攻击该玩家的黑雾单位）：
// 只在黑雾已经敌对时记录，不新激怒、不顺延计时；首次转敌对时发 dark_fog_provoked。
func provokeDarkFog(ws *model.WorldState, ownerID string, aggressive bool) []*model.GameEvent {
	if ws == nil || ownerID == "" || ownerID == model.DarkFogOwnerID {
		return nil
	}
	player := ws.Players[ownerID]
	if player == nil {
		return nil
	}
	if !aggressive {
		// 自卫还手不顺延：黑雾本来就敌对时保持原截止 tick 不动。
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

// darkFogForceIsStatic 报告一个黑雾强度点是否是建筑（不可移动）。
// 巢穴/中继等静态强度点没有单位实体，玩家打它只可能是主动挑衅
// （它们除了反击不产生攻击行为，不存在"还手"）。
func darkFogForceIsStatic(force *model.EnemyForce) bool {
	if force == nil {
		return false
	}
	switch force.Type {
	case model.EnemyForceTypeHive, model.EnemyForceTypeBeacon:
		return true
	}
	return false
}

// darkFogUnitIsRetaliating 黑雾单位当前是否正在攻击玩家：已锁定玩家实体
// （单位/建筑）作为攻击目标，或玩家单位记着它是最近攻击者（即玩家正在挨它的打）。
// 这正是"自卫还手"的判定口径：打这样的单位不顺延敌对计时。
//
// 只认"正在攻击**任一**玩家"，不区分具体是谁：黑雾单位只会把玩家实体设为攻击目标，
// 且黑雾的敌对关系是全局的（一个玩家挑衅，所有玩家一起挨打）。按"任一战"判定
// 既简单（不需要黑雾单位记录攻击对象归属）又更保守——玩家多打一个正在打别人的
// 黑雾单位会被算成挑衅，这是可接受的代价；反过来漏判会让计时被自动还手续期。
//
// 建筑挨打不写入建筑（Building 无 LastAttackerID 字段），但黑雾拆家时同时会
// 锁定该玩家的单位，且守卫被打时玩家单位会记下它，实战中不会漏判。
func darkFogUnitIsRetaliating(ws *model.WorldState, unit *model.Unit) bool {
	if ws == nil || unit == nil || unit.OwnerID != model.DarkFogOwnerID {
		return false
	}
	// 有攻击目标就算「正在打该玩家」：黑雾单位只会把玩家实体（单位/建筑）设为攻击目标，
	// 不解析目标当前是否还活着——目标刚被打死时目标会瞬间失效，一旦据此判成"没在打我"，
	// 自动还手就会把敌对计时再顺延一次（试玩 1014 TC-07 的复现里就是这么续上的）。
	if unit.AttackTarget != "" {
		return true
	}
	for _, other := range ws.Units {
		if other == nil || other.HP <= 0 || other.OwnerID == model.DarkFogOwnerID {
			continue
		}
		if other.LastAttackerID == unit.ID {
			return true
		}
	}
	return false
}

// darkFogStrikeIsAggressive 判定玩家单位对黑雾目标的一次开火是否算「主动挑衅」：
//   - 静态强度点（巢穴/中继）：算。它们不主动攻击，打它只可能是玩家挑的事；
//   - 黑雾单位：只有打一个**没有在攻击该玩家**的单位才算挑衅；打正在攻击自己/
//     己方单位/己方建筑的黑雾单位属自卫还手，不顺延敌对计时。
func darkFogStrikeIsAggressive(ws *model.WorldState, unit *model.Unit, target *unitCombatTarget) bool {
	if target == nil {
		return false
	}
	switch target.kind {
	case "enemy_force":
		return darkFogForceIsStatic(target.force)
	case "unit":
		return !darkFogUnitIsRetaliating(ws, target.unit)
	}
	return false
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

package gamecore

import (
	"fmt"
	"sort"

	"siliconworld/internal/model"
)

// 军团（3.6 A1）：bot 用 form_squad 把出厂单位编队（战斗单位 + 补给车），
// 再用 squad_order 下达 attack/defend/retreat/resupply，与玩家走同一命令接口。
// 决策是军团与世界状态的纯函数：期望 (order,target) 与军团当前一致则不重复下令。

type botLegionPlan struct {
	order  model.SquadOrder
	target *model.Position // resupply 由服务端选站，可为空
}

// botLegions 先给已有军团下令（来袭回防 > 残血撤退 > 缺弹补给 > 进攻），
// 再在散兵达标时编成新军团。
func (gc *GameCore) botLegions(ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey, threats []botThreat, issue func(model.Command) bool) bool {
	for _, squad := range ctx.squads {
		plan, ok := botLegionDecide(gc, ws, playerID, tuning, ctx, squad, threats)
		if !ok || (squad.Order == plan.order && botSameTarget(squad.Target, plan.target, plan.order)) {
			continue
		}
		cmd := model.Command{
			Type:    model.CmdSquadOrder,
			Target:  model.CommandTarget{Layer: "planet", Position: plan.target},
			Payload: map[string]any{"squad_id": squad.ID, "order": string(plan.order)},
		}
		return issue(cmd)
	}
	if len(ctx.loose) >= tuning.attackAt && len(ctx.squads) < 4 {
		ids := make([]string, 0, len(ctx.loose))
		for _, u := range ctx.loose {
			ids = append(ids, u.ID)
		}
		sort.Strings(ids)
		if len(ids) > 300 {
			ids = ids[:300]
		}
		anyIDs := make([]any, len(ids))
		for i, id := range ids {
			anyIDs[i] = id
		}
		return issue(model.Command{
			Type:    model.CmdFormSquad,
			Target:  model.CommandTarget{Layer: "planet"},
			Payload: map[string]any{"entity_ids": anyIDs, "name": fmt.Sprintf("bot-legion-%d", len(ctx.squads)+1)},
		})
	}
	return false
}

func botSameTarget(cur, want *model.Position, order model.SquadOrder) bool {
	if order == model.SquadOrderResupply {
		return true // 补给站由服务端选定
	}
	if cur == nil || want == nil {
		return cur == want
	}
	return *cur == *want
}

// botLegionStats 军团存活成员的平均血量比与作战单位平均弹药比。
func botLegionStats(ws *model.WorldState, squad *model.CombatSquad) (hp, ammo float64, alive int) {
	var hpSum, ammoSum float64
	hpN, ammoN := 0, 0
	for _, id := range squad.MemberIDs {
		u := ws.Units[id]
		if u == nil || u.HP <= 0 {
			continue
		}
		alive++
		if u.MaxHP > 0 {
			hpSum += float64(u.HP) / float64(u.MaxHP)
			hpN++
		}
		if u.AmmoCapacity > 0 {
			ammoSum += float64(u.Ammo) / float64(u.AmmoCapacity)
			ammoN++
		}
	}
	hp, ammo = 1, 1
	if hpN > 0 {
		hp = hpSum / float64(hpN)
	}
	if ammoN > 0 {
		ammo = ammoSum / float64(ammoN)
	}
	return hp, ammo, alive
}

func botLegionDecide(gc *GameCore, ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey, squad *model.CombatSquad, threats []botThreat) (botLegionPlan, bool) {
	hp, ammo, alive := botLegionStats(ws, squad)
	if alive == 0 {
		return botLegionPlan{}, false
	}
	home := *ctx.home
	// 滞回：已在撤退/补给的军团要恢复到明显高于阈值才重新出击。
	retreatLine, ammoLine := tuning.retreatBelowHP, tuning.resupplyBelowAmmo
	if squad.Order == model.SquadOrderRetreat {
		retreatLine += 0.3
	}
	if squad.Order == model.SquadOrderResupply {
		ammoLine += 0.4
	}
	if hp < retreatLine {
		return botLegionPlan{order: model.SquadOrderRetreat, target: &home}, true
	}
	if ammo < ammoLine {
		if nearestSquadSupply(ws, squad) != nil {
			return botLegionPlan{order: model.SquadOrderResupply}, true
		}
		return botLegionPlan{order: model.SquadOrderRetreat, target: &home}, true
	}
	for _, threat := range threats {
		if threat.dist <= tuning.defendRadius {
			pos := threat.pos
			return botLegionPlan{order: model.SquadOrderDefend, target: &pos}, true
		}
	}
	if ws.Tick < gc.cfg.Battlefield.BotFirstAttackTick {
		return botLegionPlan{}, false // 开局发育期：军团留守基地，不主动出击
	}
	target := gc.botAttackObjective(ws, playerID, tuning, ctx)
	if target == nil {
		return botLegionPlan{}, false
	}
	return botLegionPlan{order: model.SquadOrderAttack, target: target}, true
}

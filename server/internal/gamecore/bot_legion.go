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

// botLegionRefreshTicks 军团"到位后僵住"时的重下发间隔（tick）。
// 军团攻击是一条一次性指令：成员走到阵型位后 onUnitArrived 会把姿态切回 idle，
// 而 idle 的自动索敌不含建筑——军团于是停在玩家基地旁再也不开火，且因为
// (order,target) 没变，bot 永远不会重下同一条指令（试玩报告 C：首攻摧毁 5 座
// 建筑后 4 万 tick 零战斗）。周期性重下发会重新寻路并把姿态恢复为 attack_move。
const botLegionRefreshTicks int64 = 300

// botLegions 先给已有军团下令（来袭回防 > 残血撤退 > 缺弹补给 > 进攻），
// 再在散兵达标时编成新军团。
func (gc *GameCore) botLegions(ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey, threats []botThreat, issue func(model.Command) bool) bool {
	for _, squad := range ctx.squads {
		plan, ok := botLegionDecide(gc, ws, playerID, tuning, ctx, squad, threats)
		if !ok {
			continue
		}
		if squad.Order == plan.order && botSameTarget(squad.Target, plan.target, plan.order) {
			// 同一指令不重复下发，但军团"到位后僵住"（无人有路径、无人有目标）时
			// 需要周期性重下发，让成员重新寻路并恢复攻击移动姿态（见上面的常量）。
			if !botSquadStalled(ws, squad) || ws.Tick-squad.LastOrderTick < botLegionRefreshTicks {
				continue
			}
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

// botSquadStalled 军团是否"到位后僵住"：没有任何存活成员在移动或交战。
// 这种状态下攻击移动的意图已经丢失（成员姿态被 onUnitArrived 切成 idle），
// 只有重下发指令才能让军团继续推进/开火。
func botSquadStalled(ws *model.WorldState, squad *model.CombatSquad) bool {
	members := squad.Members(ws)
	if len(members) == 0 {
		return false
	}
	for _, u := range members {
		if u.HasPath() || u.AttackTarget != "" || u.Stance == model.UnitStanceAttackMove {
			return false
		}
	}
	return true
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

// botRetreatHoldTicks 撤退滞回时限：军团回家整补这么久之后，滞回阈值回落。
// 单位不会回血，平均 HP 0.55 的军团在 hard（retreatBelowHP 0.5 + 0.3）下会
// 永远留在撤退分支、到家后一动不动（试玩报告 B）。滞回必须有时限。
const botRetreatHoldTicks int64 = 1500

func botLegionDecide(gc *GameCore, ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey, squad *model.CombatSquad, threats []botThreat) (botLegionPlan, bool) {
	hp, ammo, alive := botLegionStats(ws, squad)
	if alive == 0 {
		return botLegionPlan{}, false
	}
	home := *ctx.home
	// 滞回：已在撤退/补给的军团要恢复到明显高于阈值才重新出击，但滞回只在
	// 下单后 botRetreatHoldTicks 内有效——到家整补一段时间后阈值回落，
	// 保证残部一定有机会重新出击。
	retreatLine, ammoLine := tuning.retreatBelowHP, tuning.resupplyBelowAmmo
	if squad.Order == model.SquadOrderRetreat && ws.Tick-squad.LastOrderTick < botRetreatHoldTicks {
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

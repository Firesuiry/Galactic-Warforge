package gamecore

import (
	"hash/fnv"
	"math"
	"math/rand"

	"siliconworld/internal/model"
)

// darkFogLootEntry 黑雾战利品掉落表条目。
type darkFogLootEntry struct {
	ItemID string  // 必须已存在于 model 物品目录
	Chance float64 // 基础掉落概率 [0,1]
	MinQty int
	MaxQty int
}

// darkFogLootTable 黑雾掉落表：swarm 为黑雾单位，hive/beacon 为黑雾建筑。
// 主掉落为 dark_fog_matrix（研究站隐藏科技链路的关键材料），辅以既有 df 系材料。
var darkFogLootTable = map[model.EnemyForceType][]darkFogLootEntry{
	model.EnemyForceTypeSwarm: {
		{ItemID: model.ItemDarkFogMatrix, Chance: 0.35, MinQty: 1, MaxQty: 2},
		{ItemID: model.ItemGraphene, Chance: 0.45, MinQty: 1, MaxQty: 3},
		{ItemID: model.ItemCarbonNanotube, Chance: 0.20, MinQty: 1, MaxQty: 2},
	},
	model.EnemyForceTypeHive: {
		{ItemID: model.ItemDarkFogMatrix, Chance: 1.00, MinQty: 1, MaxQty: 3},
		{ItemID: model.ItemTitaniumAlloy, Chance: 0.60, MinQty: 1, MaxQty: 4},
		{ItemID: model.ItemProcessor, Chance: 0.30, MinQty: 1, MaxQty: 2},
	},
	model.EnemyForceTypeBeacon: {
		{ItemID: model.ItemDarkFogMatrix, Chance: 0.60, MinQty: 1, MaxQty: 3},
		{ItemID: model.ItemStrangeMatter, Chance: 0.35, MinQty: 1, MaxQty: 1},
		{ItemID: model.ItemSpaceWarper, Chance: 0.25, MinQty: 1, MaxQty: 1},
	},
}

// darkFogLootRNG 由击杀对象与时间派生的确定性随机源：同一 (forceID, tick)
// 的掉落结果恒定，存档恢复或重放后战利品保持一致。
func darkFogLootRNG(forceID string, tick int64) *rand.Rand {
	h := fnv.New64a()
	_, _ = h.Write([]byte(forceID))
	seed := int64(h.Sum64()) + tick*7919
	return rand.New(rand.NewSource(seed))
}

// darkFogLootDrops 按掉落表计算一次击杀的掉落；strength 为击杀前的强度，
// 强度越高的黑雾掉落期望越高。
func darkFogLootDrops(force *model.EnemyForce, strength int, tick int64) []model.ItemAmount {
	if force == nil {
		return nil
	}
	entries := darkFogLootTable[force.Type]
	if len(entries) == 0 {
		return nil
	}
	rng := darkFogLootRNG(force.ID, tick)
	// 强度加成：每 200 点强度等比提升概率，封顶 +0.5。
	chanceBonus := math.Min(0.5, float64(strength)/200.0)
	var drops []model.ItemAmount
	for _, entry := range entries {
		chance := entry.Chance + chanceBonus
		if chance > 1 {
			chance = 1
		}
		if rng.Float64() >= chance {
			continue
		}
		qty := entry.MinQty
		if entry.MaxQty > entry.MinQty {
			qty += rng.Intn(entry.MaxQty - entry.MinQty + 1)
		}
		if qty > 0 {
			drops = append(drops, model.ItemAmount{ItemID: entry.ItemID, Quantity: qty})
		}
	}
	return drops
}

// darkFogLootGrant 单次掉落条目的入库结果。
type darkFogLootGrant struct {
	Drop         model.ItemAmount
	StoredQty    int // 进入击杀建筑库存（行星侧库存）
	CarriedQty   int // 进入击杀者机甲背包（玩家库存）
	DiscardedQty int // 无处可去被丢弃
}

// blackFogNestKillMeterRefundRatio 巢穴摧毁的威胁回落比例（E4）：
// 摧毁 level 级巢穴扣减 level*blackFogMeterPerLevel*ratio 点威胁值（下限 0）。
const blackFogNestKillMeterRefundRatio = 0.5

// amplifyNestLoot 巢穴（hive）摧毁掉落按巢穴等级放大（E4）：
// 数量乘区 = 1 + 0.5*(level-1)（向上取整），且 dark_fog_matrix 保底 level+1 个。
// 全程整数/定点运算，不消费随机序列，回放一致。
func amplifyNestLoot(drops []model.ItemAmount, level int) []model.ItemAmount {
	if level < 1 {
		level = 1
	}
	matrixFloor := level + 1
	out := make([]model.ItemAmount, 0, len(drops)+1)
	matrixSeen := false
	for _, drop := range drops {
		// 向上取整的 1+0.5*(level-1) 倍乘区：qty*(level+1)/2 的 ceil。
		qty := drop.Quantity * (level + 1)
		qty = (qty + 1) / 2
		if drop.ItemID == model.ItemDarkFogMatrix {
			matrixSeen = true
			if qty < matrixFloor {
				qty = matrixFloor
			}
		}
		out = append(out, model.ItemAmount{ItemID: drop.ItemID, Quantity: qty})
	}
	if !matrixSeen {
		out = append(out, model.ItemAmount{ItemID: model.ItemDarkFogMatrix, Quantity: matrixFloor})
	}
	return out
}

// destroyEnemyForce 黑雾实体摧毁的统一入口（E4）——单位/炮塔/小队/舰队四条
// 击杀路径共用同一份奖励与区域安全语义：
//   - 掉落：hive 巢穴按巢穴等级放大（dark_fog_matrix 保底 level+1）；
//   - 威胁回落：hive 按等级比例扣减 ThreatMeter（下限 0）；
//   - 区域安全：hive 登记巢穴遗址（位置+摧毁 tick），冷却期内遗址半径内不刷新新巢；
//   - 事件：loot_dropped（入库明细）+ entity_destroyed（通用）+
//     enemy_nest_destroyed（hive 专属战报，visibility=all，含 planet_id 与掉落清单）。
//
// strengthBefore 为击杀前强度（掉落强度加成用）；storage 非空时战利品优先入该库存
// （炮塔弹仓），否则入击杀者玩家背包。返回产生的事件，实体已从世界中移除。
func destroyEnemyForce(ws *model.WorldState, force *model.EnemyForce, strengthBefore int, killerID, killerOwnerID, source string, storage *model.StorageState) []*model.GameEvent {
	if ws == nil || force == nil {
		return nil
	}
	level := nestLevel(force)
	recordCombatBuildingKill(ws, model.DarkFogOwnerID, killerOwnerID)
	drops := darkFogLootDrops(force, strengthBefore, ws.Tick)
	if force.Type == model.EnemyForceTypeHive {
		drops = amplifyNestLoot(drops, level)
	}
	grants := grantDarkFogLoot(ws, killerOwnerID, storage, drops)

	var events []*model.GameEvent
	events = append(events, darkFogLootEvents(ws, force, killerID, killerOwnerID, grants)...)
	events = append(events, &model.GameEvent{
		EventType:       model.EvtEntityDestroyed,
		VisibilityScope: "all",
		Payload: map[string]any{
			"entity_id":   force.ID,
			"entity_kind": "enemy_force",
			"entity_type": string(force.Type),
			"killed_by":   killerID,
			"source":      source,
		},
	})

	if force.Type == model.EnemyForceTypeHive && ws.EnemyForces != nil {
		// 威胁回落 + 遗址登记（区域安全）。
		refund := blackFogMeterPerLevel * float64(level) * blackFogNestKillMeterRefundRatio
		ws.EnemyForces.ThreatMeter -= refund
		if ws.EnemyForces.ThreatMeter < 0 {
			ws.EnemyForces.ThreatMeter = 0
		}
		ws.EnemyForces.NestRuins = append(ws.EnemyForces.NestRuins, model.NestRuin{
			Position:      force.Position,
			DestroyedTick: ws.Tick,
			Level:         level,
		})

		dropList := make([]map[string]any, 0, len(drops))
		for _, drop := range drops {
			dropList = append(dropList, map[string]any{"item_id": drop.ItemID, "quantity": drop.Quantity})
		}
		events = append(events, &model.GameEvent{
			EventType:       model.EvtEnemyNestDestroyed,
			VisibilityScope: "all",
			Payload: map[string]any{
				"nest_id":      force.ID,
				"planet_id":    ws.PlanetID,
				"position":     force.Position,
				"level":        level,
				"killed_by":    killerID,
				"killer_owner": killerOwnerID,
				"source":       source,
				"drops":        dropList,
				"threat_meter": ws.EnemyForces.ThreatMeter,
			},
		})
	}

	removeEnemyForce(ws, force.ID)
	return events
}

// grantDarkFogLoot 把击杀掉落分配给击杀者：
//  1. 击杀者是炮塔时优先进入炮塔自身存储（行星侧库存）；满仓时保留已有物品，
//     溢出部分继续向下转移；
//  2. 放不下的（或击杀者是战斗单位/机甲时的全部）进入击杀者的机甲背包（玩家库存）；
//  3. 击杀者玩家已不存在时，剩余部分丢弃。
func grantDarkFogLoot(ws *model.WorldState, playerID string, storage *model.StorageState, drops []model.ItemAmount) []darkFogLootGrant {
	grants := make([]darkFogLootGrant, 0, len(drops))
	for _, drop := range drops {
		grant := darkFogLootGrant{Drop: drop}
		remaining := drop.Quantity
		if storage != nil && remaining > 0 {
			if accepted, _, err := storage.Receive(drop.ItemID, remaining); err == nil && accepted > 0 {
				grant.StoredQty = accepted
				remaining -= accepted
			}
		}
		if remaining > 0 {
			if player := ws.Players[playerID]; player != nil {
				player.AddItems([]model.ItemAmount{{ItemID: drop.ItemID, Quantity: remaining}})
				grant.CarriedQty = remaining
				remaining = 0
			}
		}
		grant.DiscardedQty = remaining
		grants = append(grants, grant)
	}
	return grants
}

// darkFogLootEvents 为入库结果生成战利品事件。
func darkFogLootEvents(ws *model.WorldState, force *model.EnemyForce, killedBy string, playerID string, grants []darkFogLootGrant) []*model.GameEvent {
	var events []*model.GameEvent
	for _, grant := range grants {
		events = append(events, &model.GameEvent{
			EventType:       model.EvtLootDropped,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"loot_id":    ws.NextEntityID("loot"),
				"player_id":  playerID,
				"item_id":    grant.Drop.ItemID,
				"quantity":   grant.Drop.Quantity,
				"stored":     grant.StoredQty,
				"carried":    grant.CarriedQty,
				"discarded":  grant.DiscardedQty,
				"position":   force.Position,
				"force_id":   force.ID,
				"force_type": force.Type,
				"killed_by":  killedBy,
			},
		})
	}
	return events
}

// findEnemyForceByID 根据ID查找敌对势力
func findEnemyForceByID(ws *model.WorldState, id string) *model.EnemyForce {
	if ws.EnemyForces == nil {
		return nil
	}
	for i := range ws.EnemyForces.Forces {
		if ws.EnemyForces.Forces[i].ID == id {
			return &ws.EnemyForces.Forces[i]
		}
	}
	return nil
}

// removeEnemyForce 从世界中移除敌对势力
func removeEnemyForce(ws *model.WorldState, id string) {
	if ws.EnemyForces == nil {
		return
	}

	for i := range ws.EnemyForces.Forces {
		if ws.EnemyForces.Forces[i].ID == id {
			lastIdx := len(ws.EnemyForces.Forces) - 1
			ws.EnemyForces.Forces[i] = ws.EnemyForces.Forces[lastIdx]
			ws.EnemyForces.Forces = ws.EnemyForces.Forces[:lastIdx]
			return
		}
	}
}

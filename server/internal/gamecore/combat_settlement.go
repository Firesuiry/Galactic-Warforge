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

// CombatUnitManager 管理战斗单位
type CombatUnitManager struct {
	Units map[string]*model.CombatUnit
}

// NewCombatUnitManager 创建战斗单位管理器
func NewCombatUnitManager() *CombatUnitManager {
	return &CombatUnitManager{
		Units: make(map[string]*model.CombatUnit),
	}
}

// SpawnCombatUnit 生成战斗单位
func (m *CombatUnitManager) SpawnCombatUnit(ws *model.WorldState, unitType model.CombatUnitType, playerID string, pos model.Position, rng *rand.Rand) *model.CombatUnit {
	stats := model.DefaultCombatUnitStats(unitType)
	unit := &model.CombatUnit{
		ID:            ws.NextEntityID("combat"),
		Type:          unitType,
		PlayerID:      playerID,
		Position:      pos,
		HP:            stats.HP,
		MaxHP:         stats.MaxHP,
		Shield:        stats.Shield,
		Weapon:        stats.Weapon,
		AmmoInventory: stats.AmmoInventory,
		Speed:         stats.Speed,
		State:         model.CombatUnitStateIdle,
	}

	m.Units[unit.ID] = unit
	return unit
}

// RemoveCombatUnit 移除战斗单位
func (m *CombatUnitManager) RemoveCombatUnit(unitID string) {
	delete(m.Units, unitID)
}

// settleCombat 处理每tick的战斗结算
func (gc *GameCore) settleCombat() []*model.GameEvent {
	if gc == nil || gc.world == nil {
		return nil
	}

	var events []*model.GameEvent
	ws := gc.world

	// 使用GameCore持有的战斗单位管理器
	manager := gc.combatUnits

	// 1. 单位攻击敌人
	for _, unit := range manager.Units {
		if unit.State == model.CombatUnitStateDead {
			continue
		}

		// 如果有攻击目标，查找目标
		var target *model.EnemyForce
		if unit.AttackTarget != "" {
			target = findEnemyForceByID(ws, unit.AttackTarget)
		}

		// 如果没有目标或目标已死亡，查找最近敌人
		if target == nil || target.Strength <= 0 {
			target = findNearestEnemyForce(ws, unit.Position)
			if target != nil {
				unit.AttackTarget = target.ID
			}
		}

		if target == nil {
			continue
		}

		// 开火
		damage, success := model.ProcessWeaponFire(ws, unit, &model.CombatUnit{
			ID:       target.ID,
			Position: target.Position,
			HP:       target.Strength,
			Shield:   model.ShieldState{Level: target.SpreadRadius * 10}, // 使用spreadRadius作为护盾代理
		}, ws.Tick)

		if success {
			events = append(events, &model.GameEvent{
				EventType:       model.EvtDamageApplied,
				VisibilityScope: unit.PlayerID,
				Payload: map[string]any{
					"attacker_id":   unit.ID,
					"attacker_type": "combat_unit",
					"target_id":     target.ID,
					"target_type":   "enemy_force",
					"damage":        damage,
				},
			})

			// 伤害作用于敌对势力强度（此前只打到临时副本上，黑雾永远无法被击杀）
			strengthBefore := target.Strength
			target.Strength -= damage
			if target.Strength < 0 {
				target.Strength = 0
			}

			// 检查击杀
			if target.Strength <= 0 {
				// 掉落进入击杀者的机甲背包（玩家库存）
				drops := darkFogLootDrops(target, strengthBefore, ws.Tick)
				grants := grantDarkFogLoot(ws, unit.PlayerID, nil, drops)
				events = append(events, darkFogLootEvents(ws, target, unit.ID, unit.PlayerID, grants)...)

				events = append(events, &model.GameEvent{
					EventType:       model.EvtEntityDestroyed,
					VisibilityScope: "all",
					Payload: map[string]any{
						"entity_id":   target.ID,
						"entity_type": "enemy_force",
						"source":      "combat_unit",
						"killed_by":   unit.ID,
					},
				})

				// 移除敌人
				removeEnemyForce(ws, target.ID)
				unit.AttackTarget = ""
			}
		}
	}

	// 2. 护盾恢复
	for _, unit := range manager.Units {
		if unit.State != model.CombatUnitStateDead {
			unit.Shield.ProcessShieldRecharge(ws.Tick)
		}
	}

	// 3. 敌人攻击单位
	if ws.EnemyForces != nil {
		for i := range ws.EnemyForces.Forces {
			force := &ws.EnemyForces.Forces[i]
			if force.Strength <= 0 {
				continue
			}

			// 查找最近的战斗单位
			target := findNearestCombatUnit(ws, manager, force.Position)
			if target != nil {
				// 计算敌人对单位的伤害
				damage := force.Strength / 2
				if damage < 1 {
					damage = 1
				}

				target.HP -= damage
				target.Shield.LastHitTick = ws.Tick

				events = append(events, &model.GameEvent{
					EventType:       model.EvtDamageApplied,
					VisibilityScope: target.PlayerID,
					Payload: map[string]any{
						"attacker_id":   force.ID,
						"attacker_type": "enemy_force",
						"target_id":     target.ID,
						"target_type":   "combat_unit",
						"damage":        damage,
						"target_hp":     target.HP,
					},
				})

				if target.HP <= 0 {
					target.State = model.CombatUnitStateDead
					events = append(events, &model.GameEvent{
						EventType:       model.EvtEntityDestroyed,
						VisibilityScope: "all",
						Payload: map[string]any{
							"entity_id":   target.ID,
							"entity_type": "combat_unit",
							"source":      "enemy_force",
						},
					})
					manager.RemoveCombatUnit(target.ID)
				}
			}
		}
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

// findNearestEnemyForce 查找最近的敌对势力
func findNearestEnemyForce(ws *model.WorldState, pos model.Position) *model.EnemyForce {
	if ws.EnemyForces == nil || len(ws.EnemyForces.Forces) == 0 {
		return nil
	}

	var nearest *model.EnemyForce
	minDist := float64(^uint(0) >> 1)

	for i := range ws.EnemyForces.Forces {
		force := &ws.EnemyForces.Forces[i]
		dist := float64(ws.SurfaceDistance(pos, force.Position))
		if dist < minDist {
			minDist = dist
			nearest = force
		}
	}

	return nearest
}

// findNearestCombatUnit 查找最近的战斗单位
func findNearestCombatUnit(ws *model.WorldState, manager *CombatUnitManager, pos model.Position) *model.CombatUnit {
	var nearest *model.CombatUnit
	minDist := float64(^uint(0) >> 1)

	for _, unit := range manager.Units {
		if unit.State == model.CombatUnitStateDead {
			continue
		}
		dist := float64(ws.SurfaceDistance(pos, unit.Position))
		if dist < minDist {
			minDist = dist
			nearest = unit
		}
	}

	return nearest
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

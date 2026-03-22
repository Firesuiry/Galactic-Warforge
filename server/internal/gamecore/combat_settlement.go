package gamecore

import (
	"math/rand"

	"siliconworld/internal/model"
)

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
		damage, success := model.ProcessWeaponFire(unit, &model.CombatUnit{
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
					"attacker_id": unit.ID,
					"attacker_type": "combat_unit",
					"target_id":   target.ID,
					"target_type": "enemy_force",
					"damage":      damage,
				},
			})

			// 检查击杀
			if target.Strength <= 0 {
				// 处理掉落
				loot := model.CalculateLoot(target, gc.rng)
				for _, drop := range loot {
					events = append(events, &model.GameEvent{
						EventType:       model.EvtLootDropped,
						VisibilityScope: unit.PlayerID,
						Payload: map[string]any{
							"loot_id":   ws.NextEntityID("loot"),
							"player_id": unit.PlayerID,
							"item_id":   drop.ItemID,
							"quantity":  drop.Quantity,
							"position":  target.Position,
						},
					})
				}

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
			target := findNearestCombatUnit(manager, force.Position)
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
						"attacker_id": force.ID,
						"attacker_type": "enemy_force",
						"target_id":   target.ID,
						"target_type": "combat_unit",
						"damage":      damage,
						"target_hp":   target.HP,
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
		dist := model.CalculateDistance(pos, force.Position)
		if dist < minDist {
			minDist = dist
			nearest = force
		}
	}

	return nearest
}

// findNearestCombatUnit 查找最近的战斗单位
func findNearestCombatUnit(manager *CombatUnitManager, pos model.Position) *model.CombatUnit {
	var nearest *model.CombatUnit
	minDist := float64(^uint(0) >> 1)

	for _, unit := range manager.Units {
		if unit.State == model.CombatUnitStateDead {
			continue
		}
		dist := model.CalculateDistance(pos, unit.Position)
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
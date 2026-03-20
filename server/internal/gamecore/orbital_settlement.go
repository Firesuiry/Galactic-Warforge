package gamecore

import (
	"siliconworld/internal/model"
)

// OrbitalPlatformManager 轨道平台管理器
type OrbitalPlatformManager struct {
	Platforms map[string]*model.OrbitalPlatform
}

// NewOrbitalPlatformManager 创建轨道平台管理器
func NewOrbitalPlatformManager() *OrbitalPlatformManager {
	return &OrbitalPlatformManager{
		Platforms: make(map[string]*model.OrbitalPlatform),
	}
}

// SpawnOrbitalPlatform 生成轨道防御平台
func (m *OrbitalPlatformManager) SpawnOrbitalPlatform(ws *model.WorldState, platformType, ownerID, planetID string, rng interface{}) *model.OrbitalPlatform {
	stats := model.DefaultOrbitalPlatformStats(platformType)
	platform := &model.OrbitalPlatform{
		ID:        ws.NextEntityID("orbital"),
		OwnerID:   ownerID,
		PlanetID:  planetID,
		Orbit:     stats.Orbit,
		HP:        stats.HP,
		MaxHP:     stats.MaxHP,
		Weapon:    stats.Weapon,
		AmmoCapacity: stats.AmmoCapacity,
		AmmoCount: stats.AmmoCount,
		IsActive:  stats.IsActive,
	}

	m.Platforms[platform.ID] = platform
	return platform
}

// settleOrbitalCombat 处理轨道战斗结算
func (gc *GameCore) settleOrbitalCombat() []*model.GameEvent {
	if gc == nil || gc.world == nil {
		return nil
	}

	var events []*model.GameEvent
	ws := gc.world

	manager := NewOrbitalPlatformManager()

	// 1. 更新所有轨道平台位置
	for _, platform := range manager.Platforms {
		if platform.HP <= 0 || !platform.IsActive {
			continue
		}
		platform.UpdateOrbit()
	}

	// 2. 轨道平台攻击敌对势力
	for _, platform := range manager.Platforms {
		if platform.HP <= 0 || !platform.IsActive {
			continue
		}

		if ws.EnemyForces == nil || len(ws.EnemyForces.Forces) == 0 {
			continue
		}

		// 查找最近的敌对势力
		target := findNearestEnemyForce(ws, platform.CalculateGroundPosition(10.0))
		if target == nil {
			continue
		}

		// 检查冷却和弹药
		if ws.Tick-platform.LastFireTick < int64(platform.Weapon.FireRate) {
			continue
		}
		if platform.AmmoCount < platform.Weapon.AmmoCost {
			continue
		}

		// 计算距离
		distance := model.CalculateOrbitalDistance(platform.Orbit, target.Position, 10.0)
		if distance > platform.Weapon.Range {
			continue
		}

		// 造成伤害
		damage := platform.Weapon.Damage
		target.Strength -= damage / 5 // 轨道攻击减少敌人力量

		platform.AmmoCount -= platform.Weapon.AmmoCost
		platform.LastFireTick = ws.Tick

		events = append(events, &model.GameEvent{
			EventType:       model.EvtDamageApplied,
			VisibilityScope: platform.OwnerID,
			Payload: map[string]any{
				"attacker_id": platform.ID,
				"attacker_type": "orbital_platform",
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
					VisibilityScope: platform.OwnerID,
					Payload: map[string]any{
						"loot_id":   ws.NextEntityID("loot"),
						"player_id": platform.OwnerID,
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
					"source":      "orbital_platform",
					"killed_by":   platform.ID,
				},
			})

			// 移除敌人
			removeEnemyForce(ws, target.ID)
		}
	}

	// 3. 敌对势力攻击轨道平台
	if ws.EnemyForces != nil {
		for i := range ws.EnemyForces.Forces {
			force := &ws.EnemyForces.Forces[i]
			if force.Strength <= 0 {
				continue
			}

			// 敌对势力有几率攻击轨道平台（如果范围内）
			for _, platform := range manager.Platforms {
				if platform.HP <= 0 || !platform.IsActive {
					continue
				}

				groundPos := platform.CalculateGroundPosition(10.0)
				dist := model.CalculateDistance(force.Position, groundPos)

				// 敌对势力在一定范围内可以攻击轨道平台
				if dist > 20 { // 敌对势力攻击范围
					continue
				}

				// 随机决定是否攻击
				if gc.rng.Float64() > 0.1 { // 10%几率攻击
					continue
				}

				damage := force.Strength / 3
				if damage < 1 {
					damage = 1
				}

				platform.HP -= damage

				events = append(events, &model.GameEvent{
					EventType:       model.EvtDamageApplied,
					VisibilityScope: platform.OwnerID,
					Payload: map[string]any{
						"attacker_id": force.ID,
						"attacker_type": "enemy_force",
						"target_id":   platform.ID,
						"target_type": "orbital_platform",
						"damage":      damage,
						"target_hp":   platform.HP,
					},
				})

				if platform.HP <= 0 {
					events = append(events, &model.GameEvent{
						EventType:       model.EvtEntityDestroyed,
						VisibilityScope: "all",
						Payload: map[string]any{
							"entity_id":   platform.ID,
							"entity_type": "orbital_platform",
							"source":      "enemy_force",
						},
					})
				}
			}
		}
	}

	return events
}

// settleFleetFormation 处理编队移动和协同
func (gc *GameCore) settleFleetFormation() []*model.GameEvent {
	if gc == nil || gc.world == nil {
		return nil
	}

	var events []*model.GameEvent
	// 编队功能暂时预留
	// 未来可以实现:
	// 1. 编队成员跟随领队移动
	// 2. 编队协同攻击
	// 3. 编队阵型维持

	return events
}
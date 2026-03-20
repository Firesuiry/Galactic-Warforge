package gamecore

import (
	"math"

	"siliconworld/internal/model"
)

// EnemyForceConfig 敌对势力生成配置
type EnemyForceConfig struct {
	SpawnIntervalTicks int64   // 生成间隔tick
	SpawnMargin       int     // 生成边界距
	MaxForces         int     // 最大势力数量
	BaseStrength      int     // 基础实力
	StrengthVariance  int     // 实力方差
}

func defaultEnemyForceConfig() EnemyForceConfig {
	return EnemyForceConfig{
		SpawnIntervalTicks: 200,  // 20秒
		SpawnMargin:       5,
		MaxForces:         20,
		BaseStrength:      10,
		StrengthVariance:  5,
	}
}

// settleEnemyForces 处理敌对势力的生成、扩散和进攻
func (gc *GameCore) settleEnemyForces() []*model.GameEvent {
	if gc == nil || gc.world == nil {
		return nil
	}

	cfg := defaultEnemyForceConfig()
	params := model.DefaultThreatParams()
	rhythm := model.DefaultAttackRhythm()

	var events []*model.GameEvent
	ws := gc.world

	// 确保EnemyForces已初始化
	if ws.EnemyForces == nil {
		ws.EnemyForces = &model.EnemyForceState{
			SystemID:   ws.PlanetID,
			Forces:     make([]model.EnemyForce, 0),
			ThreatLevel: model.ThreatLevelNone,
			LastAttack:  0,
		}
	}

	// 1. 生成新敌对势力
	if ws.Tick%cfg.SpawnIntervalTicks == 0 && len(ws.EnemyForces.Forces) < cfg.MaxForces {
		gc.spawnEnemyForce(ws, cfg)
	}

	// 2. 扩散现有敌对势力
	for i := range ws.EnemyForces.Forces {
		force := &ws.EnemyForces.Forces[i]
		model.SpreadEnemyForce(force, gc.rng)
		// 确保敌对势力在地图边界内
		clampForcePosition(ws, force)
	}

	// 3. 计算威胁等级
	ws.EnemyForces.ThreatLevel = model.ThreatLevelNone
	for _, player := range ws.Players {
		if !player.IsAlive {
			continue
		}
		// 找到该玩家最近的建筑位置作为玩家位置
		playerPos := getPlayerCenterPosition(ws, player.PlayerID)
		threat := model.CalculateThreatLevel(ws.EnemyForces.Forces, playerPos, params)
		if threat > ws.EnemyForces.ThreatLevel {
			ws.EnemyForces.ThreatLevel = threat
		}
	}

	// 4. 处理进攻
	nextAttackTick := model.GetNextAttackTick(ws.EnemyForces.LastAttack, ws.EnemyForces.ThreatLevel, rhythm)
	if ws.Tick >= nextAttackTick && ws.EnemyForces.ThreatLevel >= model.ThreatLevelMedium {
		attackEvents := gc.executeEnemyAttack(ws, rhythm)
		events = append(events, attackEvents...)
		ws.EnemyForces.LastAttack = ws.Tick
	}

	// 5. 发布威胁等级变化事件
	if ws.EnemyForces.ThreatLevel >= model.ThreatLevelLow {
		for _, player := range ws.Players {
			if !player.IsAlive {
				continue
			}
			events = append(events, &model.GameEvent{
				EventType:       model.EvtThreatLevelChanged,
				VisibilityScope: player.PlayerID,
				Payload: map[string]any{
					"player_id":    player.PlayerID,
					"threat_level": ws.EnemyForces.ThreatLevel,
					"force_count":  len(ws.EnemyForces.Forces),
				},
			})
		}
	}

	return events
}

// spawnEnemyForce 生成新的敌对势力
func (gc *GameCore) spawnEnemyForce(ws *model.WorldState, cfg EnemyForceConfig) {
	if ws == nil || gc.rng == nil {
		return
	}

	// 随机选择势力类型
	forceTypes := []model.EnemyForceType{
		model.EnemyForceTypeSwarm,
		model.EnemyForceTypeHive,
		model.EnemyForceTypeBeacon,
	}
	forceType := forceTypes[gc.rng.Intn(len(forceTypes))]

	// 在地图边缘生成
	var pos model.Position
	edge := gc.rng.Intn(4) // 0=top, 1=right, 2=bottom, 3=left
	margin := cfg.SpawnMargin

	switch edge {
	case 0: // top
		pos.X = gc.rng.Intn(ws.MapWidth)
		pos.Y = margin
	case 1: // right
		pos.X = ws.MapWidth - margin - 1
		pos.Y = gc.rng.Intn(ws.MapHeight)
	case 2: // bottom
		pos.X = gc.rng.Intn(ws.MapWidth)
		pos.Y = ws.MapHeight - margin - 1
	case 3: // left
		pos.X = margin
		pos.Y = gc.rng.Intn(ws.MapHeight)
	}

	// 计算实力值
	strength := cfg.BaseStrength + gc.rng.Intn(cfg.StrengthVariance*2+1) - cfg.StrengthVariance
	if strength < 1 {
		strength = 1
	}

	enemyForce := model.EnemyForce{
		ID:           ws.NextEntityID("enemy"),
		Type:         forceType,
		Position:     pos,
		Strength:     strength,
		SpreadRadius: 1.0,
		TargetPlayer: "",
		SpawnTick:    ws.Tick,
	}

	ws.EnemyForces.Forces = append(ws.EnemyForces.Forces, enemyForce)
}

// getPlayerCenterPosition 获取玩家中心位置（所有建筑的平均位置）
func getPlayerCenterPosition(ws *model.WorldState, playerID string) model.Position {
	if ws == nil {
		return model.Position{X: 0, Y: 0}
	}
	if ws.Buildings == nil {
		return model.Position{X: ws.MapWidth / 2, Y: ws.MapHeight / 2}
	}

	var sumX, sumY, count int
	for _, b := range ws.Buildings {
		if b.OwnerID == playerID {
			sumX += b.Position.X
			sumY += b.Position.Y
			count++
		}
	}

	if count == 0 {
		return model.Position{X: ws.MapWidth / 2, Y: ws.MapHeight / 2}
	}

	return model.Position{X: sumX / count, Y: sumY / count}
}

// clampForcePosition 确保敌对势力位置在地图边界内
func clampForcePosition(ws *model.WorldState, force *model.EnemyForce) {
	if ws == nil || force == nil {
		return
	}

	margin := 5
	if force.Position.X < margin {
		force.Position.X = margin
	}
	if force.Position.X >= ws.MapWidth-margin {
		force.Position.X = ws.MapWidth - margin - 1
	}
	if force.Position.Y < margin {
		force.Position.Y = margin
	}
	if force.Position.Y >= ws.MapHeight-margin {
		force.Position.Y = ws.MapHeight - margin - 1
	}
}

// executeEnemyAttack 执行敌对势力的攻击
func (gc *GameCore) executeEnemyAttack(ws *model.WorldState, rhythm model.AttackRhythm) []*model.GameEvent {
	if ws == nil || gc.rng == nil {
		return nil
	}

	var events []*model.GameEvent

	// 计算总攻击强度
	totalStrength := 0
	for _, force := range ws.EnemyForces.Forces {
		totalStrength += force.Strength
	}

	// 限制每次攻击的强度
	attackStrength := totalStrength / len(ws.EnemyForces.Forces)
	if attackStrength > rhythm.StrengthPerAttack*3 {
		attackStrength = rhythm.StrengthPerAttack * 3
	}

	// 对每个玩家造成伤害
	for _, player := range ws.Players {
		if !player.IsAlive {
			continue
		}

		// 找到最近的建筑
		targetBuilding := findNearestPlayerBuilding(ws, player.PlayerID)
		if targetBuilding == nil {
			continue
		}

		// 计算伤害（防御方护甲减免）
		damage := attackStrength
		if targetBuilding.HP > 0 {
			defense := targetBuilding.HP / 10
			if defense > damage {
				defense = damage
			}
			damage -= defense

			// 应用伤害
			targetBuilding.HP -= damage
			if targetBuilding.HP < 0 {
				targetBuilding.HP = 0
			}

			events = append(events, &model.GameEvent{
				EventType:       model.EvtDamageApplied,
				VisibilityScope: player.PlayerID,
				Payload: map[string]any{
					"entity_id":  targetBuilding.ID,
					"entity_type": "building",
					"damage":    damage,
					"hp":        targetBuilding.HP,
					"max_hp":    targetBuilding.MaxHP,
					"source":    "enemy_force",
				},
			})

			// 如果建筑被摧毁
			if targetBuilding.HP <= 0 {
				events = append(events, &model.GameEvent{
					EventType:       model.EvtEntityDestroyed,
					VisibilityScope: player.PlayerID,
					Payload: map[string]any{
						"entity_id":  targetBuilding.ID,
						"entity_type": "building",
						"source":    "enemy_force",
					},
				})
			}
		}
	}

	return events
}

// findNearestPlayerBuilding 找到最近玩家建筑
func findNearestPlayerBuilding(ws *model.WorldState, playerID string) *model.Building {
	if ws == nil || ws.Buildings == nil {
		return nil
	}

	var nearest *model.Building
	minDist := int(^uint(0) >> 1) // MaxInt

	for _, b := range ws.Buildings {
		if b.OwnerID != playerID || b.HP <= 0 {
			continue
		}

		// 计算到地图中心的距离
		dx := b.Position.X - ws.MapWidth/2
		dy := b.Position.Y - ws.MapHeight/2
		dist := dx*dx + dy*dy
		if dist < minDist {
			minDist = dist
			nearest = b
		}
	}

	return nearest
}
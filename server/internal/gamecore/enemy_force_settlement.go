package gamecore

import (
	"siliconworld/internal/model"
)

// EnemyForceConfig 敌对势力生成配置
type EnemyForceConfig struct {
	SpawnIntervalTicks int64 // 生成间隔tick
	SpawnMargin        int   // 生成边界距
	MaxForces          int   // 最大势力数量
	BaseStrength       int   // 基础实力
	StrengthVariance   int   // 实力方差
}

func defaultEnemyForceConfig() EnemyForceConfig {
	return EnemyForceConfig{
		SpawnIntervalTicks: 200, // 20秒
		SpawnMargin:        5,
		MaxForces:          20,
		BaseStrength:       10,
		StrengthVariance:   5,
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
			SystemID:    ws.PlanetID,
			Forces:      make([]model.EnemyForce, 0),
			ThreatLevel: model.ThreatLevelNone,
			LastAttack:  0,
		}
	}

	// 确保DetectionState已初始化
	if ws.Detections == nil {
		ws.Detections = make(map[string]*model.DetectionState)
	}

	// 1. 生成新敌对势力
	if ws.Tick%cfg.SpawnIntervalTicks == 0 && len(ws.EnemyForces.Forces) < cfg.MaxForces {
		gc.spawnEnemyForce(ws, cfg)
	}

	// 2. 应用信号塔效果（重定向敌人）
	gc.applySignalTowerEffects(ws)

	// 3. 雷达扫描更新检测状态
	gc.updateRadarDetection(ws, gc.world.Tick)

	// 4. 扩散现有敌对势力（考虑减速效果）
	gc.applySlowFieldEffects(ws)
	for i := range ws.EnemyForces.Forces {
		force := &ws.EnemyForces.Forces[i]
		model.SpreadEnemyForce(force, gc.rng)
		// 确保敌对势力在地图边界内
		clampForcePosition(ws, force)
	}

	// 5. 计算威胁等级
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

	// 6. 处理进攻
	nextAttackTick := model.GetNextAttackTick(ws.EnemyForces.LastAttack, ws.EnemyForces.ThreatLevel, rhythm)
	if ws.Tick >= nextAttackTick && ws.EnemyForces.ThreatLevel >= model.ThreatLevelMedium {
		attackEvents := gc.executeEnemyAttack(ws, rhythm)
		events = append(events, attackEvents...)
		ws.EnemyForces.LastAttack = ws.Tick
	}

	// 7. 发布威胁等级变化事件
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

			shieldAbsorbed, remainingDamage := absorbPlanetaryShieldDamage(ws, player.PlayerID, damage)
			shieldRemaining := totalPlanetaryShieldCharge(ws, player.PlayerID)

			// 应用伤害
			targetBuilding.HP -= remainingDamage
			if targetBuilding.HP < 0 {
				targetBuilding.HP = 0
			}

			events = append(events, &model.GameEvent{
				EventType:       model.EvtDamageApplied,
				VisibilityScope: player.PlayerID,
				Payload: map[string]any{
					"entity_id":        targetBuilding.ID,
					"entity_type":      "building",
					"damage":           remainingDamage,
					"hp":               targetBuilding.HP,
					"max_hp":           targetBuilding.MaxHP,
					"source":           "enemy_force",
					"shield_absorbed":  shieldAbsorbed,
					"shield_remaining": shieldRemaining,
				},
			})

			// 如果建筑被摧毁
			if targetBuilding.HP <= 0 {
				events = append(events, &model.GameEvent{
					EventType:       model.EvtEntityDestroyed,
					VisibilityScope: player.PlayerID,
					Payload: map[string]any{
						"entity_id":   targetBuilding.ID,
						"entity_type": "building",
						"source":      "enemy_force",
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

// applySignalTowerEffects 应用信号塔效果（重定向敌人）
func (gc *GameCore) applySignalTowerEffects(ws *model.WorldState) {
	if ws == nil || ws.Buildings == nil {
		return
	}

	for _, building := range ws.Buildings {
		if building.Type != model.BuildingTypeSignalTower {
			continue
		}
		if building.HP <= 0 || building.Runtime.State != model.BuildingWorkRunning {
			continue
		}

		// 信号塔参数
		rangeBonus := 5.0
		redirectChance := 0.3

		for i := range ws.EnemyForces.Forces {
			force := &ws.EnemyForces.Forces[i]
			dist := calculateDistance(building.Position, force.Position)
			visionRange := 10 // 默认信号塔视野范围
			if building.Runtime.Functions.Combat != nil {
				visionRange = building.Runtime.Functions.Combat.Range
			}
			effectiveRange := visionRange + int(rangeBonus)
			if float64(dist) > float64(effectiveRange) {
				continue
			}

			// 重定向几率
			if ws.Tick%10 == 0 && force.TargetPlayer != "" {
				if gc.rng.Float64() < redirectChance {
					force.TargetPlayer = "" // 清除目标，让敌人重新选择目标
				}
			}
		}
	}
}

// updateRadarDetection 更新雷达检测状态
func (gc *GameCore) updateRadarDetection(ws *model.WorldState, currentTick int64) {
	if ws == nil || ws.Buildings == nil {
		return
	}

	for _, building := range ws.Buildings {
		if building.HP <= 0 || building.Runtime.State != model.BuildingWorkRunning {
			continue
		}

		// 检查是否是雷达或信号塔（有检测功能）
		isRadar := building.Type == model.BuildingTypeBattlefieldAnalysisBase
		hasRadarFunc := building.Runtime.Functions.Combat != nil &&
			building.Runtime.Functions.Combat.Range > 0

		if !isRadar && !hasRadarFunc {
			continue
		}

		rangeVal := 10
		if hasRadarFunc {
			rangeVal = building.Runtime.Functions.Combat.Range
		}

		// 扫描范围内的敌人
		for _, force := range ws.EnemyForces.Forces {
			dist := calculateDistance(building.Position, force.Position)
			if dist > rangeVal {
				continue
			}

			// 更新该建筑所属玩家的检测状态
			detection := ws.Detections[building.OwnerID]
			if detection == nil {
				detection = &model.DetectionState{
					PlayerID:          building.OwnerID,
					KnownEnemies:      make([]model.EnemyIntel, 0),
					DetectedPositions: make([]model.Position, 0),
					VisionRange:       float64(rangeVal),
				}
				ws.Detections[building.OwnerID] = detection
			}

			// 检查是否已存在该敌人情报
			found := false
			for i, intel := range detection.KnownEnemies {
				if intel.EnemyID == force.ID {
					// 更新情报
					detection.KnownEnemies[i].Position = force.Position
					detection.KnownEnemies[i].LastSeen = currentTick
					detection.KnownEnemies[i].Strength = force.Strength
					found = true
					break
				}
			}

			if !found {
				// 添加新敌人情报
				intel := model.EnemyIntel{
					EnemyID:     force.ID,
					Type:        string(force.Type),
					Position:    force.Position,
					Strength:    force.Strength,
					LastSeen:    currentTick,
					ThreatLevel: 0,
				}
				detection.KnownEnemies = append(detection.KnownEnemies, intel)
			}

			// 更新探测到的位置
			posFound := false
			for _, pos := range detection.DetectedPositions {
				if pos.X == force.Position.X && pos.Y == force.Position.Y {
					posFound = true
					break
				}
			}
			if !posFound {
				detection.DetectedPositions = append(detection.DetectedPositions, force.Position)
			}
		}
	}
}

// applySlowFieldEffects 应用减速场效果
func (gc *GameCore) applySlowFieldEffects(ws *model.WorldState) {
	if ws == nil || ws.Buildings == nil {
		return
	}

	for _, building := range ws.Buildings {
		if building.HP <= 0 || building.Runtime.State != model.BuildingWorkRunning {
			continue
		}

		// Jammer tower applies slow effect
		if building.Type != model.BuildingTypeJammerTower {
			continue
		}

		slowFactor := 0.5
		rangeVal := 8

		if building.Runtime.Functions.Combat != nil {
			rangeVal = building.Runtime.Functions.Combat.Range
		}

		for i := range ws.EnemyForces.Forces {
			force := &ws.EnemyForces.Forces[i]
			dist := calculateDistance(building.Position, force.Position)
			if dist > rangeVal {
				continue
			}

			// 减速效果：降低扩散速度（通过减小spreadRadius增长来实现）
			// 这里我们标记敌人被减速，实际上在SpreadEnemyForce时会考虑这个标记
			if force.SpreadRadius > 0.5 {
				force.SpreadRadius *= slowFactor
			}
		}
	}
}

// calculateDistance 计算两点之间的距离
func calculateDistance(a, b model.Position) int {
	dx := a.X - b.X
	if dx < 0 {
		dx = -dx
	}
	dy := a.Y - b.Y
	if dy < 0 {
		dy = -dy
	}
	return dx + dy
}

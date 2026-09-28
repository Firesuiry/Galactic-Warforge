package gamecore

import (
	"hash/fnv"
	"sort"

	"siliconworld/internal/model"
	"siliconworld/internal/surface"
)

// 黑雾实体化结算（E1–E3）：
//   - 巢穴（EnemyForce type=hive）是静态的敌方实体，可被攻击摧毁（战利品走既有掉落）；
//   - 威胁值随玩家发电/工业活动累积（E2），决定巢穴等级、孵化节奏、波次规模与扩张；
//   - 巢穴按节奏孵化黑雾蜂群单位（UnitTypeDarkFog，归属 DarkFogOwnerID），
//     与玩家单位共用同一套移动/交战结算（E1）；
//   - 波次出发时发 enemy_wave_incoming 预警，袭击目标优先电厂/矿区/物流线/炮塔（E3）。

// blackFogTuning 黑雾难度参数。
type blackFogTuning struct {
	meterRate    float64 // 每 tick 每点发电的威胁累积
	waveSizeMul  float64 // 波次规模倍率
	nestCap      int     // 巢穴数量上限
	darkUnitCap  int     // 黑雾单位数量上限
	initialNests int     // 初始巢穴数
}

func blackFogTuningFor(difficulty string) blackFogTuning {
	switch difficulty {
	case "off", "peaceful":
		// 和平模式：不生成巢穴（已有的巢穴/黑雾单位保留但不扩张）。
		return blackFogTuning{meterRate: 0, waveSizeMul: 0, nestCap: 0, darkUnitCap: 0, initialNests: 0}
	case "easy":
		return blackFogTuning{meterRate: 0.00008, waveSizeMul: 0.7, nestCap: 4, darkUnitCap: 40, initialNests: 1}
	case "hard":
		return blackFogTuning{meterRate: 0.0003, waveSizeMul: 1.4, nestCap: 9, darkUnitCap: 90, initialNests: 3}
	default: // normal
		return blackFogTuning{meterRate: 0.00015, waveSizeMul: 1.0, nestCap: 6, darkUnitCap: 60, initialNests: 2}
	}
}

const (
	// blackFogMeterPerLevel 每级巢穴所需威胁值。
	blackFogMeterPerLevel = 100.0
	// blackFogBaseWaveInterval 1 级巢穴的基础孵化间隔（tick）。
	blackFogBaseWaveInterval int64 = 800
	// blackFogWaveIntervalLevelScale 每级缩短孵化间隔的比例。
	blackFogWaveIntervalLevelScale = 0.25
	// blackFogMaxWaveSize 单波次规模上限。
	blackFogMaxWaveSize = 14
	// blackFogRaidReassignTicks 空闲黑雾单位重新指派袭击目标的间隔。
	blackFogRaidReassignTicks = 40
	// blackFogNestMinPlayerDistance 新巢穴距玩家建筑的最小距离（尽力满足）。
	blackFogNestMinPlayerDistance = 50
)

// settleEnemyForces 处理单个世界的黑雾威胁累积、巢穴管理与波次孵化。
func (gc *GameCore) settleEnemyForces(ws *model.WorldState) []*model.GameEvent {
	if gc == nil || ws == nil {
		return nil
	}
	tuning := blackFogTuningFor(gc.cfg.Battlefield.EnemyDifficulty)
	var events []*model.GameEvent

	if ws.EnemyForces == nil {
		ws.EnemyForces = &model.EnemyForceState{
			SystemID:    ws.PlanetID,
			Forces:      make([]model.EnemyForce, 0),
			ThreatLevel: model.ThreatLevelNone,
		}
	}

	// 1. 威胁累积（E2）：随全行星玩家发电总量累积。
	if snapshot := model.CurrentPowerSettlementSnapshot(ws); snapshot != nil {
		generation := 0
		for _, player := range snapshot.Players {
			generation += player.Generation
		}
		ws.EnemyForces.ThreatMeter += float64(generation) * tuning.meterRate
	}
	level := blackFogNestLevel(ws.EnemyForces.ThreatMeter)

	// 2. 巢穴管理：初始巢穴 + 威胁阈值扩张（和平模式跳过全部生成）。
	nests := blackFogNests(ws)
	if tuning.nestCap == 0 {
		// off/peaceful：不生成。
	} else if len(nests) == 0 {
		for i := 0; i < tuning.initialNests; i++ {
			if nest := gc.spawnBlackFogNest(ws, level); nest != nil {
				events = append(events, blackFogNestEvent(ws, nest, "emerged"))
			}
		}
	} else if len(nests) < tuning.nestCap && len(nests) < 1+int(ws.EnemyForces.ThreatMeter/150.0) {
		if nest := gc.spawnBlackFogNest(ws, level); nest != nil {
			events = append(events, blackFogNestEvent(ws, nest, "expanded"))
		}
	}

	// 3. 波次孵化（E1）：每个巢穴按自身节奏孵化一波蜂群单位。
	if tuning.darkUnitCap > 0 && blackFogUnitCount(ws) < tuning.darkUnitCap {
		for _, nest := range blackFogNests(ws) {
			if ws.Tick-nest.LastWaveTick < blackFogWaveInterval(level) {
				continue
			}
			nest.LastWaveTick = ws.Tick
			events = append(events, gc.spawnBlackFogWave(ws, nest, level, tuning)...)
			if blackFogUnitCount(ws) >= tuning.darkUnitCap {
				break
			}
		}
	}

	// 4. 空闲黑雾单位重新指派袭击目标（E3：打完一处打下一处）。
	if ws.Tick%blackFogRaidReassignTicks == 0 {
		reassignBlackFogRaidTargets(ws)
	}

	// 5. 既有辅助效果：减速场、传感接触。
	gc.applySlowFieldEffects(ws)
	settlePlanetSensorContacts(ws, ws.Tick)

	// 6. 威胁等级（UI 总览）。
	params := model.DefaultThreatParams()
	ws.EnemyForces.ThreatLevel = model.ThreatLevelNone
	for _, player := range ws.Players {
		if !player.IsAlive {
			continue
		}
		playerPos := getPlayerCenterPosition(ws, player.PlayerID)
		threat := model.CalculateThreatLevel(ws, ws.EnemyForces.Forces, playerPos, params)
		if threat > ws.EnemyForces.ThreatLevel {
			ws.EnemyForces.ThreatLevel = threat
		}
	}
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
					"threat_meter": ws.EnemyForces.ThreatMeter,
				},
			})
		}
	}

	return events
}

// blackFogNestLevel 由威胁值折算巢穴等级（≥1）。
func blackFogNestLevel(meter float64) int {
	level := 1 + int(meter/blackFogMeterPerLevel)
	if level < 1 {
		level = 1
	}
	return level
}

// blackFogWaveInterval 巢穴当前等级的孵化间隔。
func blackFogWaveInterval(level int) int64 {
	scale := 1.0 + float64(level-1)*blackFogWaveIntervalLevelScale
	interval := int64(float64(blackFogBaseWaveInterval) / scale)
	if interval < 200 {
		interval = 200
	}
	return interval
}

// blackFogNests 返回全部存活巢穴（稳定顺序）。
func blackFogNests(ws *model.WorldState) []*model.EnemyForce {
	if ws.EnemyForces == nil {
		return nil
	}
	var nests []*model.EnemyForce
	for i := range ws.EnemyForces.Forces {
		force := &ws.EnemyForces.Forces[i]
		if force.Type == model.EnemyForceTypeHive && force.Strength > 0 {
			nests = append(nests, force)
		}
	}
	sort.Slice(nests, func(i, j int) bool { return nests[i].ID < nests[j].ID })
	return nests
}

// blackFogUnitCount 统计当前世界的黑雾单位数。
func blackFogUnitCount(ws *model.WorldState) int {
	count := 0
	for _, unit := range ws.Units {
		if unit != nil && unit.OwnerID == model.DarkFogOwnerID && unit.HP > 0 {
			count++
		}
	}
	return count
}

// spawnBlackFogNest 在远离玩家建筑的位置生成新巢穴。
// 位置由 (行星, 巢穴序号, 盐值) 的 FNV 哈希确定性派生——不消费随机序列，
// 回放、读档与回滚在任何时刻得到完全相同的位置。
func (gc *GameCore) spawnBlackFogNest(ws *model.WorldState, level int) *model.EnemyForce {
	if ws == nil {
		return nil
	}
	minDist := blackFogNestMinPlayerDistance
	seq := ws.EnemyForces.NestSeq
	var pos model.Position
	found := false
	for attempt := 0; attempt < 96; attempt++ {
		h := fnv.New64a()
		_, _ = h.Write([]byte(ws.PlanetID))
		_, _ = h.Write([]byte{byte(seq), byte(attempt)})
		pos = model.Position{X: int(h.Sum64() % uint64(ws.MapWidth)), Y: int(h.Sum64() >> 32 % uint64(ws.MapHeight))}
		if !ws.InBounds(pos.X, pos.Y) || !ws.Grid[pos.Y][pos.X].Terrain.Buildable() {
			continue
		}
		if ws.Grid[pos.Y][pos.X].BuildingID != "" {
			continue
		}
		// 随尝试次数放宽距离要求，保证小地图也能生成。
		need := minDist - attempt/8*10
		if need < 8 {
			need = 8
		}
		safe := true
		for _, building := range ws.Buildings {
			if ws.SurfaceDistance(pos, building.Position) < need {
				safe = false
				break
			}
		}
		if safe {
			found = true
			break
		}
	}
	if !found {
		return nil
	}
	ws.EnemyForces.NestSeq = seq + 1
	strength := 60 + level*40
	nest := model.EnemyForce{
		ID:           ws.NextEntityID("enemy"),
		Type:         model.EnemyForceTypeHive,
		Position:     pos,
		Strength:     strength,
		SpreadRadius: 1.0,
		SpawnTick:    ws.Tick,
		LastWaveTick: ws.Tick, // 出生后先等一个完整间隔
	}
	ws.EnemyForces.Forces = append(ws.EnemyForces.Forces, nest)
	return &ws.EnemyForces.Forces[len(ws.EnemyForces.Forces)-1]
}

// spawnBlackFogWave 巢穴孵化一波蜂群单位并指派袭击目标（E1/E3）。
func (gc *GameCore) spawnBlackFogWave(ws *model.WorldState, nest *model.EnemyForce, level int, tuning blackFogTuning) []*model.GameEvent {
	waveSize := int(float64(3+level+int(ws.EnemyForces.ThreatMeter/200.0)) * tuning.waveSizeMul)
	if waveSize > blackFogMaxWaveSize {
		waveSize = blackFogMaxWaveSize
	}
	if waveSize < 1 {
		waveSize = 1
	}

	target := selectBlackFogRaidTarget(ws, nest.Position)
	spawned := 0
	for _, candidate := range blackFogSpawnTiles(ws, nest.Position, waveSize) {
		unit := newBlackFogUnit(ws, candidate, level)
		if target != nil {
			unit.AttackTarget = target.building.ID
			orderPos := target.building.Position
			unit.OrderPos = &orderPos
			unit.Stance = model.UnitStanceAttackMove
			if path, ok := computeUnitPath(ws, unit.Position, target.building.Position, unit.ID); ok && len(path) > 1 {
				unit.Path = path
				unit.PathIndex = 1
			}
		}
		ws.Units[unit.ID] = unit
		key := model.TileKey(candidate.X, candidate.Y)
		ws.TileUnits[key] = append(ws.TileUnits[key], unit.ID)
		spawned++
	}
	if spawned == 0 {
		return nil
	}

	payload := map[string]any{
		"nest_id":    nest.ID,
		"from":       nest.Position,
		"count":      spawned,
		"level":      level,
		"threat":     ws.EnemyForces.ThreatLevel,
		"wave_tick":  ws.Tick,
		"unit_speed": model.UnitStats(model.UnitTypeDarkFog).MoveSpeed,
	}
	if target != nil {
		payload["target_building_id"] = target.building.ID
		payload["target_pos"] = target.building.Position
		payload["target_owner"] = target.building.OwnerID
		payload["target_rank"] = target.rank
	}
	return []*model.GameEvent{{
		EventType:       model.EvtEnemyWaveIncoming,
		VisibilityScope: "all",
		Payload:         payload,
	}}
}

// newBlackFogUnit 创建一个黑雾蜂群单位（属性随巢穴等级成长）。
func newBlackFogUnit(ws *model.WorldState, pos model.Position, level int) *model.Unit {
	stats := model.UnitStats(model.UnitTypeDarkFog)
	scale := 1.0 + float64(level-1)*0.15
	unit := &model.Unit{
		ID:                 ws.NextEntityID("df"),
		Type:               model.UnitTypeDarkFog,
		OwnerID:            model.DarkFogOwnerID,
		Position:           pos,
		HP:                 int(float64(stats.HP) * scale),
		MaxHP:              int(float64(stats.MaxHP) * scale),
		Attack:             int(float64(stats.Attack) * scale),
		Defense:            stats.Defense,
		AttackRange:        stats.AttackRange,
		MoveRange:          stats.MoveRange,
		VisionRange:        stats.VisionRange,
		MoveSpeed:          stats.MoveSpeed,
		AttackCooldownTick: stats.AttackCooldownTick,
		AggroRange:         stats.AggroRange,
		Stance:             model.UnitStanceIdle,
	}
	return unit
}

// blackFogSpawnTiles 巢穴周围的可进入产卵格（半径 1~3 环带扫描）。
func blackFogSpawnTiles(ws *model.WorldState, center model.Position, want int) []model.Position {
	var tiles []model.Position
	for radius := 1; radius <= 3 && len(tiles) < want; radius++ {
		for _, candidate := range ws.SurfaceDisc(center, radius) {
			if ws.SurfaceDistance(center, candidate) != radius {
				continue
			}
			if !tileWalkableForUnit(ws, candidate, "") {
				continue
			}
			tiles = append(tiles, candidate)
			if len(tiles) >= want {
				break
			}
		}
	}
	return tiles
}

// blackFogRaidTarget 袭击目标（E3 优先级）。
type blackFogRaidTarget struct {
	building *model.Building
	rank     int
}

// blackFogBuildingRank 袭击优先级：电厂 > 矿区 > 物流线 > 炮塔 > 其他。
func blackFogBuildingRank(ws *model.WorldState, b *model.Building) int {
	if b.Runtime.Functions.Energy != nil && b.Runtime.Functions.Energy.OutputPerTick > 0 {
		return 0
	}
	if model.IsDefenseBuilding(b.Type) {
		return 3
	}
	def, ok := model.BuildingDefinitionByID(b.Type)
	if ok {
		switch def.Category {
		case "mining":
			return 1
		case "logistics":
			return 2
		}
	}
	return 4
}

// selectBlackFogRaidTarget 选取最优袭击目标：最优优先级内距离最近。
func selectBlackFogRaidTarget(ws *model.WorldState, from model.Position) *blackFogRaidTarget {
	var best *blackFogRaidTarget
	bestDist := -1
	for _, b := range ws.Buildings {
		if b == nil || b.HP <= 0 || b.OwnerID == "" || b.OwnerID == model.DarkFogOwnerID {
			continue
		}
		rank := blackFogBuildingRank(ws, b)
		dist := ws.SurfaceDistance(from, b.Position)
		if best == nil || rank < best.rank || (rank == best.rank && dist < bestDist) {
			best = &blackFogRaidTarget{building: b, rank: rank}
			bestDist = dist
		}
	}
	return best
}

// reassignBlackFogRaidTargets 给失去目标的空闲黑雾单位指派新的袭击目标。
func reassignBlackFogRaidTargets(ws *model.WorldState) {
	ids := make([]string, 0, len(ws.Units))
	for id, unit := range ws.Units {
		if unit != nil && unit.OwnerID == model.DarkFogOwnerID && unit.HP > 0 {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		unit := ws.Units[id]
		if unit.AttackTarget != "" || unit.HasPath() {
			continue
		}
		target := selectBlackFogRaidTarget(ws, unit.Position)
		if target == nil {
			continue
		}
		unit.AttackTarget = target.building.ID
		orderPos := target.building.Position
		unit.OrderPos = &orderPos
		unit.Stance = model.UnitStanceAttackMove
		if path, ok := computeUnitPath(ws, unit.Position, target.building.Position, unit.ID); ok && len(path) > 1 {
			unit.Path = path
			unit.PathIndex = 1
			unit.MoveProgress = 0
		}
	}
}

// blackFogNestEvent 巢穴出现/扩张事件。
func blackFogNestEvent(ws *model.WorldState, nest *model.EnemyForce, reason string) *model.GameEvent {
	return &model.GameEvent{
		EventType:       model.EvtEntityCreated,
		VisibilityScope: "all",
		Payload: map[string]any{
			"entity_type": "enemy_force",
			"entity_id":   nest.ID,
			"force_type":  nest.Type,
			"position":    nest.Position,
			"strength":    nest.Strength,
			"reason":      reason,
		},
	}
}

// getPlayerCenterPosition 获取玩家中心位置（所有建筑的平均位置）
func getPlayerCenterPosition(ws *model.WorldState, playerID string) model.Position {
	if ws == nil {
		return model.Position{X: 0, Y: 0}
	}
	if ws.Buildings == nil {
		return model.Position{X: ws.MapWidth / 2, Y: ws.MapHeight / 2}
	}

	var sum [3]float64
	count := 0
	for _, b := range ws.Buildings {
		if b.OwnerID == playerID {
			v := ws.Surface().Normal(surface.Tile{X: b.Position.X, Y: b.Position.Y})
			for i := range sum {
				sum[i] += v[i]
			}
			count++
		}
	}
	if count == 0 || sum[0]*sum[0]+sum[1]*sum[1]+sum[2]*sum[2] < 1e-12 {
		return model.Position{X: ws.Surface().Size / 2, Y: ws.Surface().Size / 2}
	}
	t := ws.Surface().FromVector(sum[0], sum[1], sum[2])
	return model.Position{X: t.X, Y: t.Y}
}

// updateRadarDetection 更新雷达检测状态
func (gc *GameCore) updateRadarDetection(ws *model.WorldState, currentTick int64) {
	settlePlanetSensorContacts(ws, currentTick)
}

// applySlowFieldEffects 应用减速场效果：降低范围内黑雾单位的移动力。
func (gc *GameCore) applySlowFieldEffects(ws *model.WorldState) {
	if ws == nil || ws.Buildings == nil {
		return
	}

	for _, building := range ws.Buildings {
		if building.HP <= 0 || building.Runtime.State != model.BuildingWorkRunning {
			continue
		}
		if building.Type != model.BuildingTypeJammerTower {
			continue
		}

		slowFactor := 0.5
		rangeVal := 8
		if building.Runtime.Functions.Combat != nil {
			rangeVal = building.Runtime.Functions.Combat.Range
		}

		// 减速实体化的黑雾单位：直接削减本 tick 的移动进度（E1 后的真实减速）。
		for _, unit := range ws.Units {
			if unit == nil || unit.OwnerID != model.DarkFogOwnerID || !unit.HasPath() {
				continue
			}
			if ws.SurfaceDistance(building.Position, unit.Position) > rangeVal {
				continue
			}
			unit.MoveProgress *= slowFactor
		}

		for i := range ws.EnemyForces.Forces {
			force := &ws.EnemyForces.Forces[i]
			dist := ws.SurfaceDistance(building.Position, force.Position)
			if dist > rangeVal {
				continue
			}
			if force.SpreadRadius > 0.5 {
				force.SpreadRadius *= slowFactor
			}
		}
	}
}

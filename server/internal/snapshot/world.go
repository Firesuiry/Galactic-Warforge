package snapshot

import (
	"errors"
	"fmt"

	"siliconworld/internal/model"
	"siliconworld/internal/surface"
	"siliconworld/internal/terrain"
)

// WorldSnapshot captures the authoritative world state at a tick.
type WorldSnapshot struct {
	Tick            int64                                 `json:"tick"`
	PlanetID        string                                `json:"planet_id"`
	MapWidth        int                                   `json:"map_width"`
	MapHeight       int                                   `json:"map_height"`
	Surface         surface.Metadata                      `json:"surface"`
	EntityCounter   int64                                 `json:"entity_counter"`
	Players         map[string]*model.PlayerState         `json:"players"`
	Buildings       map[string]*BuildingSnapshot          `json:"buildings"`
	Units           map[string]*model.Unit                `json:"units"`
	LogisticsBots   map[string]*model.LogisticsBotState   `json:"logistics_bots,omitempty"`
	LogisticsDrones map[string]*model.LogisticsDroneState `json:"logistics_drones,omitempty"`
	LogisticsShips  map[string]*model.LogisticsShipState  `json:"logistics_ships,omitempty"`
	// ResourceDeltas 只存与资源基线的差异（剩余量/当前产速/耗尽），节点本身
	// （种类/位置/储量上限/基础产速）由地图配置 + seed 确定性重建，见
	// WorldState.ResourceBaseline。与基线一致的节点不出现在这里。
	ResourceDeltas map[string]model.ResourceNodeDelta `json:"resource_deltas,omitempty"`
	// ResourceBaseline 是资源节点静态字段的基线，不进 JSON：它可由地图配置 +
	// seed 确定性重建。进程内快照（回放/回滚/自动存档的副本）由 CaptureWorld 直接
	// 带上；磁盘快照读回后由 gamecore.NewFromSave 用地图模型重建并挂回。
	ResourceBaseline map[string]model.ResourceBaselineEntry `json:"-"`
	Pipelines        *model.PipelineNetworkState            `json:"pipelines,omitempty"`
	Construction     *model.ConstructionQueue               `json:"construction,omitempty"`
	EnemyForces      *model.EnemyForceState                 `json:"enemy_forces,omitempty"`
	SensorContacts   map[string]*model.SensorContactState   `json:"sensor_contacts,omitempty"`
	CombatRuntime    *model.CombatRuntimeState              `json:"combat_runtime,omitempty"`
	// Terrain 是地形游程编码（非 buildable 格的行内游程）。只由地图配置 + seed
	// 决定的整幅地形不进快照，见 TerrainRuns。
	Terrain string `json:"terrain,omitempty"`
}

// BuildingSnapshot is a snapshot-friendly building payload.
type BuildingSnapshot struct {
	ID          string             `json:"id"`
	Type        model.BuildingType `json:"type"`
	OwnerID     string             `json:"owner_id"`
	Position    model.Position     `json:"position"`
	HP          int                `json:"hp"`
	MaxHP       int                `json:"max_hp"`
	Level       int                `json:"level"`
	VisionRange int                `json:"vision_range"`
	// Rotation 是建造朝向。分拣器的取/放端（背面取货、正面放货）直接由它派生
	// （model.SorterFacingAxis），矿机定下的开采矿种也按它算；漏存会让读档后的
	// 分拣器退化成 rotation=0，整条产线停摆（第 16 轮 cp-base 读档即复现）。
	Rotation          model.PlanRotation           `json:"rotation,omitempty"`
	Runtime           model.BuildingRuntime        `json:"runtime"`
	Storage           *model.StorageState          `json:"storage,omitempty"`
	Distributor       *model.DistributorState      `json:"distributor,omitempty"`
	EnergyStorage     *model.EnergyStorageState    `json:"energy_storage,omitempty"`
	Conveyor          *model.ConveyorState         `json:"conveyor,omitempty"`
	Splitter          *model.SplitterState         `json:"splitter,omitempty"`
	TrafficMonitor    *model.TrafficMonitorState   `json:"traffic_monitor,omitempty"`
	Fractionation     *model.FractionationState    `json:"fractionation,omitempty"`
	SprayCoater       *model.SprayCoaterState      `json:"spray_coater,omitempty"`
	Sorter            *model.SorterState           `json:"sorter,omitempty"`
	LogisticsStation  *model.LogisticsStationState `json:"logistics_station,omitempty"`
	Production        *model.ProductionState       `json:"production,omitempty"`
	Job               *BuildingJobSnapshot         `json:"job,omitempty"`
	FoundationTerrain []string                     `json:"foundation_terrain,omitempty"`
}

// BuildingJobSnapshot preserves in-flight job state for snapshots.
type BuildingJobSnapshot struct {
	Type           model.BuildingJobType   `json:"type"`
	RemainingTicks int                     `json:"remaining_ticks"`
	TargetLevel    int                     `json:"target_level,omitempty"`
	RefundRate     float64                 `json:"refund_rate,omitempty"`
	PrevState      model.BuildingWorkState `json:"prev_state,omitempty"`
}

// CaptureWorld builds a world snapshot from runtime state.
func CaptureWorld(ws *model.WorldState) *WorldSnapshot {
	if ws == nil {
		return nil
	}
	ws.RLock()
	defer ws.RUnlock()

	snap := &WorldSnapshot{
		Tick:            ws.Tick,
		PlanetID:        ws.PlanetID,
		MapWidth:        ws.MapWidth,
		MapHeight:       ws.MapHeight,
		Surface:         (surface.Grid{Size: ws.MapWidth / 3}).Metadata(),
		EntityCounter:   ws.EntityCounter,
		Players:         make(map[string]*model.PlayerState, len(ws.Players)),
		Buildings:       make(map[string]*BuildingSnapshot, len(ws.Buildings)),
		Units:           make(map[string]*model.Unit, len(ws.Units)),
		LogisticsBots:   make(map[string]*model.LogisticsBotState, len(ws.LogisticsBots)),
		LogisticsDrones: make(map[string]*model.LogisticsDroneState, len(ws.LogisticsDrones)),
		LogisticsShips:  make(map[string]*model.LogisticsShipState, len(ws.LogisticsShips)),
		ResourceDeltas:  ws.ResourceDeltas(),
		// 资源基线随进程内快照一起带上：回放/回滚/自动存档都用同一进程的
		// WorldState 副本，不经过磁盘，无法也不该重新生成地图。
		ResourceBaseline: cloneResourceBaseline(ws.ResourceBaseline),
		Pipelines:        clonePipelineNetworkState(ws.Pipelines),
		Construction:     cloneConstructionQueue(ws.Construction),
		EnemyForces:      cloneEnemyForceState(ws.EnemyForces),
		SensorContacts:   model.CloneSensorContactStateMap(ws.SensorContacts),
		CombatRuntime:    model.CloneCombatRuntimeState(ws.CombatRuntime),
		Terrain:          model.TerrainRuns(ws.Grid, ws.MapWidth, ws.MapHeight),
	}

	for id, ps := range ws.Players {
		snap.Players[id] = clonePlayer(ps)
	}
	for id, b := range ws.Buildings {
		snap.Buildings[id] = cloneBuilding(b)
	}
	for id, u := range ws.Units {
		snap.Units[id] = u.Clone()
	}
	for id, b := range ws.LogisticsBots {
		snap.LogisticsBots[id] = b.Clone()
	}
	for id, d := range ws.LogisticsDrones {
		snap.LogisticsDrones[id] = cloneLogisticsDrone(d)
	}
	for id, ship := range ws.LogisticsShips {
		snap.LogisticsShips[id] = cloneLogisticsShip(ship)
	}
	return snap
}

// Restore reconstructs a WorldState from the snapshot.
func (snap *WorldSnapshot) Restore() (*model.WorldState, error) {
	if snap == nil {
		return nil, errors.New("world snapshot is nil")
	}
	if snap.Surface.Topology != "cube_sphere" || snap.Surface.FaceSize < 1 || snap.MapWidth != 3*snap.Surface.FaceSize || snap.MapHeight != 2*snap.Surface.FaceSize {
		return nil, fmt.Errorf("unsupported or inconsistent planetary surface: expected cube_sphere atlas 3N x 2N, got topology %q face_size %d atlas %dx%d; start a new game for legacy planar saves", snap.Surface.Topology, snap.Surface.FaceSize, snap.MapWidth, snap.MapHeight)
	}
	terrainGrid, err := decodeSnapshotTerrain(snap.Terrain, snap.MapWidth, snap.MapHeight)
	if err != nil {
		return nil, err
	}

	ws := model.NewWorldState(snap.PlanetID, snap.Surface.FaceSize)
	ws.Tick = snap.Tick
	ws.EntityCounter = snap.EntityCounter
	// 资源基线：磁盘快照里没有（由地图配置 + seed 重建，见 gamecore.NewFromSave），
	// 进程内快照由 CaptureWorld 带上；两者都没有时下面按「全部已变化」兜底。
	ws.ResourceBaseline = cloneResourceBaseline(snap.ResourceBaseline)

	// Restore terrain.
	for y := 0; y < snap.MapHeight; y++ {
		for x := 0; x < snap.MapWidth; x++ {
			ws.Grid[y][x].Terrain = terrainGrid[y][x]
			ws.Grid[y][x].ResourceNodeID = ""
			ws.Grid[y][x].BuildingID = ""
		}
	}

	// Restore players.
	ws.Players = make(map[string]*model.PlayerState, len(snap.Players))
	for id, ps := range snap.Players {
		if ps == nil {
			return nil, fmt.Errorf("player snapshot missing for %s", id)
		}
		player := clonePlayer(ps)
		if player != nil {
			player.SetPermissions(player.Permissions)
		}
		ws.Players[id] = player
	}

	// Restore buildings.
	ws.Buildings = make(map[string]*model.Building, len(snap.Buildings))
	for id, b := range snap.Buildings {
		building, err := restoreBuilding(id, b)
		if err != nil {
			return nil, err
		}
		ws.Buildings[building.ID] = building
	}
	model.RebuildLogisticsStations(ws)
	model.RebuildPowerGrid(ws)

	// Restore units.
	ws.Units = make(map[string]*model.Unit, len(snap.Units))
	for id, u := range snap.Units {
		if u == nil {
			return nil, fmt.Errorf("unit snapshot missing for %s", id)
		}
		ws.Units[id] = u.Clone()
		if u.Mecha != nil {
			if len(u.Mecha.LogisticsRequests) > 8 {
				return nil, fmt.Errorf("too many mecha logistics requests")
			}
			for item, request := range u.Mecha.LogisticsRequests {
				definition, ok := model.Item(item)
				if !ok || definition.Form != model.ResourceSolid || request.Min < 0 || request.Max < 1 || request.Max > 1000 || request.Min > request.Max {
					return nil, fmt.Errorf("invalid mecha logistics request")
				}
			}
		}
	}

	// Restore independent cargo owners even if their distributor no longer exists.
	ws.LogisticsBots = make(map[string]*model.LogisticsBotState, len(snap.LogisticsBots))
	for id, b := range snap.LogisticsBots {
		if b == nil {
			return nil, fmt.Errorf("missing logistics bot %s", id)
		}
		if err := b.Validate(); err != nil {
			return nil, err
		}
		if id != b.ID || ws.Players[b.OwnerID] == nil || !ws.InBounds(b.Position.X, b.Position.Y) || !ws.InBounds(b.HomePos.X, b.HomePos.Y) || (b.TargetPos != nil && !ws.InBounds(b.TargetPos.X, b.TargetPos.Y)) {
			return nil, fmt.Errorf("invalid logistics bot identity or position %s", id)
		}
		if home := ws.Buildings[b.DistributorID]; home != nil && (home.OwnerID != b.OwnerID || home.Distributor == nil) {
			return nil, fmt.Errorf("bot home ownership mismatch")
		}
		ws.LogisticsBots[id] = b.Clone()
	}
	for _, b := range ws.Buildings {
		if b.Distributor != nil && model.DistributorBotCount(ws, b.ID) > b.Distributor.BotCapacity {
			return nil, fmt.Errorf("distributor robot capacity exceeded")
		}
	}
	// Restore logistics drones.
	ws.LogisticsDrones = make(map[string]*model.LogisticsDroneState, len(snap.LogisticsDrones))
	for id, d := range snap.LogisticsDrones {
		if d == nil {
			return nil, fmt.Errorf("logistics drone snapshot missing for %s", id)
		}
		ws.LogisticsDrones[id] = cloneLogisticsDrone(d)
	}
	// Restore logistics ships.
	ws.LogisticsShips = make(map[string]*model.LogisticsShipState, len(snap.LogisticsShips))
	for id, ship := range snap.LogisticsShips {
		if ship == nil {
			return nil, fmt.Errorf("logistics ship snapshot missing for %s", id)
		}
		ws.LogisticsShips[id] = cloneLogisticsShip(ship)
	}

	// Restore resources: 基线节点（静态字段由地图配置 + seed 重建）+ 快照里的差异。
	// 与基线一致的节点不在差异表里，但必须照样建出来——它们仍能被开采、被渲染、
	// 被查询层列出（只有「未变化」这一件事不进快照）。
	ws.Resources = make(map[string]*model.ResourceNodeState, len(snap.ResourceBaseline)+len(snap.ResourceDeltas))
	for id, base := range snap.ResourceBaseline {
		if id == "" {
			return nil, fmt.Errorf("resource baseline has an empty node id")
		}
		if base.MaxAmount < 0 || base.BaseYield < 0 {
			return nil, fmt.Errorf("resource baseline node %s has an invalid amount or yield", id)
		}
		node := &model.ResourceNodeState{
			ID:           id,
			PlanetID:     snap.PlanetID,
			Kind:         base.Kind,
			Behavior:     base.Behavior,
			Position:     model.Position{X: base.X, Y: base.Y},
			ClusterID:    base.ClusterID,
			MaxAmount:    base.MaxAmount,
			Remaining:    base.MaxAmount,
			BaseYield:    base.BaseYield,
			CurrentYield: base.BaseYield,
			MinYield:     base.MinYield,
			RegenPerTick: base.RegenPerTick,
			DecayPerTick: base.DecayPerTick,
			IsRare:       base.IsRare,
		}
		node.SyncDepleted()
		ws.Resources[id] = node
		// 基线节点就是 mapgen 直接产出的矿脉：读档后必须重新标记，
		// 否则下一次存档会把每个资源节点整份写进快照（实测 0.8MB → 17MB）。
		ws.MapResourceIDs[id] = true
	}
	for id, delta := range snap.ResourceDeltas {
		if id == "" {
			return nil, fmt.Errorf("resource snapshot has an empty node id")
		}
		if delta.Node != nil {
			node := cloneResource(delta.Node)
			if node == nil || node.ID != id {
				return nil, fmt.Errorf("resource snapshot node %s has a mismatched payload", id)
			}
			node.SyncDepleted()
			ws.Resources[id] = node
			continue
		}
		node := ws.Resources[id]
		if node == nil {
			return nil, fmt.Errorf("resource snapshot node %s is not part of the map baseline", id)
		}
		node.Remaining = delta.Remaining
		node.CurrentYield = delta.CurrentYield
		if delta.Remaining < 0 || delta.Remaining > node.MaxAmount || node.CurrentYield < 0 || node.CurrentYield > node.BaseYield {
			return nil, fmt.Errorf("resource snapshot node %s has an invalid delta", id)
		}
		node.SyncDepleted()
	}
	ws.Pipelines = clonePipelineNetworkState(snap.Pipelines)
	ws.Construction = cloneConstructionQueue(snap.Construction)
	ws.EnemyForces = cloneEnemyForceState(snap.EnemyForces)
	ws.SensorContacts = model.CloneSensorContactStateMap(snap.SensorContacts)
	ws.CombatRuntime = model.CloneCombatRuntimeState(snap.CombatRuntime)
	if ws.Construction == nil {
		ws.Construction = model.NewConstructionQueue()
	} else {
		ws.Construction.EnsureInit()
		if err := ws.Construction.RebuildReservations(ws); err != nil {
			return nil, err
		}
	}

	// Rebuild tile occupancy and link tiles.
	ws.TileBuilding = make(map[string]string)
	ws.TileUnits = make(map[string][]string)

	for id, building := range ws.Buildings {
		if !ws.InBounds(building.Position.X, building.Position.Y) {
			return nil, fmt.Errorf("building %s out of bounds", id)
		}
		if err := ws.IndexBuilding(building); err != nil {
			return nil, fmt.Errorf("building %s occupancy: %w", id, err)
		}
	}

	for id, unit := range ws.Units {
		if !ws.InBounds(unit.Position.X, unit.Position.Y) {
			return nil, fmt.Errorf("unit %s out of bounds", id)
		}
		key := model.TileKey(unit.Position.X, unit.Position.Y)
		ws.TileUnits[key] = append(ws.TileUnits[key], id)
	}

	for id, res := range ws.Resources {
		if !ws.InBounds(res.Position.X, res.Position.Y) {
			return nil, fmt.Errorf("resource %s out of bounds", id)
		}
		res.SyncDepleted()
		cell := &ws.Grid[res.Position.Y][res.Position.X]
		if cell.ResourceNodeID != "" && cell.ResourceNodeID != id {
			return nil, fmt.Errorf("duplicate resource occupancy at %d,%d", res.Position.X, res.Position.Y)
		}
		cell.ResourceNodeID = id
	}

	// 可再生矿脉索引：结算每 tick 只扫这些（资源 cell 数在细分网格下是万级）。
	indexRenewableResources(ws)

	return ws, nil
}

// indexRenewableResources 重建可再生矿脉索引（与 gamecore.IndexRenewableResources
// 同一口径；snapshot 包不能反向依赖 gamecore，故这里就地实现）。
func indexRenewableResources(ws *model.WorldState) {
	if ws == nil {
		return
	}
	ws.RenewableResources = ws.RenewableResources[:0]
	for _, node := range ws.Resources {
		if node != nil && node.Behavior == "renewable" && node.RegenPerTick > 0 {
			ws.RenewableResources = append(ws.RenewableResources, node)
		}
	}
}

func cloneEnemyForceState(state *model.EnemyForceState) *model.EnemyForceState {
	if state == nil {
		return nil
	}
	out := *state
	out.Forces = append([]model.EnemyForce(nil), state.Forces...)
	out.NestRuins = append([]model.NestRuin(nil), state.NestRuins...)
	return &out
}

// TerrainRuns encodes a terrain atlas as row runs of non-buildable tiles.
// 细分网格后整幅地形有 6×face_size² 个 cell（遭遇战 49.8 万格），逐格写进快照要
// 5.5MB（缩进后 7.7MB）——而地形只由地图配置与 seed 决定、可由 mapgen 确定性重建，
// 因此只存「与默认 buildable 不同的格」的游程（实测遭遇战 2597 条 / 77KB）。
func TerrainRuns(grid [][]model.MapTile, width, height int) string {
	return model.TerrainRuns(grid, width, height)
}

// DecodeTerrainRuns rebuilds a full terrain atlas from TerrainRuns output.
// 空串表示整幅地形都是 buildable（合法编码）。
func DecodeTerrainRuns(encoded string, width, height int) ([][]terrain.TileType, error) {
	return model.DecodeTerrainRuns(encoded, width, height)
}

// decodeSnapshotTerrain 校验并解码快照里的地形游程。
func decodeSnapshotTerrain(encoded string, width, height int) ([][]terrain.TileType, error) {
	grid, err := DecodeTerrainRuns(encoded, width, height)
	if err != nil {
		return nil, fmt.Errorf("terrain payload: %w", err)
	}
	return grid, nil
}

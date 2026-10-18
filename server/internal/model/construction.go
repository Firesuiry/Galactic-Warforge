package model

import (
	"fmt"

	"siliconworld/internal/terrain"
)

// ConstructionState tracks the lifecycle of a construction task.
type ConstructionState string

const (
	ConstructionPending    ConstructionState = "pending"
	ConstructionInProgress ConstructionState = "in_progress"
	ConstructionPaused     ConstructionState = "paused"
	ConstructionCompleted  ConstructionState = "completed"
	ConstructionCancelled  ConstructionState = "cancelled"
)

// ConstructionTask captures a queued build operation.
type ConstructionTask struct {
	AutoApproach      bool              `json:"auto_approach,omitempty"`
	ID                string            `json:"id"`
	PlayerID          string            `json:"player_id"`
	RegionID          string            `json:"region_id,omitempty"`
	BuildingType      BuildingType      `json:"building_type"`
	Position          Position          `json:"position"`
	Rotation          PlanRotation      `json:"rotation,omitempty"`
	BlueprintParams   BlueprintParams   `json:"blueprint_params,omitempty"`
	ConveyorDirection ConveyorDirection `json:"conveyor_direction,omitempty"`
	RecipeID          string            `json:"recipe_id,omitempty"`
	Cost              BuildCost         `json:"cost,omitempty"`
	State             ConstructionState `json:"state"`
	EnqueueTick       int64             `json:"enqueue_tick"`
	StartTick         int64             `json:"start_tick,omitempty"`
	UpdateTick        int64             `json:"update_tick,omitempty"`
	QueueIndex        int64             `json:"queue_index,omitempty"`
	RemainingTicks    int               `json:"remaining_ticks,omitempty"`
	TotalTicks        int               `json:"total_ticks,omitempty"`
	SpeedBonus        float64           `json:"speed_bonus,omitempty"`
	Priority          int               `json:"priority,omitempty"`
	Error             string            `json:"error,omitempty"`
	// WaitReason 说明 pending 任务为什么还没开工（insufficient_materials /
	// executor_concurrent_limit / region_concurrent_limit），随 runtime 视图下发；
	// 开工后清空。它只解释排队，不代表命令失败。
	// 另有 footprint_occupied：施工已完成、但占地里还站着让不开的地面单位，
	// 落成被推迟到它走开为止（见 gamecore.WaitReasonFootprintOccupied）。
	WaitReason string `json:"wait_reason,omitempty"`
	// MaterialsDeducted indicates whether materials have been deducted for this task.
	// When false, materials are "locked" but not yet deducted (deducted at completion).
	// When true, materials have been deducted (used for proper refund handling).
	MaterialsDeducted bool `json:"materials_deducted,omitempty"`
	// MiningItem 是采集建筑排产时定下的唯一开采矿种（见 model.MiningItemAt）：
	// 下单时算一次、落成时写进建筑，玩家在建造回执/任务视图里就能看到
	// 「这台矿机会采什么」（试玩 1016 报告 B2）。非采集建筑为空。
	MiningItem string `json:"mining_item,omitempty"`
	// Elevation 是传送带施工任务的目标层（第 19 轮契约 §3.2）：0 = 地面，
	// 1..MaxBeltElevation = 高架。高架任务占的是 BeltLayers 的 `x:y@e` 槽位，
	// 不占地面 TileBuilding 预留；落成时写进建筑的 conveyor.elevation。
	Elevation int `json:"elevation,omitempty"`
}

// ReservationKey 返回该任务要占的施工预留键：高架带是 `x:y@e`，其余是 `x,y`。
// 高架带只占自己一格（占地 1×1）。
func (task *ConstructionTask) ReservationKey(p Position) string {
	if task != nil && task.Elevation > 0 {
		return BeltLayerKey(p.X, p.Y, task.Elevation)
	}
	return TileKey(p.X, p.Y)
}

// ReservedGroundTaskAt 返回占着地面格 (x,y) 施工预留的任务；没有时返回 nil。
// 高架任务不占地面键，所以不会命中。
func (q *ConstructionQueue) ReservedGroundTaskAt(x, y int) *ConstructionTask {
	if q == nil || q.ReservedTiles == nil {
		return nil
	}
	return q.Tasks[q.ReservedTiles[TileKey(x, y)]]
}

// ReservedElevatedTaskAt 返回占着高架格 (x,y,e) 施工预留的任务；没有时返回 nil。
func (q *ConstructionQueue) ReservedElevatedTaskAt(x, y, elevation int) *ConstructionTask {
	if q == nil || q.ReservedTiles == nil || elevation <= 0 {
		return nil
	}
	return q.Tasks[q.ReservedTiles[BeltLayerKey(x, y, elevation)]]
}

// GroundReservationConflict 检查高架带任务与地面施工预留的互斥（契约 §3.2）：
// 高架带下方地面只能是空地或低矮物流（含施工中）。对 task.Elevation > 0 的任务，
// 逐格看地面预留；命中非低矮物流的地面施工任务时返回冲突错误（带层号）。
// 非高架任务返回 nil。
func (q *ConstructionQueue) GroundReservationConflict(ws *WorldState, task *ConstructionTask) error {
	if q == nil || task == nil || task.Elevation <= 0 {
		return nil
	}
	tiles, err := ws.ConstructionTiles(task)
	if err != nil {
		return err
	}
	for _, p := range tiles {
		ground := q.ReservedGroundTaskAt(p.X, p.Y)
		if ground == nil || ground.ID == task.ID || IsLowLogistics(ground.BuildingType) {
			continue
		}
		return fmt.Errorf("第 %d 层该格下方有地面施工任务：%s", task.Elevation, ground.BuildingType)
	}
	return nil
}

// ElevatedReservationConflict 检查地面（非低矮物流）任务与高架施工预留的互斥：
// 占地内任一格有高架施工任务时返回冲突错误（带层号与占用者）。低矮物流地面
// 任务与高架预留可共存。高架任务自身返回 nil。
func (q *ConstructionQueue) ElevatedReservationConflict(ws *WorldState, task *ConstructionTask) error {
	if q == nil || task == nil || task.Elevation > 0 || IsLowLogistics(task.BuildingType) {
		return nil
	}
	tiles, err := ws.ConstructionTiles(task)
	if err != nil {
		return err
	}
	for _, p := range tiles {
		for elevation := 1; elevation <= MaxBeltElevation; elevation++ {
			over := q.ReservedElevatedTaskAt(p.X, p.Y, elevation)
			if over == nil || over.ID == task.ID {
				continue
			}
			return fmt.Errorf("该格上方第 %d 层已有传送带施工任务：%s", elevation, over.BuildingType)
		}
	}
	return nil
}

// ConstructionQueue stores pending and active construction tasks.
type ConstructionQueue struct {
	NextSeq       int64                            `json:"next_seq"`
	Tasks         map[string]*ConstructionTask     `json:"tasks"`
	Order         []string                         `json:"order"`
	ReservedTiles map[string]string                `json:"reserved_tiles,omitempty"`
	MaterialRes   *ConstructionMaterialReservation `json:"material_res,omitempty"`
}

// NewConstructionQueue returns an initialized queue.
func NewConstructionQueue() *ConstructionQueue {
	return &ConstructionQueue{
		Tasks:         make(map[string]*ConstructionTask),
		Order:         make([]string, 0),
		ReservedTiles: make(map[string]string),
		MaterialRes:   NewConstructionMaterialReservation(),
	}
}

// EnsureInit initializes maps when the queue is nil or empty.
func (q *ConstructionQueue) EnsureInit() {
	if q == nil {
		return
	}
	if q.Tasks == nil {
		q.Tasks = make(map[string]*ConstructionTask)
	}
	if q.Order == nil {
		q.Order = make([]string, 0)
	}
	if q.ReservedTiles == nil {
		q.ReservedTiles = make(map[string]string)
	}
	if q.MaterialRes == nil {
		q.MaterialRes = NewConstructionMaterialReservation()
	}
}

// CanTransition reports whether a task can move between states.
func (s ConstructionState) CanTransition(next ConstructionState) bool {
	switch s {
	case ConstructionPending:
		return next == ConstructionInProgress || next == ConstructionPaused || next == ConstructionCancelled
	case ConstructionInProgress:
		return next == ConstructionPaused || next == ConstructionCompleted || next == ConstructionCancelled
	case ConstructionPaused:
		return next == ConstructionInProgress || next == ConstructionCancelled
	default:
		return false
	}
}

// Enqueue inserts a task into the queue and reserves its tile.
func (q *ConstructionQueue) Enqueue(ws *WorldState, task *ConstructionTask) error {
	if q == nil {
		return fmt.Errorf("施工队列不存在")
	}
	q.EnsureInit()
	if task == nil {
		return fmt.Errorf("施工任务不存在")
	}
	if task.ID == "" {
		return fmt.Errorf("施工任务缺少 id")
	}
	if task.PlayerID == "" {
		return fmt.Errorf("施工任务缺少 player_id")
	}
	if task.BuildingType == "" {
		return fmt.Errorf("施工任务缺少 building_type")
	}
	if _, exists := q.Tasks[task.ID]; exists {
		return fmt.Errorf("施工任务 %s 已存在", task.ID)
	}
	if task.State == "" {
		task.State = ConstructionPending
	}
	if task.State != ConstructionPending {
		return fmt.Errorf("施工任务 %s 必须以 pending 状态开始", task.ID)
	}
	if task.BuildingType == BuildingTypeLogisticsDistributor {
		if _, err := DistributorPlacementHost(ws, task.PlayerID, task.Position, ""); err != nil {
			return err
		}
		task.Position.Z = 1
	}
	tiles, err := ws.ConstructionTiles(task)
	if err != nil {
		return err
	}
	// 跨层施工预留互查（契约 §3.2）：高架带下方只能是空地或低矮物流（含施工中）；
	// 地面非低矮物流建筑的占地内不能有高架施工任务。放在 Enqueue 里，build 命令
	// 与其它入队入口都走同一套检查。
	if task.Elevation > 0 {
		if err := q.GroundReservationConflict(ws, task); err != nil {
			return err
		}
	} else if err := q.ElevatedReservationConflict(ws, task); err != nil {
		return err
	}
	if task.Elevation > 0 {
		if !SupportsElevation(task.BuildingType) {
			return fmt.Errorf("只有传送带可以架高")
		}
		if task.Elevation > MaxBeltElevation {
			return fmt.Errorf("高度只能 0–%d 层", MaxBeltElevation)
		}
		for _, p := range tiles {
			if !ws.InBounds(p.X, p.Y) || !ws.Grid[p.Y][p.X].Terrain.Buildable() {
				return fmt.Errorf("占地地块 %s 不可用", TileKey(p.X, p.Y))
			}
			key := task.ReservationKey(p)
			if existing := q.ReservedTiles[key]; existing != "" && existing != task.ID {
				return fmt.Errorf("地块 %s 已被 %s 预留", key, existing)
			}
			if id := ws.BeltLayerAt(p.X, p.Y, task.Elevation); id != "" {
				return fmt.Errorf("第 %d 层该格已有传送带", task.Elevation)
			}
		}
		for _, p := range tiles {
			q.ReservedTiles[task.ReservationKey(p)] = task.ID
		}
		q.NextSeq++
		task.QueueIndex = q.NextSeq
		q.Tasks[task.ID] = task
		q.Order = append(q.Order, task.ID)
		return nil
	}
	// Stacked layers (Z>0) sit on the ground building's tile by design; their
	// placement was validated when the command resolved the stack position.
	stacked := task.Position.Z > 0 && task.BuildingType != BuildingTypeLogisticsDistributor
	for _, p := range tiles {
		key := TileKey(p.X, p.Y)
		if existing := q.ReservedTiles[key]; existing != "" {
			return fmt.Errorf("地块 %s 已被 %s 预留", key, existing)
		}
		if !stacked && task.BuildingType != BuildingTypeLogisticsDistributor && (ws.TileBuilding[key] != "" || (!ws.Grid[p.Y][p.X].Terrain.Buildable() && task.BuildingType != BuildingTypeFoundation && !(RequiresLavaProximity(task.BuildingType) && ws.Grid[p.Y][p.X].Terrain == terrain.TileLava))) {
			return fmt.Errorf("占地地块 %s 不可用", key)
		}
		if task.BuildingType == BuildingTypeFoundation && ws.FoundationAt(p) != nil {
			return fmt.Errorf("占地地块 %s 已有地基", key)
		}
		if foundation := ws.FoundationAt(p); foundation != nil && foundation.Job != nil && foundation.Job.Type == BuildingJobDemolish {
			return fmt.Errorf("占地地块 %s 的地基正在拆除", key)
		}
	}
	for _, p := range tiles {
		q.ReservedTiles[TileKey(p.X, p.Y)] = task.ID
	}

	q.NextSeq++
	task.QueueIndex = q.NextSeq
	q.Tasks[task.ID] = task
	q.Order = append(q.Order, task.ID)
	return nil
}

// Remove deletes a task and releases its reservation.
// Cancelled tasks are kept in Tasks map (for restore) but removed from Order.
func (q *ConstructionQueue) Remove(taskID string) {
	if q == nil || taskID == "" {
		return
	}
	task := q.Tasks[taskID]
	if task != nil {
		for key, id := range q.ReservedTiles {
			if id == taskID {
				delete(q.ReservedTiles, key)
			}
		}
		// Keep cancelled tasks in Tasks map for potential restore
		if task.State == ConstructionCancelled {
			// Only remove from Order, keep in Tasks
		} else {
			delete(q.Tasks, taskID)
		}
	}
	for i, id := range q.Order {
		if id == taskID {
			q.Order = append(q.Order[:i], q.Order[i+1:]...)
			break
		}
	}
}

// IsTileReserved reports whether a tile is reserved for construction.
func (q *ConstructionQueue) IsTileReserved(tileKey string) bool {
	if q == nil || tileKey == "" {
		return false
	}
	return q.ReservedTiles != nil && q.ReservedTiles[tileKey] != ""
}

// Transition updates task state if the transition is allowed.
func (q *ConstructionQueue) Transition(taskID string, next ConstructionState) error {
	if q == nil {
		return fmt.Errorf("施工队列不存在")
	}
	task := q.Tasks[taskID]
	if task == nil {
		return fmt.Errorf("未找到施工任务 %s", taskID)
	}
	if !task.State.CanTransition(next) {
		return fmt.Errorf("无效的施工状态转换 %s -> %s", task.State, next)
	}
	task.State = next
	return nil
}

// RebuildReservations rebuilds tile reservations from queued tasks.
func (q *ConstructionQueue) RebuildReservations(ws *WorldState) error {
	if q == nil {
		return nil
	}
	q.ReservedTiles = make(map[string]string)
	for id, task := range q.Tasks {
		if task == nil || task.State == ConstructionCompleted || task.State == ConstructionCancelled {
			continue
		}
		tiles, err := ws.ConstructionTiles(task)
		if err != nil {
			return err
		}
		for _, p := range tiles {
			key := task.ReservationKey(p)
			if other := q.ReservedTiles[key]; other != "" && other != id {
				return fmt.Errorf("overlapping construction footprint")
			}
			q.ReservedTiles[key] = id
		}
	}
	return nil
}

// MaterialSourceType indicates the type of material source.
type MaterialSourceType int

const (
	MaterialSourceLocal     MaterialSourceType = iota // player local inventory
	MaterialSourceLogistics                           // logistics station
)

// MaterialSource represents a source of materials for construction.
type MaterialSource struct {
	Type       MaterialSourceType // source type
	BuildingID string             // building ID for logistics stations, empty for local
	Priority   int                // lower = higher priority
}

// MaterialReservation tracks reserved materials for a construction task.
type MaterialReservation struct {
	TaskID     string         `json:"task_id"`
	PlayerID   string         `json:"player_id"`
	Items      []ItemAmount   `json:"items,omitempty"`
	Source     MaterialSource `json:"source"`
	ReservedAt int64          `json:"reserved_at"`
}

// ConstructionMaterialReservation tracks all material reservations for construction tasks.
type ConstructionMaterialReservation struct {
	NextSeq      int64                           `json:"next_seq"`
	Reservations map[string]*MaterialReservation // taskID -> reservation
}

// NewConstructionMaterialReservation returns an initialized material reservation tracker.
func NewConstructionMaterialReservation() *ConstructionMaterialReservation {
	return &ConstructionMaterialReservation{
		Reservations: make(map[string]*MaterialReservation),
	}
}

// EnsureInit initializes maps when nil.
func (r *ConstructionMaterialReservation) EnsureInit() {
	if r == nil {
		return
	}
	if r.Reservations == nil {
		r.Reservations = make(map[string]*MaterialReservation)
	}
}

// GetReservation returns the reservation for a task.
func (r *ConstructionMaterialReservation) GetReservation(taskID string) *MaterialReservation {
	if r == nil || taskID == "" {
		return nil
	}
	return r.Reservations[taskID]
}

// AddReservation adds a new material reservation.
func (r *ConstructionMaterialReservation) AddReservation(res *MaterialReservation) error {
	if r == nil {
		return fmt.Errorf("material reservation is nil")
	}
	r.EnsureInit()
	if res == nil {
		return fmt.Errorf("reservation is nil")
	}
	if res.TaskID == "" {
		return fmt.Errorf("reservation task_id required")
	}
	if r.Reservations[res.TaskID] != nil {
		return fmt.Errorf("reservation for task %s already exists", res.TaskID)
	}
	r.NextSeq++
	res.ReservedAt = r.NextSeq
	r.Reservations[res.TaskID] = res
	return nil
}

// RemoveReservation removes a material reservation.
func (r *ConstructionMaterialReservation) RemoveReservation(taskID string) {
	if r == nil || taskID == "" {
		return
	}
	delete(r.Reservations, taskID)
}

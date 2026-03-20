package model

import "fmt"

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
	ID                string            `json:"id"`
	PlayerID          string            `json:"player_id"`
	RegionID          string            `json:"region_id,omitempty"`
	BuildingType      BuildingType      `json:"building_type"`
	Position          Position          `json:"position"`
	Rotation          PlanRotation      `json:"rotation,omitempty"`
	BlueprintParams   BlueprintParams   `json:"blueprint_params,omitempty"`
	ConveyorDirection ConveyorDirection `json:"conveyor_direction,omitempty"`
	Cost              BuildCost         `json:"cost,omitempty"`
	State             ConstructionState `json:"state"`
	EnqueueTick       int64             `json:"enqueue_tick"`
	StartTick         int64             `json:"start_tick,omitempty"`
	UpdateTick        int64             `json:"update_tick,omitempty"`
	QueueIndex        int64             `json:"queue_index,omitempty"`
	RemainingTicks    int               `json:"remaining_ticks,omitempty"`
	TotalTicks        int               `json:"total_ticks,omitempty"`
	Priority          int               `json:"priority,omitempty"`
	Error             string            `json:"error,omitempty"`
}

// ConstructionQueue stores pending and active construction tasks.
type ConstructionQueue struct {
	NextSeq       int64                        `json:"next_seq"`
	Tasks         map[string]*ConstructionTask `json:"tasks"`
	Order         []string                     `json:"order"`
	ReservedTiles map[string]string            `json:"reserved_tiles,omitempty"`
}

// NewConstructionQueue returns an initialized queue.
func NewConstructionQueue() *ConstructionQueue {
	return &ConstructionQueue{
		Tasks:         make(map[string]*ConstructionTask),
		Order:         make([]string, 0),
		ReservedTiles: make(map[string]string),
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
func (q *ConstructionQueue) Enqueue(task *ConstructionTask) error {
	if q == nil {
		return fmt.Errorf("construction queue is nil")
	}
	q.EnsureInit()
	if task == nil {
		return fmt.Errorf("construction task is nil")
	}
	if task.ID == "" {
		return fmt.Errorf("construction task id required")
	}
	if task.PlayerID == "" {
		return fmt.Errorf("construction task player_id required")
	}
	if task.BuildingType == "" {
		return fmt.Errorf("construction task building_type required")
	}
	if _, exists := q.Tasks[task.ID]; exists {
		return fmt.Errorf("construction task %s already exists", task.ID)
	}
	if task.State == "" {
		task.State = ConstructionPending
	}
	if task.State != ConstructionPending {
		return fmt.Errorf("construction task %s must start in pending state", task.ID)
	}
	tileKey := TileKey(task.Position.X, task.Position.Y)
	if existing := q.ReservedTiles[tileKey]; existing != "" {
		return fmt.Errorf("tile %s already reserved by %s", tileKey, existing)
	}
	q.ReservedTiles[tileKey] = task.ID
	q.NextSeq++
	task.QueueIndex = q.NextSeq
	q.Tasks[task.ID] = task
	q.Order = append(q.Order, task.ID)
	return nil
}

// Remove deletes a task and releases its reservation.
func (q *ConstructionQueue) Remove(taskID string) {
	if q == nil || taskID == "" {
		return
	}
	task := q.Tasks[taskID]
	if task != nil {
		tileKey := TileKey(task.Position.X, task.Position.Y)
		if q.ReservedTiles != nil && q.ReservedTiles[tileKey] == taskID {
			delete(q.ReservedTiles, tileKey)
		}
	}
	delete(q.Tasks, taskID)
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
		return fmt.Errorf("construction queue is nil")
	}
	task := q.Tasks[taskID]
	if task == nil {
		return fmt.Errorf("construction task %s not found", taskID)
	}
	if !task.State.CanTransition(next) {
		return fmt.Errorf("invalid construction state transition %s -> %s", task.State, next)
	}
	task.State = next
	return nil
}

// RebuildReservations rebuilds tile reservations from queued tasks.
func (q *ConstructionQueue) RebuildReservations() {
	if q == nil {
		return
	}
	q.ReservedTiles = make(map[string]string)
	for id, task := range q.Tasks {
		if task == nil {
			continue
		}
		if task.State == ConstructionCompleted || task.State == ConstructionCancelled {
			continue
		}
		key := TileKey(task.Position.X, task.Position.Y)
		q.ReservedTiles[key] = id
	}
}

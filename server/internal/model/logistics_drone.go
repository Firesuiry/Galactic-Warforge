package model

import "fmt"

// LogisticsDroneStatus describes the current flight phase.
type LogisticsDroneStatus string

const (
	LogisticsDroneIdle          LogisticsDroneStatus = "idle"
	LogisticsDroneTakeoff       LogisticsDroneStatus = "takeoff"
	LogisticsDroneInFlight      LogisticsDroneStatus = "in_flight"
	LogisticsDroneLanding       LogisticsDroneStatus = "landing"
	LogisticsDroneWaitingUnload LogisticsDroneStatus = "waiting_unload"
	LogisticsDroneStranded      LogisticsDroneStatus = "stranded"
)

const (
	DefaultLogisticsStationDroneCapacity = 10
	DefaultLogisticsDroneCapacity        = 100
	DefaultLogisticsDroneSpeed           = 4
	DefaultLogisticsDroneTakeoffTicks    = 1
	DefaultLogisticsDroneLandingTicks    = 1
)

var validLogisticsDroneStatuses = map[LogisticsDroneStatus]struct{}{
	LogisticsDroneIdle:          {},
	LogisticsDroneTakeoff:       {},
	LogisticsDroneInFlight:      {},
	LogisticsDroneLanding:       {},
	LogisticsDroneWaitingUnload: {},
	LogisticsDroneStranded:      {},
}

// LogisticsDroneState tracks a planetary logistics drone.
type LogisticsDroneState struct {
	ID              string               `json:"id"`
	StationID       string               `json:"station_id"`
	OwnerID         string               `json:"owner_id"`
	TripKind        string               `json:"trip_kind"`
	PickupItemID    string               `json:"pickup_item_id,omitempty"`
	PickupQuantity  int                  `json:"pickup_quantity,omitempty"`
	HomePos         *Position            `json:"home_pos,omitempty"`
	Returning       bool                 `json:"returning"`
	StateReason     string               `json:"state_reason,omitempty"`
	EnergyCost      int                  `json:"energy_cost"`
	TargetStationID string               `json:"target_station_id,omitempty"`
	Capacity        int                  `json:"capacity"`
	Speed           int                  `json:"speed"`
	Status          LogisticsDroneStatus `json:"status"`
	Position        Position             `json:"position"`
	TargetPos       *Position            `json:"target_pos,omitempty"`
	RemainingTicks  int                  `json:"remaining_ticks"`
	TravelTicks     int                  `json:"travel_ticks"`
	Cargo           ItemInventory        `json:"cargo,omitempty"`
}

// NewLogisticsDroneState builds a drone with default stats.
func NewLogisticsDroneState(id, stationID string, pos Position) *LogisticsDroneState {
	drone := &LogisticsDroneState{
		ID:        id,
		StationID: stationID,
		Capacity:  DefaultLogisticsDroneCapacity,
		Speed:     DefaultLogisticsDroneSpeed,
		Status:    LogisticsDroneIdle,
		Position:  pos,
		HomePos:   &Position{X: pos.X, Y: pos.Y, Z: pos.Z},
	}
	drone.Normalize()
	return drone
}

// Clone returns a deep copy of the drone state.
func (d *LogisticsDroneState) Clone() *LogisticsDroneState {
	if d == nil {
		return nil
	}
	out := *d
	if d.HomePos != nil {
		pos := *d.HomePos
		out.HomePos = &pos
	}
	if d.TargetPos != nil {
		pos := *d.TargetPos
		out.TargetPos = &pos
	}
	out.Cargo = d.Cargo.Clone()
	return &out
}

// Normalize clamps invalid values and fills defaults.
func (d *LogisticsDroneState) Normalize() {
	if d == nil {
		return
	}
	if d.Capacity <= 0 {
		d.Capacity = DefaultLogisticsDroneCapacity
	}
	if d.Speed <= 0 {
		d.Speed = DefaultLogisticsDroneSpeed
	}
	if d.RemainingTicks < 0 {
		d.RemainingTicks = 0
	}
	if d.TravelTicks < 0 {
		d.TravelTicks = 0
	}
	if _, ok := validLogisticsDroneStatuses[d.Status]; !ok {
		d.Status = LogisticsDroneStranded
		d.StateReason = "invalid_flight_state"
	}
}

// CargoQty returns the total cargo quantity.
func (d *LogisticsDroneState) CargoQty() int {
	if d == nil {
		return 0
	}
	return inventoryQty(d.Cargo)
}

// AvailableCapacity returns remaining cargo capacity.
func (d *LogisticsDroneState) AvailableCapacity() int {
	if d == nil {
		return 0
	}
	available := d.Capacity - d.CargoQty()
	if available < 0 {
		return 0
	}
	return available
}

// Load adds items into the drone cargo.
func (d *LogisticsDroneState) Load(itemID string, qty int) (int, int, error) {
	if d == nil {
		return 0, qty, fmt.Errorf("drone required")
	}
	if err := validateItemQuantity(itemID, qty); err != nil {
		return 0, qty, err
	}
	available := d.AvailableCapacity()
	if available <= 0 {
		return 0, qty, nil
	}
	take := minInt(available, qty)
	if d.Cargo == nil {
		d.Cargo = make(ItemInventory)
	}
	addToInventory(d.Cargo, itemID, take)
	return take, qty - take, nil
}

// Unload removes items from the drone cargo.
func (d *LogisticsDroneState) Unload(itemID string, qty int) (int, int, error) {
	if d == nil {
		return 0, qty, fmt.Errorf("drone required")
	}
	if err := validateItemQuantity(itemID, qty); err != nil {
		return 0, qty, err
	}
	take := removeFromInventory(d.Cargo, itemID, qty)
	return take, qty - take, nil
}

// BeginTrip starts a takeoff towards the target.
func (d *LogisticsDroneState) BeginTrip(targetStationID string, targetPos Position, distance int) error {
	if d == nil {
		return fmt.Errorf("drone required")
	}
	if d.Status != LogisticsDroneIdle {
		return fmt.Errorf("drone not idle")
	}
	d.Normalize()
	d.TripKind = "delivery"
	d.PickupItemID = ""
	d.PickupQuantity = 0
	d.Returning = false
	d.StateReason = ""
	d.EnergyCost = 2 * max(1, distance)
	d.TargetStationID = targetStationID
	d.TargetPos = &Position{X: targetPos.X, Y: targetPos.Y, Z: targetPos.Z}
	d.Status = LogisticsDroneTakeoff
	d.RemainingTicks = DefaultLogisticsDroneTakeoffTicks
	d.TravelTicks = LogisticsDroneTravelTicks(distance, d.Speed)
	return nil
}

// LogisticsDroneTravelTicks returns the travel ticks for a distance and speed.
func LogisticsDroneTravelTicks(distance, speed int) int {
	if speed <= 0 {
		speed = DefaultLogisticsDroneSpeed
	}
	if distance <= 0 {
		return 1
	}
	ticks := distance / speed
	if distance%speed != 0 {
		ticks++
	}
	if ticks < 1 {
		ticks = 1
	}
	return ticks
}

// SyncLogisticsDroneStats refreshes derived drone stats from the owner's
// completed research. drone_engine adds its drone_speed effect to the base
// speed; dispatch settlement consumes the Speed field via BeginTrip and
// LogisticsDroneTravelTicks, so faster research shortens real flight time.
// The sync is idempotent and safe to run every tick and after snapshot restore.
func SyncLogisticsDroneStats(ws *WorldState) {
	if ws == nil {
		return
	}
	for _, drone := range ws.LogisticsDrones {
		if drone == nil {
			continue
		}
		drone.Speed = DefaultLogisticsDroneSpeed + int(TechEffectValue(ws.Players[drone.OwnerID], "drone_speed"))
	}
}

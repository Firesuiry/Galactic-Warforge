package model

import "fmt"

// LogisticsDroneStatus describes the current flight phase.
type LogisticsDroneStatus string

const (
	LogisticsDroneIdle     LogisticsDroneStatus = "idle"
	LogisticsDroneTakeoff  LogisticsDroneStatus = "takeoff"
	LogisticsDroneInFlight LogisticsDroneStatus = "in_flight"
	LogisticsDroneLanding  LogisticsDroneStatus = "landing"
)

const (
	DefaultLogisticsStationDroneCapacity = 10
	DefaultLogisticsDroneCapacity        = 100
	DefaultLogisticsDroneSpeed           = 4
	DefaultLogisticsDroneTakeoffTicks    = 1
	DefaultLogisticsDroneLandingTicks    = 1
)

var validLogisticsDroneStatuses = map[LogisticsDroneStatus]struct{}{
	LogisticsDroneIdle:     {},
	LogisticsDroneTakeoff:  {},
	LogisticsDroneInFlight: {},
	LogisticsDroneLanding:  {},
}

// LogisticsDroneState tracks a planetary logistics drone.
type LogisticsDroneState struct {
	ID              string               `json:"id"`
	StationID       string               `json:"station_id"`
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
		d.Status = LogisticsDroneIdle
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
func (d *LogisticsDroneState) BeginTrip(targetStationID string, targetPos Position) error {
	if d == nil {
		return fmt.Errorf("drone required")
	}
	if d.Status != LogisticsDroneIdle {
		return fmt.Errorf("drone not idle")
	}
	d.Normalize()
	d.TargetStationID = targetStationID
	d.TargetPos = &Position{X: targetPos.X, Y: targetPos.Y, Z: targetPos.Z}
	d.Status = LogisticsDroneTakeoff
	d.RemainingTicks = DefaultLogisticsDroneTakeoffTicks
	d.TravelTicks = LogisticsDroneTravelTicks(ManhattanDist(d.Position, targetPos), d.Speed)
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

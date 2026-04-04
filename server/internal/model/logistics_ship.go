package model

import "fmt"

// LogisticsShipStatus describes the current flight phase for interstellar ships.
type LogisticsShipStatus string

const (
	LogisticsShipIdle     LogisticsShipStatus = "idle"
	LogisticsShipTakeoff  LogisticsShipStatus = "takeoff"
	LogisticsShipInFlight LogisticsShipStatus = "in_flight"
	LogisticsShipLanding  LogisticsShipStatus = "landing"
)

const (
	DefaultLogisticsStationShipSlots         = 5
	DefaultLogisticsShipCapacity             = 200
	DefaultLogisticsShipSpeed                = 2
	DefaultLogisticsShipWarpSpeed            = 10
	DefaultLogisticsShipTakeoffTicks         = 2
	DefaultLogisticsShipLandingTicks         = 2
	DefaultLogisticsShipEnergyPerDistance    = 5
	DefaultLogisticsShipWarpDistance         = 20
	DefaultLogisticsShipWarpEnergyMultiplier = 3
	DefaultLogisticsShipWarpItemCost         = 1
)

const DefaultLogisticsShipWarpItemID = ItemSpaceWarper

var validLogisticsShipStatuses = map[LogisticsShipStatus]struct{}{
	LogisticsShipIdle:     {},
	LogisticsShipTakeoff:  {},
	LogisticsShipInFlight: {},
	LogisticsShipLanding:  {},
}

// LogisticsShipState tracks an interstellar logistics ship.
type LogisticsShipState struct {
	ID                   string              `json:"id"`
	StationID            string              `json:"station_id"`
	OriginPlanetID       string              `json:"origin_planet_id,omitempty"`
	TargetPlanetID       string              `json:"target_planet_id,omitempty"`
	TargetStationID      string              `json:"target_station_id,omitempty"`
	Capacity             int                 `json:"capacity"`
	Speed                int                 `json:"speed"`
	WarpSpeed            int                 `json:"warp_speed"`
	WarpDistance         int                 `json:"warp_distance"`
	EnergyPerDistance    int                 `json:"energy_per_distance"`
	WarpEnergyMultiplier int                 `json:"warp_energy_multiplier"`
	WarpItemID           string              `json:"warp_item_id,omitempty"`
	WarpItemCost         int                 `json:"warp_item_cost"`
	WarpEnabled          bool                `json:"warp_enabled"`
	Status               LogisticsShipStatus `json:"status"`
	Position             Position            `json:"position"`
	TargetPos            *Position           `json:"target_pos,omitempty"`
	RemainingTicks       int                 `json:"remaining_ticks"`
	TravelTicks          int                 `json:"travel_ticks"`
	Cargo                ItemInventory       `json:"cargo,omitempty"`
	Warped               bool                `json:"warped"`
	EnergyCost           int                 `json:"energy_cost"`
	WarpItemSpent        int                 `json:"warp_item_spent"`
}

// NewLogisticsShipState builds a ship with default stats.
func NewLogisticsShipState(id, stationID string, pos Position) *LogisticsShipState {
	ship := &LogisticsShipState{
		ID:        id,
		StationID: stationID,
		Capacity:  DefaultLogisticsShipCapacity,
		Speed:     DefaultLogisticsShipSpeed,
		WarpSpeed: DefaultLogisticsShipWarpSpeed,
		Status:    LogisticsShipIdle,
		Position:  pos,
	}
	ship.Normalize()
	return ship
}

// Clone returns a deep copy of the ship state.
func (s *LogisticsShipState) Clone() *LogisticsShipState {
	if s == nil {
		return nil
	}
	out := *s
	if s.TargetPos != nil {
		pos := *s.TargetPos
		out.TargetPos = &pos
	}
	out.Cargo = s.Cargo.Clone()
	return &out
}

// Normalize clamps invalid values and fills defaults.
func (s *LogisticsShipState) Normalize() {
	if s == nil {
		return
	}
	if s.Capacity <= 0 {
		s.Capacity = DefaultLogisticsShipCapacity
	}
	if s.Speed <= 0 {
		s.Speed = DefaultLogisticsShipSpeed
	}
	if s.WarpSpeed <= 0 {
		s.WarpSpeed = DefaultLogisticsShipWarpSpeed
	}
	if s.WarpDistance <= 0 {
		s.WarpDistance = DefaultLogisticsShipWarpDistance
	}
	if s.EnergyPerDistance <= 0 {
		s.EnergyPerDistance = DefaultLogisticsShipEnergyPerDistance
	}
	if s.WarpEnergyMultiplier <= 0 {
		s.WarpEnergyMultiplier = DefaultLogisticsShipWarpEnergyMultiplier
	}
	if s.WarpItemCost <= 0 {
		s.WarpItemCost = DefaultLogisticsShipWarpItemCost
	}
	if s.WarpItemID == "" {
		s.WarpItemID = DefaultLogisticsShipWarpItemID
	}
	if s.RemainingTicks < 0 {
		s.RemainingTicks = 0
	}
	if s.TravelTicks < 0 {
		s.TravelTicks = 0
	}
	if _, ok := validLogisticsShipStatuses[s.Status]; !ok {
		s.Status = LogisticsShipIdle
	}
	if s.EnergyCost < 0 {
		s.EnergyCost = 0
	}
	if s.WarpItemSpent < 0 {
		s.WarpItemSpent = 0
	}
}

// CargoQty returns the total cargo quantity.
func (s *LogisticsShipState) CargoQty() int {
	if s == nil {
		return 0
	}
	return inventoryQty(s.Cargo)
}

// AvailableCapacity returns remaining cargo capacity.
func (s *LogisticsShipState) AvailableCapacity() int {
	if s == nil {
		return 0
	}
	available := s.Capacity - s.CargoQty()
	if available < 0 {
		return 0
	}
	return available
}

// Load adds items into the ship cargo.
func (s *LogisticsShipState) Load(itemID string, qty int) (int, int, error) {
	if s == nil {
		return 0, qty, fmt.Errorf("ship required")
	}
	if err := validateItemQuantity(itemID, qty); err != nil {
		return 0, qty, err
	}
	available := s.AvailableCapacity()
	if available <= 0 {
		return 0, qty, nil
	}
	take := minInt(available, qty)
	if s.Cargo == nil {
		s.Cargo = make(ItemInventory)
	}
	addToInventory(s.Cargo, itemID, take)
	return take, qty - take, nil
}

// Unload removes items from the ship cargo.
func (s *LogisticsShipState) Unload(itemID string, qty int) (int, int, error) {
	if s == nil {
		return 0, qty, fmt.Errorf("ship required")
	}
	if err := validateItemQuantity(itemID, qty); err != nil {
		return 0, qty, err
	}
	take := removeFromInventory(s.Cargo, itemID, qty)
	return take, qty - take, nil
}

// BeginTrip starts a takeoff towards the target.
func (s *LogisticsShipState) BeginTrip(targetPlanetID, targetStationID string, targetPos Position, distance int, warped bool) error {
	if s == nil {
		return fmt.Errorf("ship required")
	}
	if s.Status != LogisticsShipIdle {
		return fmt.Errorf("ship not idle")
	}
	s.Normalize()
	s.TargetPlanetID = targetPlanetID
	s.TargetStationID = targetStationID
	s.TargetPos = &Position{X: targetPos.X, Y: targetPos.Y, Z: targetPos.Z}
	s.Status = LogisticsShipTakeoff
	s.RemainingTicks = DefaultLogisticsShipTakeoffTicks
	if distance < 0 {
		distance = 0
	}
	warpAllowed := warped && s.WarpEnabled
	speed := s.Speed
	if warpAllowed {
		speed = s.WarpSpeed
	}
	s.TravelTicks = LogisticsShipTravelTicks(distance, speed)
	s.Warped = warpAllowed
	s.EnergyCost = LogisticsShipEnergyCost(distance, s.EnergyPerDistance, s.WarpEnergyMultiplier, warpAllowed)
	if warpAllowed && s.WarpItemCost > 0 {
		s.WarpItemSpent = s.WarpItemCost
	} else {
		s.WarpItemSpent = 0
	}
	return nil
}

// LogisticsShipTravelTicks returns the travel ticks for a distance and speed.
func LogisticsShipTravelTicks(distance, speed int) int {
	if speed <= 0 {
		speed = DefaultLogisticsShipSpeed
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

// LogisticsShipEnergyCost returns the energy cost for a trip.
func LogisticsShipEnergyCost(distance, energyPerDistance, warpMultiplier int, warped bool) int {
	if distance < 0 {
		distance = 0
	}
	if energyPerDistance <= 0 {
		energyPerDistance = DefaultLogisticsShipEnergyPerDistance
	}
	cost := distance * energyPerDistance
	if warped {
		if warpMultiplier <= 0 {
			warpMultiplier = DefaultLogisticsShipWarpEnergyMultiplier
		}
		cost *= warpMultiplier
	}
	if cost < 0 {
		return 0
	}
	return cost
}

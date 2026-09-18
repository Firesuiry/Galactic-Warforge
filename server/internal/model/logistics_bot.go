package model

import "fmt"

const (
	DefaultLogisticsBotCapacity = 10
	DefaultLogisticsBotSpeed    = 2

	// MaxLogisticsBotFlightEnergy is the largest prepaid flight budget a bot
	// may carry: a round trip at the maximum delivery range. The range derives
	// from the distributor base range (12) plus 5 per distribution_range tech
	// level (MaxLevel 5 => 37 tiles), billed at 2 energy per tile of one-way
	// distance, so the ceiling is 2*(12+5*5) = 74.
	MaxLogisticsBotFlightEnergy = 2 * (12 + 5*5)
)

// LogisticsBotState owns its cargo and a finite prepaid flight budget.
type LogisticsBotState struct {
	ID              string               `json:"id"`
	OwnerID         string               `json:"owner_id"`
	DistributorID   string               `json:"distributor_id"`
	HomePos         *Position            `json:"home_pos,omitempty"`
	Position        Position             `json:"position"`
	TargetPos       *Position            `json:"target_pos,omitempty"`
	TargetKind      string               `json:"target_kind,omitempty"`
	TargetID        string               `json:"target_id,omitempty"`
	TripKind        string               `json:"trip_kind,omitempty"`
	PickupItemID    string               `json:"pickup_item_id,omitempty"`
	PickupQuantity  int                  `json:"pickup_quantity,omitempty"`
	Cargo           ItemInventory        `json:"cargo,omitempty"`
	Capacity        int                  `json:"capacity"`
	Speed           int                  `json:"speed"`
	Status          LogisticsDroneStatus `json:"status"`
	Returning       bool                 `json:"returning"`
	RemainingTicks  int                  `json:"remaining_ticks"`
	TravelTicks     int                  `json:"travel_ticks"`
	EnergyCost      int                  `json:"energy_cost"`
	EnergyRemaining int                  `json:"energy_remaining"`
	StateReason     string               `json:"state_reason,omitempty"`
}

func NewLogisticsBotState(id, distributorID string, pos Position) *LogisticsBotState {
	home := pos
	return &LogisticsBotState{ID: id, DistributorID: distributorID, HomePos: &home, Position: pos, Capacity: DefaultLogisticsBotCapacity, Speed: DefaultLogisticsBotSpeed, Status: LogisticsDroneIdle}
}
func (b *LogisticsBotState) Clone() *LogisticsBotState {
	if b == nil {
		return nil
	}
	out := *b
	out.Cargo = b.Cargo.Clone()
	if b.HomePos != nil {
		pos := *b.HomePos
		out.HomePos = &pos
	}
	if b.TargetPos != nil {
		pos := *b.TargetPos
		out.TargetPos = &pos
	}
	return &out
}
func (b *LogisticsBotState) CargoQty() int {
	if b == nil {
		return 0
	}
	return inventoryQty(b.Cargo)
}
func (b *LogisticsBotState) Load(itemID string, quantity int) (int, int, error) {
	if b == nil {
		return 0, quantity, fmt.Errorf("bot required")
	}
	if err := validateItemQuantity(itemID, quantity); err != nil {
		return 0, quantity, err
	}
	accepted := min(quantity, max(0, b.Capacity-b.CargoQty()))
	if accepted > 0 {
		if b.Cargo == nil {
			b.Cargo = make(ItemInventory)
		}
		b.Cargo[itemID] += accepted
	}
	return accepted, quantity - accepted, nil
}
func (b *LogisticsBotState) Unload(itemID string, quantity int) (int, int, error) {
	if b == nil {
		return 0, quantity, fmt.Errorf("bot required")
	}
	if err := validateItemQuantity(itemID, quantity); err != nil {
		return 0, quantity, err
	}
	taken := removeFromInventory(b.Cargo, itemID, quantity)
	return taken, quantity - taken, nil
}
func (b *LogisticsBotState) Validate() error {
	if b == nil || b.ID == "" || b.DistributorID == "" || b.OwnerID == "" {
		return fmt.Errorf("bot identity required")
	}
	if _, ok := validLogisticsDroneStatuses[b.Status]; !ok {
		return fmt.Errorf("invalid bot status")
	}
	if b.Capacity != DefaultLogisticsBotCapacity || b.Speed != DefaultLogisticsBotSpeed || b.CargoQty() > b.Capacity || b.EnergyRemaining < 0 || b.EnergyRemaining > b.EnergyCost || b.RemainingTicks < 0 || b.TravelTicks < 0 {
		return fmt.Errorf("invalid bot capacity or flight budget")
	}
	if b.HomePos == nil || b.EnergyCost < 0 || b.EnergyCost > MaxLogisticsBotFlightEnergy || b.PickupQuantity < 0 || b.PickupQuantity > b.Capacity {
		return fmt.Errorf("invalid bot home or budget")
	}
	if b.Status == LogisticsDroneIdle {
		if b.CargoQty() != 0 || b.EnergyCost != 0 || b.EnergyRemaining != 0 || b.Returning || b.TargetPos != nil || b.TargetID != "" || b.TripKind != "" {
			return fmt.Errorf("idle bot contains an active flight")
		}
	} else if b.Status != LogisticsDroneStranded {
		if b.TargetPos == nil || b.TargetID == "" || (b.TargetKind != "distributor" && b.TargetKind != "mecha") || (b.TripKind != "delivery" && b.TripKind != "pickup") || b.PickupQuantity <= 0 {
			return fmt.Errorf("active bot flight required")
		}
		if item, ok := Item(b.PickupItemID); !ok || item.Form != ResourceSolid {
			return fmt.Errorf("bot pickup item must be solid")
		}
	}
	for itemID, qty := range b.Cargo {
		if err := validateItemQuantity(itemID, qty); err != nil {
			return err
		}
		if item, ok := Item(itemID); !ok || item.Form != ResourceSolid {
			return fmt.Errorf("bot cargo must be a known solid item")
		}
	}
	return nil
}
func RegisterLogisticsBot(ws *WorldState, b *LogisticsBotState) error {
	if ws == nil || b == nil {
		return fmt.Errorf("world and bot required")
	}
	distributor := ws.Buildings[b.DistributorID]
	if distributor == nil || distributor.Distributor == nil || DistributorHost(ws, distributor) == nil {
		return fmt.Errorf("valid distributor host required")
	}
	if DistributorBotCount(ws, b.DistributorID) >= distributor.Distributor.BotCapacity {
		return fmt.Errorf("distributor robot slots full")
	}
	if _, exists := ws.LogisticsBots[b.ID]; exists {
		return fmt.Errorf("bot id already registered")
	}
	b.OwnerID = distributor.OwnerID
	home := distributor.Position
	b.HomePos = &home
	b.Position = home
	if err := b.Validate(); err != nil {
		return err
	}
	if ws.LogisticsBots == nil {
		ws.LogisticsBots = make(map[string]*LogisticsBotState)
	}
	ws.LogisticsBots[b.ID] = b
	return nil
}
func DistributorBotCount(ws *WorldState, distributorID string) int {
	count := 0
	if ws == nil {
		return 0
	}
	for _, b := range ws.LogisticsBots {
		if b != nil && b.DistributorID == distributorID {
			count++
		}
	}
	return count
}
func UnregisterLogisticsBot(ws *WorldState, id string) {
	if ws != nil {
		delete(ws.LogisticsBots, id)
	}
}

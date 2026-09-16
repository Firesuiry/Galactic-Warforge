package model

import "fmt"

// DistributorState belongs to a warehouse-top attachment. Cargo remains in the host storage.
type DistributorState struct {
	HostBuildingID          string               `json:"host_building_id"`
	ItemID                  string               `json:"item_id"`
	Mode                    LogisticsStationMode `json:"mode"`
	LocalStorage            int                  `json:"local_storage"`
	PlayerDeliveryEnabled   bool                 `json:"player_delivery_enabled"`
	PlayerCollectionEnabled bool                 `json:"player_collection_enabled"`
	Energy                  int                  `json:"energy"`
	EnergyCapacity          int                  `json:"energy_capacity"`
	ChargePerTick           int                  `json:"charge_per_tick"`
	LastChargeTick          int64                `json:"last_charge_tick"`
	LastChargeAmount        int                  `json:"last_charge_amount"`
	Range                   int                  `json:"range"`
	BotCapacity             int                  `json:"bot_capacity"`
}

func NewDistributorState(hostID string) *DistributorState {
	return &DistributorState{HostBuildingID: hostID, Mode: LogisticsStationModeNone, EnergyCapacity: 1000, ChargePerTick: 10, LastChargeTick: -1, Range: 12, BotCapacity: 10}
}
func (s *DistributorState) Clone() *DistributorState {
	if s == nil {
		return nil
	}
	out := *s
	return &out
}
func (s *DistributorState) ChargingDemand() int {
	if s == nil {
		return 0
	}
	return max(0, min(s.ChargePerTick, s.EnergyCapacity-s.Energy))
}
func (s *DistributorState) SpendEnergy(n int) bool {
	if s == nil || n < 0 || s.Energy < n {
		return false
	}
	s.Energy -= n
	return true
}
func (s *DistributorState) Validate() error {
	if s == nil || s.HostBuildingID == "" {
		return fmt.Errorf("distributor host required")
	}
	if (s.Mode != LogisticsStationModeNone && s.Mode != LogisticsStationModeSupply && s.Mode != LogisticsStationModeDemand) || s.LocalStorage < 0 {
		return fmt.Errorf("invalid distributor mode or local_storage")
	}
	if s.ItemID == "" {
		if s.Mode != LogisticsStationModeNone || s.LocalStorage != 0 || s.PlayerDeliveryEnabled || s.PlayerCollectionEnabled {
			return fmt.Errorf("unconfigured distributor must be inactive")
		}
	} else if item, ok := Item(s.ItemID); !ok || item.Form != ResourceSolid {
		return fmt.Errorf("distributor item must be a known solid item")
	}
	if s.EnergyCapacity != 1000 || s.ChargePerTick != 10 || s.Range != 12 || s.BotCapacity != 10 || s.Energy < 0 || s.Energy > s.EnergyCapacity || s.LastChargeTick < -1 || s.LastChargeAmount < 0 || s.LastChargeAmount > s.ChargePerTick {
		return fmt.Errorf("invalid distributor capacity or energy")
	}
	return nil
}
func IsDistributorHost(kind BuildingType) bool {
	return kind == BuildingTypeDepotMk1 || kind == BuildingTypeDepotMk2
}
func DistributorHost(ws *WorldState, b *Building) *Building {
	if ws == nil || b == nil || b.Type != BuildingTypeLogisticsDistributor || b.Distributor == nil {
		return nil
	}
	host := ws.Buildings[b.Distributor.HostBuildingID]
	if host == nil || !IsDistributorHost(host.Type) || host.OwnerID != b.OwnerID || host.Storage == nil || host.Position.X != b.Position.X || host.Position.Y != b.Position.Y || host.Position.Z != 0 || (host.Job != nil && host.Job.Type == BuildingJobDemolish) {
		return nil
	}
	return host
}
func DistributorOnHost(ws *WorldState, hostID string) *Building {
	if ws == nil {
		return nil
	}
	for _, b := range ws.Buildings {
		if b != nil && b.Type == BuildingTypeLogisticsDistributor && b.Distributor != nil && b.Distributor.HostBuildingID == hostID {
			return b
		}
	}
	return nil
}

// DistributorPlacementHost checks the physical mount at the warehouse's origin, not any occupied footprint cell.
func DistributorPlacementHost(ws *WorldState, owner string, pos Position, excludeID string) (*Building, error) {
	if ws == nil || !ws.InBounds(pos.X, pos.Y) {
		return nil, fmt.Errorf("distributor position out of bounds")
	}
	var host *Building
	for _, candidate := range ws.Buildings {
		if candidate != nil && IsDistributorHost(candidate.Type) && candidate.Position.X == pos.X && candidate.Position.Y == pos.Y && candidate.Position.Z == 0 {
			host = candidate
			break
		}
	}
	if host == nil || host.OwnerID != owner || host.Storage == nil || (host.Job != nil && host.Job.Type == BuildingJobDemolish) {
		return nil, fmt.Errorf("distributor requires an available owned depot_mk1 or depot_mk2")
	}
	for _, b := range ws.Buildings {
		if b != nil && b.ID != excludeID && b.Type == BuildingTypeLogisticsDistributor && b.Position.X == pos.X && b.Position.Y == pos.Y {
			return nil, fmt.Errorf("warehouse already has a distributor")
		}
	}
	return host, nil
}

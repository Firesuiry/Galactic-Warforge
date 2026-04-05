package model

const ProductionStatMinerals = "minerals"

// ProductionSettlementSnapshot is the authoritative per-tick production settlement result.
type ProductionSettlementSnapshot struct {
	Tick    int64                               `json:"tick"`
	Players map[string]PlayerProductionSnapshot `json:"players,omitempty"`
}

// PlayerProductionSnapshot captures the authoritative production outputs for a player in a tick.
type PlayerProductionSnapshot struct {
	TotalOutput    int            `json:"total_output"`
	ByBuildingType map[string]int `json:"by_building_type,omitempty"`
	ByItem         map[string]int `json:"by_item,omitempty"`
}

// NewProductionSettlementSnapshot returns an empty per-tick production snapshot.
func NewProductionSettlementSnapshot(tick int64) *ProductionSettlementSnapshot {
	return &ProductionSettlementSnapshot{
		Tick:    tick,
		Players: make(map[string]PlayerProductionSnapshot),
	}
}

// CurrentProductionSettlementSnapshot returns the authoritative production snapshot for the current tick.
func CurrentProductionSettlementSnapshot(ws *WorldState) *ProductionSettlementSnapshot {
	if ws == nil || ws.ProductionSnapshot == nil {
		return nil
	}
	if ws.ProductionSnapshot.Tick != ws.Tick {
		return nil
	}
	return ws.ProductionSnapshot
}

// RecordBuildingOutputs aggregates real outputs that were successfully stored this tick.
func (s *ProductionSettlementSnapshot) RecordBuildingOutputs(building *Building, outputs []ItemAmount) {
	if s == nil || building == nil || building.OwnerID == "" || len(outputs) == 0 {
		return
	}

	player := s.Players[building.OwnerID]
	if player.ByBuildingType == nil {
		player.ByBuildingType = make(map[string]int)
	}
	if player.ByItem == nil {
		player.ByItem = make(map[string]int)
	}

	total := 0
	for _, output := range outputs {
		if output.ItemID == "" || output.Quantity <= 0 {
			continue
		}
		total += output.Quantity
		player.ByItem[output.ItemID] += output.Quantity
	}
	if total <= 0 {
		return
	}

	player.TotalOutput += total
	player.ByBuildingType[string(building.Type)] += total
	s.Players[building.OwnerID] = player
}

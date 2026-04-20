package model

// WarOrderStatus tracks authoritative industry order lifecycle.
type WarOrderStatus string

const (
	WarOrderStatusQueued     WarOrderStatus = "queued"
	WarOrderStatusInProgress WarOrderStatus = "in_progress"
	WarOrderStatusBlocked    WarOrderStatus = "blocked"
	WarOrderStatusCompleted  WarOrderStatus = "completed"
)

// WarProductionStage tracks the current military manufacturing step.
type WarProductionStage string

const (
	WarProductionStageComponents WarProductionStage = "components"
	WarProductionStageAssembly   WarProductionStage = "assembly"
	WarProductionStageReady      WarProductionStage = "ready"
)

// WarRefitUnitKind identifies the runtime entity being refitted.
type WarRefitUnitKind string

const (
	WarRefitUnitKindSquad WarRefitUnitKind = "squad"
	WarRefitUnitKindFleet WarRefitUnitKind = "fleet"
)

// WarProductionOrder is one authoritative military production line order.
type WarProductionOrder struct {
	ID                  string             `json:"id"`
	FactoryBuildingID   string             `json:"factory_building_id"`
	DeploymentHubID     string             `json:"deployment_hub_id,omitempty"`
	BlueprintID         string             `json:"blueprint_id"`
	Domain              UnitDomain         `json:"domain"`
	Count               int                `json:"count"`
	CompletedCount      int                `json:"completed_count"`
	Status              WarOrderStatus     `json:"status"`
	Stage               WarProductionStage `json:"stage"`
	StageRemainingTicks int64              `json:"stage_remaining_ticks,omitempty"`
	StageTotalTicks     int64              `json:"stage_total_ticks,omitempty"`
	ComponentTicks      int64              `json:"component_ticks,omitempty"`
	AssemblyTicks       int64              `json:"assembly_ticks,omitempty"`
	RetoolTicks         int64              `json:"retool_ticks,omitempty"`
	RepeatBonusPercent  int                `json:"repeat_bonus_percent,omitempty"`
	QueueIndex          int64              `json:"queue_index,omitempty"`
	CreatedTick         int64              `json:"created_tick,omitempty"`
	UpdatedTick         int64              `json:"updated_tick,omitempty"`
}

// WarRefitOrder is one authoritative retrofit / upgrade order.
type WarRefitOrder struct {
	ID                string           `json:"id"`
	BuildingID        string           `json:"building_id"`
	UnitID            string           `json:"unit_id"`
	UnitKind          WarRefitUnitKind `json:"unit_kind"`
	SourcePlanetID    string           `json:"source_planet_id,omitempty"`
	SourceSystemID    string           `json:"source_system_id,omitempty"`
	SourceBuildingID  string           `json:"source_building_id,omitempty"`
	SourceBlueprintID string           `json:"source_blueprint_id"`
	TargetBlueprintID string           `json:"target_blueprint_id"`
	Count             int              `json:"count,omitempty"`
	FleetFormation    FormationType    `json:"fleet_formation,omitempty"`
	Status            WarOrderStatus   `json:"status"`
	RemainingTicks    int64            `json:"remaining_ticks,omitempty"`
	TotalTicks        int64            `json:"total_ticks,omitempty"`
	QueueIndex        int64            `json:"queue_index,omitempty"`
	CreatedTick       int64            `json:"created_tick,omitempty"`
	UpdatedTick       int64            `json:"updated_tick,omitempty"`
}

// WarProductionLineState tracks per-facility retool and repeat-production state.
type WarProductionLineState struct {
	BuildingID        string `json:"building_id"`
	LastBlueprintID   string `json:"last_blueprint_id,omitempty"`
	ConsecutiveRuns   int    `json:"consecutive_runs,omitempty"`
	ActiveOrderID     string `json:"active_order_id,omitempty"`
	LastCompletedTick int64  `json:"last_completed_tick,omitempty"`
}

// WarDeploymentHubState tracks ready-to-deploy warfare payloads for one hub.
type WarDeploymentHubState struct {
	BuildingID    string         `json:"building_id"`
	Capacity      int            `json:"capacity,omitempty"`
	ReadyPayloads map[string]int `json:"ready_payloads,omitempty"`
	UpdatedTick   int64          `json:"updated_tick,omitempty"`
}

// WarIndustryState stores military production, retrofit and hub inventory.
type WarIndustryState struct {
	NextOrderSeq     int64                              `json:"next_order_seq,omitempty"`
	ProductionOrders map[string]*WarProductionOrder     `json:"production_orders,omitempty"`
	RefitOrders      map[string]*WarRefitOrder          `json:"refit_orders,omitempty"`
	ProductionLines  map[string]*WarProductionLineState `json:"production_lines,omitempty"`
	DeploymentHubs   map[string]*WarDeploymentHubState  `json:"deployment_hubs,omitempty"`
}

// WarDeploymentHubView is the query-facing deployment hub stock payload.
type WarDeploymentHubView struct {
	BuildingID    string         `json:"building_id"`
	BuildingType  BuildingType   `json:"building_type"`
	PlanetID      string         `json:"planet_id,omitempty"`
	Capacity      int            `json:"capacity,omitempty"`
	ReadyPayloads map[string]int `json:"ready_payloads,omitempty"`
}

// WarIndustryView summarizes current military production, refit and hub stock.
type WarIndustryView struct {
	ProductionOrders []WarProductionOrder   `json:"production_orders"`
	RefitOrders      []WarRefitOrder        `json:"refit_orders"`
	DeploymentHubs   []WarDeploymentHubView `json:"deployment_hubs"`
}

// Clone returns a deep copy of the military industry state.
func (state *WarIndustryState) Clone() *WarIndustryState {
	if state == nil {
		return nil
	}
	out := &WarIndustryState{
		NextOrderSeq:     state.NextOrderSeq,
		ProductionOrders: make(map[string]*WarProductionOrder, len(state.ProductionOrders)),
		RefitOrders:      make(map[string]*WarRefitOrder, len(state.RefitOrders)),
		ProductionLines:  make(map[string]*WarProductionLineState, len(state.ProductionLines)),
		DeploymentHubs:   make(map[string]*WarDeploymentHubState, len(state.DeploymentHubs)),
	}
	for id, order := range state.ProductionOrders {
		if order == nil {
			continue
		}
		copy := *order
		out.ProductionOrders[id] = &copy
	}
	for id, order := range state.RefitOrders {
		if order == nil {
			continue
		}
		copy := *order
		out.RefitOrders[id] = &copy
	}
	for id, line := range state.ProductionLines {
		if line == nil {
			continue
		}
		copy := *line
		out.ProductionLines[id] = &copy
	}
	for id, hub := range state.DeploymentHubs {
		if hub == nil {
			continue
		}
		copy := *hub
		if len(hub.ReadyPayloads) > 0 {
			copy.ReadyPayloads = make(map[string]int, len(hub.ReadyPayloads))
			for blueprintID, count := range hub.ReadyPayloads {
				copy.ReadyPayloads[blueprintID] = count
			}
		}
		out.DeploymentHubs[id] = &copy
	}
	return out
}

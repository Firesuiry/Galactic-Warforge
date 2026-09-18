package model

import "sort"

// MechaJob is one asynchronous personal task. ReservedInputs contains only
// uncompleted craft batches, including the batch currently in progress.
type MechaJob struct {
	Kind             string       `json:"kind"`
	ResourceID       string       `json:"resource_id,omitempty"`
	RecipeID         string       `json:"recipe_id,omitempty"`
	RemainingTicks   int          `json:"remaining_ticks"`
	TicksPerBatch    int          `json:"ticks_per_batch"`
	RemainingBatches int          `json:"remaining_batches"`
	CompletedBatches int          `json:"completed_batches"`
	EnergyPerTick    int          `json:"energy_per_tick"`
	State            string       `json:"state"`
	ReservedInputs   []ItemAmount `json:"reserved_inputs,omitempty"`
}

func (j *MechaJob) Clone() *MechaJob {
	if j == nil {
		return nil
	}
	out := *j
	out.ReservedInputs = append([]ItemAmount(nil), j.ReservedInputs...)
	return &out
}

// MechaState is the persistent core of the player's executor. Fuel energy is
// retained between ticks, so even a high energy fuel rod never loses its excess.
type MechaLogisticsRequest struct {
	Min int `json:"min"`
	Max int `json:"max"`
}

type MechaState struct {
	LogisticsRequests   map[string]MechaLogisticsRequest `json:"logistics_requests,omitempty"`
	Job                 *MechaJob                        `json:"job,omitempty"`
	Energy              int                              `json:"energy"`
	MaxEnergy           int                              `json:"max_energy"`
	FuelEnergy          int                              `json:"fuel_energy"`
	Shield              int                              `json:"shield"`
	MaxShield           int                              `json:"max_shield"`
	InventoryCapacity   int                              `json:"inventory_capacity"`
	AttackEnergyCost    int                              `json:"attack_energy_cost"`
	MoveEnergyCost      int                              `json:"move_energy_cost"`
	ShieldRechargeDelay int64                            `json:"shield_recharge_delay"`
	LastHitTick         int64                            `json:"last_hit_tick"`
}

func (m *MechaState) Clone() *MechaState {
	if m == nil {
		return nil
	}
	out := *m
	out.Job = m.Job.Clone()
	if m.LogisticsRequests != nil {
		out.LogisticsRequests = make(map[string]MechaLogisticsRequest, len(m.LogisticsRequests))
		for id, request := range m.LogisticsRequests {
			out.LogisticsRequests[id] = request
		}
	}
	return &out
}

func NewMechaState() *MechaState {
	return &MechaState{Energy: 100, MaxEnergy: 100, InventoryCapacity: baseMechaInventoryCapacity, AttackEnergyCost: 8, MoveEnergyCost: 1, ShieldRechargeDelay: 10}
}

// Base executor stats before any research bonus is applied.
const (
	baseMechaMaxEnergy         = 100
	baseMechaMoveRange         = 12
	baseMechaVisionRange       = 6
	baseMechaMaxHP             = 120
	baseMechaInventoryCapacity = 200

	// Per-level bonuses for mecha upgrade techs whose definitions do not carry
	// catalog Effects yet. Keyed by tech ID so research state drives real stats.
	mechanicalFrameHPPerLevel      = 20
	inventoryCapacityPerLevel      = 60
	driveEngineMoveRangePerLevel   = 2
	energyCircuitChargePctPerLevel = 20
	chargeRatePercentBase          = 100
)

// CompletedTechLevel returns the researched level of a tech, clamped to its
// catalog MaxLevel, or 0 when the player has not completed it.
func CompletedTechLevel(player *PlayerState, techID string) int {
	if player == nil || player.Tech == nil {
		return 0
	}
	level := player.Tech.CompletedTechs[techID]
	if level <= 0 {
		return 0
	}
	if def, ok := TechDefinitionByID(techID); ok && def.MaxLevel > 0 {
		level = min(level, def.MaxLevel)
	}
	return level
}

// MechaChargeRate applies the energy_circuit research bonus to a base grid
// charge rate: +20% per completed level.
func MechaChargeRate(base int, player *PlayerState) int {
	if base <= 0 {
		return 0
	}
	pct := chargeRatePercentBase + energyCircuitChargePctPerLevel*CompletedTechLevel(player, "energy_circuit")
	return base * pct / chargeRatePercentBase
}

// TechEffectValue derives bonuses from completed research without accumulating
// effects a second time after a snapshot restore or planet switch.
func TechEffectValue(player *PlayerState, effectType string) float64 {
	if player == nil || player.Tech == nil {
		return 0
	}
	value := 0.0
	ids := make([]string, 0, len(player.Tech.CompletedTechs))
	for id := range player.Tech.CompletedTechs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		level := player.Tech.CompletedTechs[id]
		def, ok := TechDefinitionByID(id)
		if !ok || level <= 0 {
			continue
		}
		if def.MaxLevel > 0 {
			level = min(level, def.MaxLevel)
		}
		for _, effect := range def.Effects {
			if effect.Type == effectType {
				value += effect.Value * float64(level)
			}
		}
	}
	return value
}

// SyncMechaCapabilities updates derived limits but never replenishes energy or
// shield merely because research or a read/command caused synchronization.
func SyncMechaCapabilities(unit *Unit, player *PlayerState) {
	if unit == nil || unit.Type != UnitTypeExecutor {
		return
	}
	if unit.Mecha == nil {
		unit.Mecha = NewMechaState()
	}
	m := unit.Mecha
	m.MaxEnergy = baseMechaMaxEnergy + int(TechEffectValue(player, "core_capacity"))
	m.MaxShield = int(TechEffectValue(player, "shield_capacity"))
	m.InventoryCapacity = baseMechaInventoryCapacity + inventoryCapacityPerLevel*CompletedTechLevel(player, "inventory_capacity")
	m.Energy = max(0, min(m.Energy, m.MaxEnergy))
	m.Shield = max(0, min(m.Shield, m.MaxShield))
	// Logistics requests may not ask for more than the backpack can hold; the
	// distributor settlement reads Max when delivering to the mecha.
	for itemID, request := range m.LogisticsRequests {
		if request.Max > m.InventoryCapacity {
			request.Max = m.InventoryCapacity
		}
		if request.Min > request.Max {
			request.Min = request.Max
		}
		if request.Min < 0 {
			request.Min = 0
		}
		m.LogisticsRequests[itemID] = request
	}
	unit.MaxHP = baseMechaMaxHP + mechanicalFrameHPPerLevel*CompletedTechLevel(player, "mechanical_frame")
	unit.HP = max(0, min(unit.HP, unit.MaxHP))
	// mecha_engine (move_speed effect) and drive_engine stack into the same
	// movement calculation.
	unit.MoveRange = baseMechaMoveRange + int(TechEffectValue(player, "move_speed")) + driveEngineMoveRangePerLevel*CompletedTechLevel(player, "drive_engine")
	unit.VisionRange = baseMechaVisionRange + int(TechEffectValue(player, "exploration_range"))
	unit.Attack, unit.Defense, unit.AttackRange = 20, 8, 4
}

// ApplyUnitDamage routes all ordinary world-unit damage through the same shield.
func ApplyUnitDamage(unit *Unit, damage int, tick int64) (hpDamage, absorbed int) {
	if unit == nil || damage <= 0 {
		return 0, 0
	}
	if unit.Mecha != nil {
		unit.Mecha.LastHitTick = tick
		absorbed = min(damage, unit.Mecha.Shield)
		unit.Mecha.Shield -= absorbed
	}
	hpDamage = damage - absorbed
	unit.HP -= hpDamage
	return hpDamage, absorbed
}

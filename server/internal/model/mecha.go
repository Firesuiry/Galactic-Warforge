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
	EnergyPerBatch   int          `json:"energy_per_batch"` // 每批开工时一次性扣除的核心能量
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

// NewMechaState 以 units.yaml 中执行体的 mecha 段为基础值生成满能量机甲状态。
func NewMechaState() *MechaState {
	return newMechaState(executorMechaSpec())
}

func newMechaState(spec MechaSpec) *MechaState {
	return &MechaState{
		Energy:              spec.MaxEnergy,
		MaxEnergy:           spec.MaxEnergy,
		InventoryCapacity:   spec.InventoryCapacity,
		AttackEnergyCost:    spec.AttackEnergyCost,
		MoveEnergyCost:      spec.MoveEnergyCost,
		ShieldRechargeDelay: spec.ShieldRechargeDelay,
	}
}

// executorMechaSpec 执行体机甲基础值（units.yaml executor.mecha）。
func executorMechaSpec() MechaSpec {
	if spec := unitDefinitions[UnitTypeExecutor].Mecha; spec != nil {
		return *spec
	}
	return MechaSpec{}
}

const chargeRatePercentBase = 100

// MechaChargeRate applies the energy_circuit research bonus (catalog effect
// "mecha_charge_rate_pct", +20% per level) to a base grid charge rate.
func MechaChargeRate(base int, player *PlayerState) int {
	if base <= 0 {
		return 0
	}
	pct := chargeRatePercentBase + int(TechEffectValue(player, "mecha_charge_rate_pct"))
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
	// 研究前的基础值来自 units.yaml 的 executor 条目（战斗数值 + mecha 段）。
	base := unitDefinitions[UnitTypeExecutor]
	spec := executorMechaSpec()
	m.MaxEnergy = spec.MaxEnergy + int(TechEffectValue(player, "core_capacity"))
	m.MaxShield = int(TechEffectValue(player, "shield_capacity"))
	m.InventoryCapacity = spec.InventoryCapacity + int(TechEffectValue(player, "mecha_inventory_capacity"))
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
	// Combat techs apply multiplicatively on top of the mecha-tree flat bonuses,
	// mechanical_frame adds to the mecha structure HP track;
	// flat HP, df_enhanced_structure (structure_hp) scales the total; weapon
	// damage techs scale the base attack.
	maxHP := base.MaxHP + int(TechEffectValue(player, "mecha_max_hp"))
	if hpBonus := TechEffectValue(player, "structure_hp"); hpBonus != 0 {
		maxHP = int(float64(maxHP) * (1.0 + hpBonus))
	}
	unit.MaxHP = maxHP
	unit.HP = max(0, min(unit.HP, unit.MaxHP))
	// mecha_engine and drive_engine stack through the shared move_speed effect.
	unit.MoveRange = base.MoveRange + int(TechEffectValue(player, "move_speed"))
	unit.VisionRange = base.VisionRange + int(TechEffectValue(player, "exploration_range"))
	attack := base.Attack
	if dmgBonus := TechEffectValue(player, "weapon_damage"); dmgBonus != 0 {
		attack = int(float64(attack) * (1.0 + dmgBonus))
	}
	unit.Attack, unit.Defense, unit.AttackRange = attack, base.Defense, base.AttackRange
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

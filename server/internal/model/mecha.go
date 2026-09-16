package model

import "sort"

// MechaState is the persistent core of the player's executor. Fuel energy is
// retained between ticks, so even a high energy fuel rod never loses its excess.
type MechaState struct {
	Energy              int   `json:"energy"`
	MaxEnergy           int   `json:"max_energy"`
	FuelEnergy          int   `json:"fuel_energy"`
	Shield              int   `json:"shield"`
	MaxShield           int   `json:"max_shield"`
	AttackEnergyCost    int   `json:"attack_energy_cost"`
	MoveEnergyCost      int   `json:"move_energy_cost"`
	ShieldRechargeDelay int64 `json:"shield_recharge_delay"`
	LastHitTick         int64 `json:"last_hit_tick"`
}

func NewMechaState() *MechaState {
	return &MechaState{Energy: 100, MaxEnergy: 100, AttackEnergyCost: 8, MoveEnergyCost: 1, ShieldRechargeDelay: 10}
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
	m.MaxEnergy = 100 + int(TechEffectValue(player, "core_capacity"))
	m.MaxShield = int(TechEffectValue(player, "shield_capacity"))
	m.Energy = max(0, min(m.Energy, m.MaxEnergy))
	m.Shield = max(0, min(m.Shield, m.MaxShield))
	unit.MoveRange = 12 + int(TechEffectValue(player, "move_speed"))
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

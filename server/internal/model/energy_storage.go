package model

import (
	"math"
	"sort"
)

// EnergyStorageState tracks stored energy for a building.
type EnergyStorageState struct {
	Energy int `json:"energy"`
}

// EnergyStorageNode binds a storage state to a building in a network.
type EnergyStorageNode struct {
	ID     string
	Module *EnergyStorageModule
	State  *EnergyStorageState
}

// EnergyStorageAction captures charge/discharge results for a storage building.
type EnergyStorageAction struct {
	BuildingID      string
	ChargeInput     int
	ChargeStored    int
	DischargeOutput int
	DischargeUsed   int
}

// NewEnergyStorageState initializes a storage state from a module.
func NewEnergyStorageState(module EnergyStorageModule) *EnergyStorageState {
	energy := module.InitialCharge
	if energy < 0 {
		energy = 0
	}
	if module.Capacity > 0 && energy > module.Capacity {
		energy = module.Capacity
	}
	return &EnergyStorageState{Energy: energy}
}

// Clone returns a deep copy of the energy storage state.
func (s *EnergyStorageState) Clone() *EnergyStorageState {
	if s == nil {
		return nil
	}
	clone := *s
	return &clone
}

// EnergyStorageNodesForNetwork collects storage nodes for a power network.
func EnergyStorageNodesForNetwork(ws *WorldState, network *PowerNetwork) []EnergyStorageNode {
	if ws == nil || network == nil || len(network.NodeIDs) == 0 {
		return nil
	}
	nodes := make([]EnergyStorageNode, 0)
	for _, id := range network.NodeIDs {
		building := ws.Buildings[id]
		if building == nil || building.Runtime.Functions.EnergyStorage == nil {
			continue
		}
		if building.EnergyStorage == nil {
			InitBuildingEnergyStorage(building)
		}
		if building.EnergyStorage == nil {
			continue
		}
		nodes = append(nodes, EnergyStorageNode{
			ID:     id,
			Module: building.Runtime.Functions.EnergyStorage,
			State:  building.EnergyStorage,
		})
	}
	return nodes
}

// NetworkHasEnergyHub returns true when the network includes an energy hub.
func NetworkHasEnergyHub(ws *WorldState, network *PowerNetwork) bool {
	if ws == nil || network == nil {
		return false
	}
	for _, id := range network.NodeIDs {
		building := ws.Buildings[id]
		if building != nil && building.Type == BuildingTypeEnergyExchanger {
			return true
		}
	}
	return false
}

// ApplyEnergyStorageCharge distributes surplus power into storage units.
func ApplyEnergyStorageCharge(nodes []EnergyStorageNode, surplus int, balance bool) ([]EnergyStorageAction, int) {
	if surplus <= 0 || len(nodes) == 0 {
		return nil, 0
	}
	entries := buildEnergyStorageEntries(nodes, chargeLimit)
	return applyEnergyStorage(entries, surplus, balance, applyCharge)
}

// ApplyEnergyStorageDischarge draws from storage units to supply power deficits.
func ApplyEnergyStorageDischarge(nodes []EnergyStorageNode, shortage int, balance bool) ([]EnergyStorageAction, int) {
	if shortage <= 0 || len(nodes) == 0 {
		return nil, 0
	}
	entries := buildEnergyStorageEntries(nodes, dischargeLimit)
	return applyEnergyStorage(entries, shortage, balance, applyDischarge)
}

type energyStorageEntry struct {
	node     EnergyStorageNode
	priority int
	limit    int
}

type energyStorageApplyFunc func(entry energyStorageEntry, amount int) EnergyStorageAction

func buildEnergyStorageEntries(nodes []EnergyStorageNode, limitFn func(EnergyStorageNode) int) []energyStorageEntry {
	entries := make([]energyStorageEntry, 0, len(nodes))
	for _, node := range nodes {
		if node.Module == nil || node.State == nil {
			continue
		}
		limit := limitFn(node)
		if limit <= 0 {
			continue
		}
		priority := node.Module.Priority
		entries = append(entries, energyStorageEntry{
			node:     node,
			priority: priority,
			limit:    limit,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].priority != entries[j].priority {
			return entries[i].priority > entries[j].priority
		}
		return entries[i].node.ID < entries[j].node.ID
	})
	return entries
}

func applyEnergyStorage(entries []energyStorageEntry, amount int, balance bool, applyFn energyStorageApplyFunc) ([]EnergyStorageAction, int) {
	if len(entries) == 0 || amount <= 0 {
		return nil, 0
	}
	remaining := amount
	actions := make([]EnergyStorageAction, 0)
	used := 0

	for i := 0; i < len(entries) && remaining > 0; {
		priority := entries[i].priority
		j := i
		groupLimit := 0
		for j < len(entries) && entries[j].priority == priority {
			groupLimit += entries[j].limit
			j++
		}
		if groupLimit <= 0 {
			i = j
			continue
		}

		groupTarget := remaining
		if groupTarget > groupLimit {
			groupTarget = groupLimit
		}

		groupAlloc := allocateByLimit(entries[i:j], groupTarget, balance)
		for idx, alloc := range groupAlloc {
			if alloc <= 0 {
				continue
			}
			action := applyFn(entries[i+idx], alloc)
			if action.ChargeInput > 0 || action.DischargeOutput > 0 {
				actions = append(actions, action)
			}
			used += alloc
		}

		remaining = amount - used
		i = j
	}

	return actions, used
}

func allocateByLimit(entries []energyStorageEntry, total int, balance bool) []int {
	if len(entries) == 0 || total <= 0 {
		return nil
	}
	alloc := make([]int, len(entries))
	if !balance {
		remaining := total
		for i := range entries {
			if remaining <= 0 {
				break
			}
			limit := entries[i].limit
			if limit > remaining {
				limit = remaining
			}
			alloc[i] = limit
			remaining -= limit
		}
		return alloc
	}

	totalLimit := 0
	for _, entry := range entries {
		totalLimit += entry.limit
	}
	if totalLimit <= 0 {
		return alloc
	}
	if total >= totalLimit {
		for i, entry := range entries {
			alloc[i] = entry.limit
		}
		return alloc
	}

	allocated := 0
	for i, entry := range entries {
		share := int(float64(entry.limit) * float64(total) / float64(totalLimit))
		if share > entry.limit {
			share = entry.limit
		}
		if share < 0 {
			share = 0
		}
		alloc[i] = share
		allocated += share
	}

	leftover := total - allocated
	for i := 0; i < len(entries) && leftover > 0; i++ {
		if alloc[i] >= entries[i].limit {
			continue
		}
		alloc[i]++
		leftover--
		if leftover == 0 {
			break
		}
		if i == len(entries)-1 && leftover > 0 {
			i = -1
		}
	}

	return alloc
}

func chargeLimit(node EnergyStorageNode) int {
	module := node.Module
	state := node.State
	if module == nil || state == nil {
		return 0
	}
	if module.Capacity <= 0 || module.ChargePerTick <= 0 {
		return 0
	}
	remaining := module.Capacity - state.Energy
	if remaining <= 0 {
		return 0
	}
	eff := clampEfficiency(module.ChargeEfficiency)
	if eff <= 0 {
		return 0
	}
	required := int(math.Ceil(float64(remaining) / eff))
	if required < 0 {
		required = 0
	}
	if required > module.ChargePerTick {
		required = module.ChargePerTick
	}
	return required
}

func dischargeLimit(node EnergyStorageNode) int {
	module := node.Module
	state := node.State
	if module == nil || state == nil {
		return 0
	}
	if module.DischargePerTick <= 0 || state.Energy <= 0 {
		return 0
	}
	eff := clampEfficiency(module.DischargeEfficiency)
	if eff <= 0 {
		return 0
	}
	maxOutput := int(math.Floor(float64(state.Energy) * eff))
	if maxOutput > module.DischargePerTick {
		maxOutput = module.DischargePerTick
	}
	if maxOutput < 0 {
		return 0
	}
	return maxOutput
}

func applyCharge(entry energyStorageEntry, input int) EnergyStorageAction {
	module := entry.node.Module
	state := entry.node.State
	if module == nil || state == nil || input <= 0 {
		return EnergyStorageAction{BuildingID: entry.node.ID}
	}
	eff := clampEfficiency(module.ChargeEfficiency)
	if eff <= 0 {
		return EnergyStorageAction{BuildingID: entry.node.ID}
	}
	stored := int(math.Floor(float64(input) * eff))
	remaining := module.Capacity - state.Energy
	if stored > remaining {
		stored = remaining
	}
	if stored < 0 {
		stored = 0
	}
	state.Energy += stored
	return EnergyStorageAction{
		BuildingID:   entry.node.ID,
		ChargeInput:  input,
		ChargeStored: stored,
	}
}

func applyDischarge(entry energyStorageEntry, output int) EnergyStorageAction {
	module := entry.node.Module
	state := entry.node.State
	if module == nil || state == nil || output <= 0 {
		return EnergyStorageAction{BuildingID: entry.node.ID}
	}
	eff := clampEfficiency(module.DischargeEfficiency)
	if eff <= 0 {
		return EnergyStorageAction{BuildingID: entry.node.ID}
	}
	energyUsed := int(math.Ceil(float64(output) / eff))
	if energyUsed > state.Energy {
		energyUsed = state.Energy
		output = int(math.Floor(float64(energyUsed) * eff))
	}
	if energyUsed < 0 {
		energyUsed = 0
	}
	state.Energy -= energyUsed
	return EnergyStorageAction{
		BuildingID:      entry.node.ID,
		DischargeOutput: output,
		DischargeUsed:   energyUsed,
	}
}

func clampEfficiency(value float64) float64 {
	if value <= 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

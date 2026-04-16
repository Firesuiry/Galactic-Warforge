package model

import (
	"sort"

	modelpower "siliconworld/internal/model/power"
)

// PowerNetwork aggregates power supply/demand within a connected grid component.
type PowerNetwork struct {
	ID      string
	OwnerID string
	NodeIDs []string
	Supply  int
	Demand  int
	Net     int
}

// PowerNetworkState captures network aggregates and per-building membership.
type PowerNetworkState struct {
	Networks        map[string]*PowerNetwork
	BuildingNetwork map[string]string
}

// ResolvePowerNetworks builds power network aggregates from current world state.
func ResolvePowerNetworks(ws *WorldState) PowerNetworkState {
	state := PowerNetworkState{
		Networks:        make(map[string]*PowerNetwork),
		BuildingNetwork: make(map[string]string),
	}
	if ws == nil {
		return state
	}
	grid := ws.PowerGrid
	if grid == nil {
		grid = BuildPowerGridGraph(ws)
	}
	if grid == nil || len(grid.Nodes) == 0 {
		return state
	}
	powerInputs := powerInputsByBuilding(ws.PowerInputs)
	visited := make(map[string]struct{})

	for nodeID, node := range grid.Nodes {
		if node == nil {
			continue
		}
		if _, ok := visited[nodeID]; ok {
			continue
		}
		owner := node.OwnerID
		queue := []string{nodeID}
		visited[nodeID] = struct{}{}
		component := make([]string, 0)
		supply := 0
		demand := 0

		for len(queue) > 0 {
			id := queue[0]
			queue = queue[1:]
			current := grid.Nodes[id]
			if current == nil || current.OwnerID != owner {
				continue
			}
			component = append(component, id)
			if building := ws.Buildings[id]; building != nil {
				supply += powerSupplyForBuilding(building, powerInputs)
				demand += powerDemandForBuilding(building)
			}
			for neighbor := range grid.Edges[id] {
				if _, seen := visited[neighbor]; seen {
					continue
				}
				neighborNode := grid.Nodes[neighbor]
				if neighborNode == nil || neighborNode.OwnerID != owner {
					continue
				}
				visited[neighbor] = struct{}{}
				queue = append(queue, neighbor)
			}
		}

		if len(component) == 0 {
			continue
		}
		sort.Strings(component)
		networkID := component[0]
		network := &PowerNetwork{
			ID:      networkID,
			OwnerID: owner,
			NodeIDs: component,
			Supply:  supply,
			Demand:  demand,
			Net:     supply - demand,
		}
		state.Networks[networkID] = network
		for _, id := range component {
			state.BuildingNetwork[id] = networkID
		}
	}

	return state
}

func powerInputsByBuilding(inputs []PowerInput) map[string]int {
	if len(inputs) == 0 {
		return nil
	}
	result := make(map[string]int)
	for _, input := range inputs {
		if input.BuildingID == "" || input.Output <= 0 {
			continue
		}
		result[input.BuildingID] += input.Output
	}
	return result
}

func powerSupplyForBuilding(building *Building, powerInputs map[string]int) int {
	if building == nil {
		return 0
	}
	module := building.Runtime.Functions.Energy
	if modelpower.IsPowerGeneratorModule(module) {
		if powerInputs == nil {
			return 0
		}
		return powerInputs[building.ID]
	}
	if powerInputs != nil {
		if output := powerInputs[building.ID]; output > 0 {
			return output
		}
	}
	output := building.Runtime.Params.EnergyGenerate
	if module != nil && module.OutputPerTick > output {
		output = module.OutputPerTick
	}
	if output < 0 {
		return 0
	}
	return output
}

func powerDemandForBuilding(building *Building) int {
	if building == nil {
		return 0
	}
	params := building.Runtime.Params
	baseConsume := params.EnergyConsume
	if module := building.Runtime.Functions.Energy; module != nil && module.ConsumePerTick > baseConsume {
		baseConsume = module.ConsumePerTick
	}
	if baseConsume < 0 {
		baseConsume = 0
	}
	maintenance := params.MaintenanceCost.Energy
	if maintenance < 0 {
		maintenance = 0
	}
	demand := baseConsume + maintenance
	if demand < 0 {
		return 0
	}
	return demand
}

// PowerDemandForBuilding returns the effective energy demand for a building.
func PowerDemandForBuilding(building *Building) int {
	return powerDemandForBuilding(building)
}

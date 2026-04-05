package model

import "sort"

// PowerCoverageFailureReason describes why a building is not powered by the grid.
type PowerCoverageFailureReason string

const (
	PowerCoverageOK           PowerCoverageFailureReason = ""
	PowerCoverageNoConnector  PowerCoverageFailureReason = "no_connector"
	PowerCoverageNoProvider   PowerCoverageFailureReason = "no_provider"
	PowerCoverageOutOfRange   PowerCoverageFailureReason = "out_of_range"
	PowerCoverageCapacityFull PowerCoverageFailureReason = "capacity_full"
)

// PowerCoverageResult captures power access evaluation for a building.
type PowerCoverageResult struct {
	Connected  bool
	Reason     PowerCoverageFailureReason
	ProviderID string
	NetworkID  string
}

// ResolvePowerCoverage evaluates which buildings are connected to a power grid.
func ResolvePowerCoverage(ws *WorldState) map[string]PowerCoverageResult {
	results := make(map[string]PowerCoverageResult)
	if ws == nil {
		return results
	}
	grid := ws.PowerGrid
	if grid == nil {
		grid = BuildPowerGridGraph(ws)
	}
	networks := ResolvePowerNetworks(ws)
	powerInputs := powerInputsByBuilding(ws.PowerInputs)

	ownerHasSource := make(map[string]bool)
	for _, building := range ws.Buildings {
		if building == nil {
			continue
		}
		if !isPowerCoverageSource(building, powerInputs) {
			continue
		}
		ownerHasSource[building.OwnerID] = true
	}

	consumers := make([]string, 0)
	for id, building := range ws.Buildings {
		if building == nil {
			continue
		}
		if needsPowerCoverage(building) {
			consumers = append(consumers, id)
		}
	}
	if len(consumers) == 0 {
		return results
	}

	visited := make(map[string]struct{})
	if grid != nil {
		for nodeID, node := range grid.Nodes {
			if node == nil {
				continue
			}
			if _, seen := visited[nodeID]; seen {
				continue
			}
			owner := node.OwnerID
			queue := []string{nodeID}
			visited[nodeID] = struct{}{}
			componentConsumers := make(map[string]struct{})
			componentSource := ""

			for len(queue) > 0 {
				id := queue[0]
				queue = queue[1:]
				node := grid.Nodes[id]
				if node == nil || node.OwnerID != owner {
					continue
				}
				building := ws.Buildings[id]
				if building != nil {
					if needsPowerCoverage(building) {
						componentConsumers[id] = struct{}{}
					}
					if componentSource == "" && isPowerCoverageSource(building, powerInputs) {
						componentSource = id
					}
				}

				for neighbor := range grid.Edges[id] {
					if _, ok := visited[neighbor]; ok {
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

			if len(componentConsumers) == 0 {
				continue
			}

			consumerIDs := make([]string, 0, len(componentConsumers))
			for id := range componentConsumers {
				consumerIDs = append(consumerIDs, id)
			}
			sort.Strings(consumerIDs)

			for _, cid := range consumerIDs {
				if componentSource != "" {
					results[cid] = PowerCoverageResult{
						Connected:  true,
						ProviderID: componentSource,
						NetworkID:  networks.BuildingNetwork[cid],
					}
					continue
				}
				reason := PowerCoverageNoProvider
				if ownerHasSource[owner] {
					reason = PowerCoverageOutOfRange
				}
				results[cid] = PowerCoverageResult{
					Connected: false,
					Reason:    reason,
					NetworkID: networks.BuildingNetwork[cid],
				}
			}
		}
	}

	for _, id := range consumers {
		if _, ok := results[id]; ok {
			continue
		}
		building := ws.Buildings[id]
		owner := ""
		if building != nil {
			owner = building.OwnerID
		}
		if grid == nil || grid.Nodes[id] == nil {
			results[id] = PowerCoverageResult{Connected: false, Reason: PowerCoverageNoConnector}
			continue
		}
		if !ownerHasSource[owner] {
			results[id] = PowerCoverageResult{
				Connected: false,
				Reason:    PowerCoverageNoProvider,
				NetworkID: networks.BuildingNetwork[id],
			}
			continue
		}
		results[id] = PowerCoverageResult{
			Connected: false,
			Reason:    PowerCoverageOutOfRange,
			NetworkID: networks.BuildingNetwork[id],
		}
	}

	return results
}

func needsPowerCoverage(building *Building) bool {
	if building == nil {
		return false
	}
	params := building.Runtime.Params
	if params.EnergyConsume > 0 || params.MaintenanceCost.Energy > 0 {
		return true
	}
	if building.Runtime.Functions.Energy != nil && building.Runtime.Functions.Energy.ConsumePerTick > 0 {
		return true
	}
	return false
}

func isPowerCoverageSource(building *Building, powerInputs map[string]int) bool {
	if building == nil {
		return false
	}
	if powerInputs != nil && powerInputs[building.ID] > 0 {
		return true
	}
	if IsPowerGeneratorModule(building.Runtime.Functions.Energy) {
		return true
	}
	if building.Runtime.Functions.EnergyStorage != nil && building.EnergyStorage != nil && building.EnergyStorage.Energy > 0 {
		return true
	}
	return building.Runtime.Params.EnergyGenerate > 0
}

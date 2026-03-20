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
}

type providerCapacity struct {
	Remaining int
	Unlimited bool
}

type providerSlot struct {
	ID        string
	Remaining int
	Unlimited bool
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

	providerCounts := make(map[string]int)
	providerCaps := make(map[string]providerCapacity)
	for id, building := range ws.Buildings {
		if building == nil {
			continue
		}
		if !isPowerCoverageProvider(building) {
			continue
		}
		providerCounts[building.OwnerID]++
		providerCaps[id] = powerProviderCapacity(building)
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
			providerSlots := make([]providerSlot, 0)
			providerAdded := make(map[string]struct{})

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
					if isPowerCoverageProvider(building) {
						if _, ok := providerAdded[id]; !ok {
							cap := providerCaps[id]
							if cap.Unlimited || cap.Remaining > 0 {
								providerSlots = append(providerSlots, providerSlot{
									ID:        id,
									Remaining: cap.Remaining,
									Unlimited: cap.Unlimited,
								})
							}
							providerAdded[id] = struct{}{}
						}
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
			sort.Slice(providerSlots, func(i, j int) bool {
				return providerSlots[i].ID < providerSlots[j].ID
			})

			for _, cid := range consumerIDs {
				assigned := false
				for i := range providerSlots {
					slot := &providerSlots[i]
					if slot.Unlimited || slot.Remaining > 0 {
						results[cid] = PowerCoverageResult{Connected: true, ProviderID: slot.ID}
						if !slot.Unlimited {
							slot.Remaining--
						}
						assigned = true
						break
					}
				}
				if assigned {
					continue
				}
				reason := PowerCoverageCapacityFull
				if len(providerSlots) == 0 {
					if providerCounts[owner] == 0 {
						reason = PowerCoverageNoProvider
					} else {
						reason = PowerCoverageOutOfRange
					}
				}
				results[cid] = PowerCoverageResult{Connected: false, Reason: reason}
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
		if providerCounts[owner] == 0 {
			results[id] = PowerCoverageResult{Connected: false, Reason: PowerCoverageNoProvider}
			continue
		}
		results[id] = PowerCoverageResult{Connected: false, Reason: PowerCoverageOutOfRange}
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

func isPowerCoverageProvider(building *Building) bool {
	if building == nil {
		return false
	}
	if IsPowerGridBuilding(building.Type) {
		return true
	}
	if IsPowerGeneratorModule(building.Runtime.Functions.Energy) {
		return true
	}
	return building.Runtime.Params.EnergyGenerate > 0
}

func powerProviderCapacity(building *Building) providerCapacity {
	connectors := powerGridConnectors(building)
	if len(connectors) == 0 {
		return providerCapacity{}
	}
	remaining := 0
	unlimited := false
	for _, conn := range connectors {
		if conn.Capacity <= 0 {
			unlimited = true
			continue
		}
		remaining += conn.Capacity
	}
	if unlimited {
		return providerCapacity{Unlimited: true}
	}
	return providerCapacity{Remaining: remaining}
}

package model

import "sort"

// PowerAllocation describes per-building power allocation within a network.
type PowerAllocation struct {
	NetworkID string
	Demand    int
	Allocated int
	Ratio     float64
	Priority  int
}

// PowerAllocationNetwork captures allocation summary for a power network.
type PowerAllocationNetwork struct {
	ID        string
	OwnerID   string
	Supply    int
	Demand    int
	Allocated int
	Net       int
	Shortage  bool
}

// PowerAllocationState returns allocation results for networks and buildings.
type PowerAllocationState struct {
	Networks  map[string]*PowerAllocationNetwork
	Buildings map[string]PowerAllocation
}

type powerConsumer struct {
	id       string
	demand   int
	priority int
}

// ResolvePowerAllocations allocates power supply to connected consumers by priority.
func ResolvePowerAllocations(ws *WorldState, coverage map[string]PowerCoverageResult) PowerAllocationState {
	state := PowerAllocationState{
		Networks:  make(map[string]*PowerAllocationNetwork),
		Buildings: make(map[string]PowerAllocation),
	}
	if ws == nil {
		return state
	}
	if coverage == nil {
		coverage = ResolvePowerCoverage(ws)
	}
	powerInputs := powerInputsByBuilding(ws.PowerInputs)
	networks := ResolvePowerNetworks(ws)
	if len(networks.Networks) == 0 {
		return state
	}

	for _, network := range networks.Networks {
		if network == nil {
			continue
		}
		consumers := make([]powerConsumer, 0)
		supply := 0
		for _, id := range network.NodeIDs {
			building := ws.Buildings[id]
			if building == nil {
				continue
			}
			if powerSupplyActive(building) {
				supply += powerSupplyForBuilding(building, powerInputs)
			}
			if !powerDemandActive(building) {
				continue
			}
			demand := powerDemandForBuilding(building)
			if demand <= 0 {
				continue
			}
			cov := coverage[id]
			if !cov.Connected {
				continue
			}
			consumers = append(consumers, powerConsumer{
				id:       id,
				demand:   demand,
				priority: powerPriorityForBuilding(building),
			})
		}

		if len(consumers) == 0 {
			state.Networks[network.ID] = &PowerAllocationNetwork{
				ID:        network.ID,
				OwnerID:   network.OwnerID,
				Supply:    supply,
				Demand:    0,
				Allocated: 0,
				Net:       supply,
				Shortage:  false,
			}
			continue
		}

		sort.Slice(consumers, func(i, j int) bool {
			if consumers[i].priority != consumers[j].priority {
				return consumers[i].priority > consumers[j].priority
			}
			return consumers[i].id < consumers[j].id
		})

		demandTotal := 0
		allocations := make(map[string]int, len(consumers))
		for _, consumer := range consumers {
			demandTotal += consumer.demand
			allocations[consumer.id] = 0
		}

		remaining := supply
		for i := 0; i < len(consumers) && remaining > 0; {
			priority := consumers[i].priority
			j := i + 1
			groupDemand := consumers[i].demand
			for j < len(consumers) && consumers[j].priority == priority {
				groupDemand += consumers[j].demand
				j++
			}
			if groupDemand <= 0 {
				i = j
				continue
			}

			if remaining >= groupDemand {
				for k := i; k < j; k++ {
					allocations[consumers[k].id] = consumers[k].demand
				}
				remaining -= groupDemand
				i = j
				continue
			}

			ratio := float64(remaining) / float64(groupDemand)
			allocatedSum := 0
			for k := i; k < j; k++ {
				alloc := int(float64(consumers[k].demand) * ratio)
				if alloc < 0 {
					alloc = 0
				}
				if alloc > consumers[k].demand {
					alloc = consumers[k].demand
				}
				allocations[consumers[k].id] = alloc
				allocatedSum += alloc
			}
			leftover := remaining - allocatedSum
			for k := i; k < j && leftover > 0; k++ {
				allocations[consumers[k].id]++
				leftover--
			}
			remaining = 0
			break
		}

		allocatedTotal := 0
		for _, consumer := range consumers {
			alloc := allocations[consumer.id]
			allocatedTotal += alloc
			ratio := 0.0
			if consumer.demand > 0 && alloc > 0 {
				ratio = float64(alloc) / float64(consumer.demand)
				if ratio > 1 {
					ratio = 1
				}
			}
			state.Buildings[consumer.id] = PowerAllocation{
				NetworkID: network.ID,
				Demand:    consumer.demand,
				Allocated: alloc,
				Ratio:     ratio,
				Priority:  consumer.priority,
			}
		}

		state.Networks[network.ID] = &PowerAllocationNetwork{
			ID:        network.ID,
			OwnerID:   network.OwnerID,
			Supply:    supply,
			Demand:    demandTotal,
			Allocated: allocatedTotal,
			Net:       supply - demandTotal,
			Shortage:  supply < demandTotal,
		}
	}

	return state
}

func powerDemandActive(building *Building) bool {
	if building == nil {
		return false
	}
	switch building.Runtime.State {
	case BuildingWorkPaused, BuildingWorkIdle:
		return false
	default:
		return true
	}
}

func powerSupplyActive(building *Building) bool {
	if building == nil {
		return false
	}
	switch building.Runtime.State {
	case BuildingWorkPaused, BuildingWorkIdle, BuildingWorkError, BuildingWorkNoPower:
		return false
	default:
		return true
	}
}

func powerPriorityForBuilding(building *Building) int {
	if building == nil {
		return defaultPowerPriority
	}
	if building.Runtime.Params.PowerPriority > 0 {
		return building.Runtime.Params.PowerPriority
	}
	def, ok := BuildingDefinitionByID(building.Type)
	if !ok {
		return defaultPowerPriority
	}
	return powerPriorityForCategory(def.Category)
}

const defaultPowerPriority = 1

func powerPriorityForCategory(category BuildingCategory) int {
	switch category {
	case BuildingCategoryCommandSignal:
		return 100
	case BuildingCategoryPowerGrid:
		return 90
	case BuildingCategoryPower:
		return 80
	case BuildingCategoryDyson:
		return 70
	case BuildingCategoryLogisticsHub:
		return 60
	case BuildingCategoryResearch:
		return 50
	case BuildingCategoryProduction:
		return 45
	case BuildingCategoryChemical, BuildingCategoryRefining:
		return 40
	case BuildingCategoryCollect:
		return 35
	case BuildingCategoryTransport, BuildingCategoryStorage:
		return 30
	default:
		return defaultPowerPriority
	}
}

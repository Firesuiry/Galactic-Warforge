package model

// PowerSettlementSnapshot is the authoritative per-tick power settlement result.
type PowerSettlementSnapshot struct {
	Tick        int64                                `json:"tick"`
	Inputs      []PowerInput                         `json:"inputs,omitempty"`
	Coverage    map[string]PowerCoverageResult       `json:"coverage,omitempty"`
	Networks    PowerNetworkState                    `json:"networks"`
	Allocations PowerAllocationState                 `json:"allocations"`
	Players     map[string]PlayerPowerSnapshot       `json:"players,omitempty"`
	Receivers   map[string]RayReceiverSettlementView `json:"receivers,omitempty"`
}

// PlayerPowerSnapshot captures the authoritative power delta for a player in a tick.
type PlayerPowerSnapshot struct {
	StartEnergy int `json:"start_energy"`
	Generation  int `json:"generation"`
	Demand      int `json:"demand"`
	Allocated   int `json:"allocated"`
	NetDelta    int `json:"net_delta"`
	EndEnergy   int `json:"end_energy"`
}

// RayReceiverSettlementView captures the observable result of a ray receiver in a tick.
type RayReceiverSettlementView struct {
	BuildingID           string          `json:"building_id"`
	Mode                 RayReceiverMode `json:"mode"`
	AvailableDysonEnergy int             `json:"available_dyson_energy"`
	EffectiveInput       int             `json:"effective_input"`
	PowerOutput          int             `json:"power_output"`
	PhotonOutput         int             `json:"photon_output"`
	NetworkID            string          `json:"network_id,omitempty"`
	SettledTick          int64           `json:"settled_tick"`
}

// CurrentPowerSettlementSnapshot returns the current authoritative snapshot when available,
// and otherwise builds a same-source fallback view from the live world state.
func CurrentPowerSettlementSnapshot(ws *WorldState) *PowerSettlementSnapshot {
	if ws == nil {
		return nil
	}
	if ws.PowerSnapshot != nil && ws.PowerSnapshot.Tick == ws.Tick {
		return ws.PowerSnapshot
	}
	return BuildPowerSettlementSnapshot(ws, nil)
}

// BuildPowerSettlementSnapshot derives the authoritative power view from current world state.
func BuildPowerSettlementSnapshot(ws *WorldState, receiverViews map[string]RayReceiverSettlementView) *PowerSettlementSnapshot {
	if ws == nil {
		return nil
	}

	coverage := ResolvePowerCoverage(ws)
	networks := ResolvePowerNetworks(ws)
	allocations := ResolvePowerAllocations(ws, coverage)

	players := make(map[string]PlayerPowerSnapshot)
	for playerID, player := range ws.Players {
		if player == nil || !player.IsAlive {
			continue
		}
		players[playerID] = PlayerPowerSnapshot{
			StartEnergy: player.Resources.Energy,
			EndEnergy:   player.Resources.Energy,
		}
	}

	for _, network := range networks.Networks {
		if network == nil {
			continue
		}
		player := players[network.OwnerID]
		player.Generation += network.Supply
		player.Demand += network.Demand
		players[network.OwnerID] = player
	}
	for _, network := range allocations.Networks {
		if network == nil {
			continue
		}
		player := players[network.OwnerID]
		player.Allocated += network.Allocated
		players[network.OwnerID] = player
	}
	for playerID, player := range players {
		player.NetDelta = player.Generation - player.Allocated
		player.EndEnergy = clampPowerSnapshotEnergy(player.StartEnergy + player.NetDelta)
		players[playerID] = player
	}

	for buildingID, cov := range coverage {
		if cov.NetworkID != "" {
			continue
		}
		cov.NetworkID = networks.BuildingNetwork[buildingID]
		coverage[buildingID] = cov
	}

	receivers := cloneRayReceiverSettlementViews(receiverViews)
	for buildingID, receiver := range receivers {
		if receiver.NetworkID == "" {
			receiver.NetworkID = networks.BuildingNetwork[buildingID]
		}
		if receiver.SettledTick == 0 {
			receiver.SettledTick = ws.Tick
		}
		receivers[buildingID] = receiver
	}

	return &PowerSettlementSnapshot{
		Tick:        ws.Tick,
		Inputs:      append([]PowerInput(nil), ws.PowerInputs...),
		Coverage:    clonePowerCoverageMap(coverage),
		Networks:    clonePowerNetworkState(networks),
		Allocations: clonePowerAllocationState(allocations),
		Players:     players,
		Receivers:   receivers,
	}
}

func clonePowerCoverageMap(in map[string]PowerCoverageResult) map[string]PowerCoverageResult {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]PowerCoverageResult, len(in))
	for id, result := range in {
		out[id] = result
	}
	return out
}

func clonePowerNetworkState(in PowerNetworkState) PowerNetworkState {
	out := PowerNetworkState{
		Networks:        make(map[string]*PowerNetwork, len(in.Networks)),
		BuildingNetwork: make(map[string]string, len(in.BuildingNetwork)),
	}
	for id, network := range in.Networks {
		if network == nil {
			continue
		}
		cp := *network
		cp.NodeIDs = append([]string(nil), network.NodeIDs...)
		out.Networks[id] = &cp
	}
	for buildingID, networkID := range in.BuildingNetwork {
		out.BuildingNetwork[buildingID] = networkID
	}
	return out
}

func clonePowerAllocationState(in PowerAllocationState) PowerAllocationState {
	out := PowerAllocationState{
		Networks:  make(map[string]*PowerAllocationNetwork, len(in.Networks)),
		Buildings: make(map[string]PowerAllocation, len(in.Buildings)),
	}
	for id, network := range in.Networks {
		if network == nil {
			continue
		}
		cp := *network
		out.Networks[id] = &cp
	}
	for buildingID, alloc := range in.Buildings {
		out.Buildings[buildingID] = alloc
	}
	return out
}

func cloneRayReceiverSettlementViews(in map[string]RayReceiverSettlementView) map[string]RayReceiverSettlementView {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]RayReceiverSettlementView, len(in))
	for buildingID, view := range in {
		out[buildingID] = view
	}
	return out
}

func clampPowerSnapshotEnergy(energy int) int {
	if energy < 0 {
		return 0
	}
	if energy > 10000 {
		return 10000
	}
	return energy
}

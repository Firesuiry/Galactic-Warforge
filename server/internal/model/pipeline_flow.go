package model

import "sort"

const maxPipelineCapacity = int(^uint(0) >> 1)

// PipelineFlowRule defines how flow is distributed across candidates.
type PipelineFlowRule int

const (
	PipelineFlowPriority PipelineFlowRule = iota
	PipelineFlowEqual
	PipelineFlowOverflow
)

// PipelineFlowOptions configures pipeline flow calculation.
type PipelineFlowOptions struct {
	SplitRule         PipelineFlowRule
	MergeRule         PipelineFlowRule
	EnableAttenuation bool
}

// PipelineFlowResult captures per-node and per-segment flow summaries.
type PipelineFlowResult struct {
	NodeInflow     map[string]int
	NodeOutflow    map[string]int
	SegmentInflow  map[string]int
	SegmentOutflow map[string]int
	SegmentLoss    map[string]int
}

// PipelineNodeCapacity returns the effective capacity for a pipeline node.
// A return value of 0 means unlimited capacity.
func PipelineNodeCapacity(state *PipelineNetworkState, graph *PipelineGraph, nodeID string) int {
	if state == nil || graph == nil || nodeID == "" {
		return 0
	}
	capacity := 0
	unlimited := false
	considerSegment := func(edge PipelineGraphEdge) {
		seg := state.Segments[edge.SegmentID]
		if seg == nil {
			return
		}
		if seg.Params.Capacity <= 0 {
			unlimited = true
			return
		}
		if seg.Params.Capacity > capacity {
			capacity = seg.Params.Capacity
		}
	}
	for _, edge := range graph.Edges[nodeID] {
		considerSegment(edge)
	}
	for _, edge := range graph.ReverseEdges[nodeID] {
		considerSegment(edge)
	}
	if !unlimited && capacity == 0 {
		for _, endpoint := range graph.EndpointsForNode(nodeID) {
			if endpoint.Capacity <= 0 {
				unlimited = true
				break
			}
			if endpoint.Capacity > capacity {
				capacity = endpoint.Capacity
			}
		}
	}
	if unlimited {
		return 0
	}
	return capacity
}

// PipelineAvailable returns remaining capacity for a node buffer.
func PipelineAvailable(capacity, buffer int) int {
	if capacity <= 0 {
		return maxPipelineCapacity
	}
	available := capacity - buffer
	if available < 0 {
		return 0
	}
	return available
}

// ResolvePipelineFlow moves fluids through pipeline segments and nodes.
// It mutates the provided pipeline state and returns flow summaries.
func ResolvePipelineFlow(state *PipelineNetworkState, graph *PipelineGraph, opts PipelineFlowOptions) PipelineFlowResult {
	result := PipelineFlowResult{
		NodeInflow:     make(map[string]int),
		NodeOutflow:    make(map[string]int),
		SegmentInflow:  make(map[string]int),
		SegmentOutflow: make(map[string]int),
		SegmentLoss:    make(map[string]int),
	}
	if state == nil || graph == nil {
		return result
	}
	opts = normalizePipelineFlowOptions(opts)

	for _, node := range state.Nodes {
		if node == nil {
			continue
		}
		if node.State.Buffer <= 0 {
			node.State.Buffer = 0
			node.State.FluidID = ""
		}
	}
	for _, seg := range state.Segments {
		if seg == nil {
			continue
		}
		if seg.State.Buffer <= 0 {
			seg.State.Buffer = 0
			seg.State.FluidID = ""
		}
		seg.State.CurrentFlow = 0
	}

	nodeIDs := sortedPipelineNodeIDs(state.Nodes)
	for _, nodeID := range nodeIDs {
		node := state.Nodes[nodeID]
		if node == nil {
			continue
		}
		incomingEdges := graph.ReverseEdges[nodeID]
		if len(incomingEdges) == 0 {
			continue
		}
		incoming := collectIncomingSegments(state, incomingEdges)
		if len(incoming) == 0 {
			continue
		}
		available := PipelineAvailable(PipelineNodeCapacity(state, graph, nodeID), node.State.Buffer)
		if available <= 0 {
			continue
		}
		fluidID := selectMergeFluid(node, incoming)
		if fluidID == "" {
			continue
		}
		candidates := filterMergeCandidates(incoming, fluidID)
		if len(candidates) == 0 {
			continue
		}
		acceptTotal := minInt(available, sumCandidateCapacity(candidates))
		if acceptTotal <= 0 {
			continue
		}
		allocations := allocateFlow(acceptTotal, candidates, opts.MergeRule)
		for _, candidate := range candidates {
			accepted := allocations[candidate.id]
			if accepted <= 0 {
				continue
			}
			seg := state.Segments[candidate.id]
			if seg == nil {
				continue
			}
			if accepted > seg.State.Buffer {
				accepted = seg.State.Buffer
			}
			seg.State.Buffer -= accepted
			if seg.State.Buffer == 0 {
				seg.State.FluidID = ""
			}
			delivered, loss := applyAttenuation(accepted, seg.Params.Attenuation, opts.EnableAttenuation)
			if delivered > 0 {
				node.State.Buffer += delivered
				if node.State.FluidID == "" {
					node.State.FluidID = fluidID
				}
				result.NodeInflow[nodeID] += delivered
			}
			if accepted > 0 {
				result.SegmentOutflow[candidate.id] += accepted
				if loss > 0 {
					result.SegmentLoss[candidate.id] += loss
				}
			}
		}
	}

	for _, nodeID := range nodeIDs {
		node := state.Nodes[nodeID]
		if node == nil || node.State.Buffer <= 0 || node.State.FluidID == "" {
			continue
		}
		outgoingEdges := graph.Edges[nodeID]
		if len(outgoingEdges) == 0 {
			continue
		}
		outgoing := collectOutgoingSegments(state, outgoingEdges, node.State.FluidID)
		if len(outgoing) == 0 {
			continue
		}
		sendTotal := minInt(node.State.Buffer, sumCandidateCapacity(outgoing))
		if sendTotal <= 0 {
			continue
		}
		allocations := allocateFlow(sendTotal, outgoing, opts.SplitRule)
		sent := 0
		for _, candidate := range outgoing {
			amount := allocations[candidate.id]
			if amount <= 0 {
				continue
			}
			seg := state.Segments[candidate.id]
			if seg == nil {
				continue
			}
			seg.State.Buffer += amount
			seg.State.FluidID = node.State.FluidID
			seg.State.CurrentFlow = amount
			result.SegmentInflow[candidate.id] += amount
			sent += amount
		}
		if sent > 0 {
			node.State.Buffer -= sent
			result.NodeOutflow[nodeID] += sent
			if node.State.Buffer <= 0 {
				node.State.Buffer = 0
				node.State.FluidID = ""
			}
		}
	}

	return result
}

type flowCandidate struct {
	id       string
	capacity int
	priority int
}

func normalizePipelineFlowOptions(opts PipelineFlowOptions) PipelineFlowOptions {
	if !opts.SplitRule.valid() {
		opts.SplitRule = PipelineFlowPriority
	}
	if !opts.MergeRule.valid() {
		opts.MergeRule = PipelineFlowPriority
	}
	return opts
}

func (r PipelineFlowRule) valid() bool {
	switch r {
	case PipelineFlowPriority, PipelineFlowEqual, PipelineFlowOverflow:
		return true
	default:
		return false
	}
}

func sortedPipelineNodeIDs(nodes map[string]*PipelineNode) []string {
	if len(nodes) == 0 {
		return nil
	}
	ids := make([]string, 0, len(nodes))
	for id := range nodes {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func collectIncomingSegments(state *PipelineNetworkState, incoming map[string]PipelineGraphEdge) []*PipelineSegment {
	segments := make([]*PipelineSegment, 0, len(incoming))
	for _, edge := range incoming {
		seg := state.Segments[edge.SegmentID]
		if seg == nil || seg.State.Buffer <= 0 || seg.State.FluidID == "" {
			continue
		}
		segments = append(segments, seg)
	}
	return segments
}

func collectOutgoingSegments(state *PipelineNetworkState, outgoing map[string]PipelineGraphEdge, fluidID string) []flowCandidate {
	if fluidID == "" {
		return nil
	}
	candidates := make([]flowCandidate, 0, len(outgoing))
	for _, edge := range outgoing {
		seg := state.Segments[edge.SegmentID]
		if seg == nil {
			continue
		}
		if seg.State.Buffer > 0 && seg.State.FluidID != "" && seg.State.FluidID != fluidID {
			continue
		}
		capacity := segmentInflowCapacity(seg)
		if capacity <= 0 {
			continue
		}
		candidates = append(candidates, flowCandidate{
			id:       edge.SegmentID,
			capacity: capacity,
			priority: segmentPriority(seg),
		})
	}
	return candidates
}

func selectMergeFluid(node *PipelineNode, incoming []*PipelineSegment) string {
	if node != nil && node.State.Buffer > 0 && node.State.FluidID != "" {
		return node.State.FluidID
	}
	if len(incoming) == 0 {
		return ""
	}
	bestFluid := ""
	bestPriority := -1
	for _, seg := range incoming {
		if seg == nil || seg.State.FluidID == "" || seg.State.Buffer <= 0 {
			continue
		}
		priority := segmentPriority(seg)
		if priority == 0 {
			priority = 1
		}
		if priority > bestPriority {
			bestPriority = priority
			bestFluid = seg.State.FluidID
			continue
		}
		if priority == bestPriority && bestFluid != "" && seg.State.FluidID < bestFluid {
			bestFluid = seg.State.FluidID
		}
	}
	return bestFluid
}

func filterMergeCandidates(incoming []*PipelineSegment, fluidID string) []flowCandidate {
	if fluidID == "" {
		return nil
	}
	candidates := make([]flowCandidate, 0, len(incoming))
	for _, seg := range incoming {
		if seg == nil || seg.State.Buffer <= 0 || seg.State.FluidID != fluidID {
			continue
		}
		capacity := seg.State.Buffer
		if capacity <= 0 {
			continue
		}
		candidates = append(candidates, flowCandidate{
			id:       seg.ID,
			capacity: capacity,
			priority: segmentPriority(seg),
		})
	}
	return candidates
}

func segmentPriority(seg *PipelineSegment) int {
	if seg == nil {
		return 0
	}
	if seg.Params.Pressure <= 0 {
		return 0
	}
	return seg.Params.Pressure
}

func segmentInflowCapacity(seg *PipelineSegment) int {
	if seg == nil {
		return 0
	}
	capacity := maxPipelineCapacity
	if seg.Params.Capacity > 0 {
		capacity = seg.Params.Capacity - seg.State.Buffer
	}
	if capacity < 0 {
		capacity = 0
	}
	if seg.Params.FlowRate > 0 && seg.Params.FlowRate < capacity {
		capacity = seg.Params.FlowRate
	}
	return capacity
}

func sumCandidateCapacity(candidates []flowCandidate) int {
	if len(candidates) == 0 {
		return 0
	}
	total := 0
	for _, candidate := range candidates {
		if candidate.capacity <= 0 {
			continue
		}
		if total > maxPipelineCapacity-candidate.capacity {
			return maxPipelineCapacity
		}
		total += candidate.capacity
	}
	return total
}

func allocateFlow(amount int, candidates []flowCandidate, rule PipelineFlowRule) map[string]int {
	allocations := make(map[string]int, len(candidates))
	if amount <= 0 || len(candidates) == 0 {
		return allocations
	}
	usable := make([]flowCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.capacity <= 0 {
			continue
		}
		usable = append(usable, candidate)
	}
	if len(usable) == 0 {
		return allocations
	}
	switch rule {
	case PipelineFlowOverflow:
		return allocateOverflow(amount, usable)
	case PipelineFlowEqual:
		return allocateEqual(amount, usable)
	default:
		return allocatePriority(amount, usable)
	}
}

func allocateOverflow(amount int, candidates []flowCandidate) map[string]int {
	allocations := make(map[string]int, len(candidates))
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].priority != candidates[j].priority {
			return candidates[i].priority > candidates[j].priority
		}
		return candidates[i].id < candidates[j].id
	})
	remaining := amount
	for _, candidate := range candidates {
		if remaining <= 0 {
			break
		}
		if candidate.capacity <= 0 {
			continue
		}
		qty := candidate.capacity
		if qty > remaining {
			qty = remaining
		}
		allocations[candidate.id] = qty
		remaining -= qty
	}
	return allocations
}

func allocateEqual(amount int, candidates []flowCandidate) map[string]int {
	allocations := make(map[string]int, len(candidates))
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].id < candidates[j].id
	})
	remaining := amount
	active := append([]flowCandidate(nil), candidates...)
	for remaining > 0 && len(active) > 0 {
		share := remaining / len(active)
		if share == 0 {
			progress := false
			for i := 0; i < len(active) && remaining > 0; i++ {
				if active[i].capacity <= 0 {
					continue
				}
				allocations[active[i].id]++
				active[i].capacity--
				remaining--
				progress = true
			}
			if !progress {
				break
			}
		} else {
			for i := range active {
				if remaining <= 0 {
					break
				}
				if active[i].capacity <= 0 {
					continue
				}
				qty := share
				if qty > active[i].capacity {
					qty = active[i].capacity
				}
				allocations[active[i].id] += qty
				active[i].capacity -= qty
				remaining -= qty
			}
		}
		filtered := active[:0]
		for _, candidate := range active {
			if candidate.capacity > 0 {
				filtered = append(filtered, candidate)
			}
		}
		active = filtered
	}
	return allocations
}

func allocatePriority(amount int, candidates []flowCandidate) map[string]int {
	weightSum := 0
	for _, candidate := range candidates {
		if candidate.priority > 0 {
			weightSum += candidate.priority
		}
	}
	if weightSum <= 0 {
		return allocateEqual(amount, candidates)
	}
	allocations := make(map[string]int, len(candidates))
	remaining := amount
	for i := range candidates {
		weight := candidates[i].priority
		if weight <= 0 {
			continue
		}
		qty := int((int64(amount) * int64(weight)) / int64(weightSum))
		if qty > candidates[i].capacity {
			qty = candidates[i].capacity
		}
		if qty <= 0 {
			continue
		}
		allocations[candidates[i].id] = qty
		candidates[i].capacity -= qty
		remaining -= qty
	}
	if remaining <= 0 {
		return allocations
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].priority != candidates[j].priority {
			return candidates[i].priority > candidates[j].priority
		}
		return candidates[i].id < candidates[j].id
	})
	for remaining > 0 {
		progress := false
		for i := 0; i < len(candidates) && remaining > 0; i++ {
			if candidates[i].capacity <= 0 {
				continue
			}
			allocations[candidates[i].id]++
			candidates[i].capacity--
			remaining--
			progress = true
		}
		if !progress {
			break
		}
	}
	return allocations
}

func applyAttenuation(qty int, attenuation float64, enabled bool) (int, int) {
	if qty <= 0 {
		return 0, 0
	}
	if !enabled {
		return qty, 0
	}
	if attenuation <= 0 {
		return qty, 0
	}
	if attenuation >= 1 {
		return 0, qty
	}
	received := int(float64(qty) * (1 - attenuation))
	if received < 0 {
		received = 0
	}
	if received > qty {
		received = qty
	}
	return received, qty - received
}

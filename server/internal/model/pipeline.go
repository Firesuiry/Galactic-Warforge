package model

// PipelineSegmentParams defines static parameters for a pipeline segment.
type PipelineSegmentParams struct {
	FlowRate    int     `json:"flow_rate"`
	Pressure    int     `json:"pressure"`
	Capacity    int     `json:"capacity"`
	Attenuation float64 `json:"attenuation,omitempty"`
}

// PipelineSegmentState captures runtime state for a pipeline segment.
type PipelineSegmentState struct {
	CurrentFlow int    `json:"current_flow"`
	Buffer      int    `json:"buffer"`
	Pressure    int    `json:"pressure"`
	FluidID     string `json:"fluid_id,omitempty"`
}

// PipelineNodeState captures runtime state for a pipeline node.
type PipelineNodeState struct {
	Buffer   int    `json:"buffer"`
	Pressure int    `json:"pressure"`
	FluidID  string `json:"fluid_id,omitempty"`
}

// PipelineNode represents a connection node in the pipeline network.
type PipelineNode struct {
	ID       string            `json:"id"`
	Position Position          `json:"position"`
	State    PipelineNodeState `json:"state"`
}

// PipelineSegment represents a directed pipeline segment between nodes.
type PipelineSegment struct {
	ID     string                `json:"id"`
	From   string                `json:"from"`
	To     string                `json:"to"`
	Params PipelineSegmentParams `json:"params"`
	State  PipelineSegmentState  `json:"state"`
}

// PipelineNetworkState stores nodes and segments for fluid routing.
type PipelineNetworkState struct {
	Nodes    map[string]*PipelineNode    `json:"nodes,omitempty"`
	Segments map[string]*PipelineSegment `json:"segments,omitempty"`
}

// NewPipelineNetworkState creates an empty pipeline state container.
func NewPipelineNetworkState() *PipelineNetworkState {
	return &PipelineNetworkState{
		Nodes:    make(map[string]*PipelineNode),
		Segments: make(map[string]*PipelineSegment),
	}
}

// Clone returns a deep copy of the pipeline network state.
func (p *PipelineNetworkState) Clone() *PipelineNetworkState {
	if p == nil {
		return nil
	}
	out := &PipelineNetworkState{}
	if len(p.Nodes) > 0 {
		out.Nodes = make(map[string]*PipelineNode, len(p.Nodes))
		for id, node := range p.Nodes {
			if node == nil {
				out.Nodes[id] = nil
				continue
			}
			copyNode := *node
			copyNode.State = node.State
			copyNode.Position = node.Position
			out.Nodes[id] = &copyNode
		}
	}
	if len(p.Segments) > 0 {
		out.Segments = make(map[string]*PipelineSegment, len(p.Segments))
		for id, seg := range p.Segments {
			if seg == nil {
				out.Segments[id] = nil
				continue
			}
			copySeg := *seg
			copySeg.Params = seg.Params
			copySeg.State = seg.State
			out.Segments[id] = &copySeg
		}
	}
	return out
}

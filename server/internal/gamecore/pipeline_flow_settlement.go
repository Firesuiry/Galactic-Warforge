package gamecore

import "siliconworld/internal/model"

func settlePipelineFlow(ws *model.WorldState) {
	if ws == nil || ws.Pipelines == nil {
		return
	}
	endpoints := model.PipelineEndpointsFromWorld(ws, isPipelineEndpoint)
	graph := model.BuildPipelineGraph(ws.Pipelines, endpoints)
	if graph == nil {
		return
	}
	opts := model.PipelineFlowOptions{
		EnableAttenuation: pipelineHasAttenuation(ws.Pipelines),
	}
	model.ResolvePipelineFlow(ws.Pipelines, graph, opts)
}

func pipelineHasAttenuation(state *model.PipelineNetworkState) bool {
	if state == nil || len(state.Segments) == 0 {
		return false
	}
	for _, seg := range state.Segments {
		if seg == nil {
			continue
		}
		if seg.Params.Attenuation > 0 {
			return true
		}
	}
	return false
}

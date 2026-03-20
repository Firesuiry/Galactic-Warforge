package gamecore

import "siliconworld/internal/model"

func storageNetworkFor(ws *model.WorldState, startID string) model.StorageNetwork {
	if ws == nil || startID == "" {
		return model.StorageNetwork{}
	}
	start := ws.Buildings[startID]
	if start == nil || start.Storage == nil {
		return model.StorageNetwork{}
	}
	owner := start.OwnerID
	visited := map[string]struct{}{startID: {}}
	queue := []string{startID}
	nodes := make([]model.StorageNode, 0)

	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		building := ws.Buildings[id]
		if building == nil || building.Storage == nil || building.OwnerID != owner {
			continue
		}
		nodes = append(nodes, model.StorageNode{ID: building.ID, Storage: building.Storage})

		pos := building.Position
		neighbors := []model.Position{
			{X: pos.X - 1, Y: pos.Y},
			{X: pos.X + 1, Y: pos.Y},
			{X: pos.X, Y: pos.Y - 1},
			{X: pos.X, Y: pos.Y + 1},
		}
		for _, npos := range neighbors {
			if !ws.InBounds(npos.X, npos.Y) {
				continue
			}
			tileKey := model.TileKey(npos.X, npos.Y)
			neighborID, ok := ws.TileBuilding[tileKey]
			if !ok || neighborID == "" {
				continue
			}
			if _, seen := visited[neighborID]; seen {
				continue
			}
			visited[neighborID] = struct{}{}
			queue = append(queue, neighborID)
		}
	}

	return model.StorageNetwork{Nodes: nodes}
}

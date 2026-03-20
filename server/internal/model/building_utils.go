package model

import "sort"

// sortedBuildingIDsByPosition returns building IDs ordered by position then ID.
func sortedBuildingIDsByPosition(ws *WorldState) []string {
	if ws == nil || len(ws.Buildings) == 0 {
		return nil
	}
	ids := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool {
		a := ws.Buildings[ids[i]]
		b := ws.Buildings[ids[j]]
		if a == nil || b == nil {
			return ids[i] < ids[j]
		}
		if a.Position.Y == b.Position.Y {
			if a.Position.X == b.Position.X {
				return a.ID < b.ID
			}
			return a.Position.X < b.Position.X
		}
		return a.Position.Y < b.Position.Y
	})
	return ids
}

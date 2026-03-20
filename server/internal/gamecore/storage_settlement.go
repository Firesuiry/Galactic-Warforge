package gamecore

import "siliconworld/internal/model"

func settleStorage(ws *model.WorldState) {
	if ws == nil {
		return
	}
	for _, building := range ws.Buildings {
		if building == nil || building.Storage == nil {
			continue
		}
		building.Storage.Tick()
	}
}

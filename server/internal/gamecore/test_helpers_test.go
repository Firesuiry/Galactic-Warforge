package gamecore

import "siliconworld/internal/model"

func grantTechs(ws *model.WorldState, playerID string, techIDs ...string) {
	if ws == nil {
		return
	}
	player := ws.Players[playerID]
	if player == nil {
		return
	}
	if player.Tech == nil {
		player.Tech = model.NewPlayerTechState(playerID)
	}
	for _, techID := range techIDs {
		if techID == "" {
			continue
		}
		player.Tech.CompletedTechs[techID] = 1
	}
}

func grantAllTechs(ws *model.WorldState, playerIDs ...string) {
	for _, playerID := range playerIDs {
		for _, def := range model.AllTechDefinitions() {
			if def == nil {
				continue
			}
			grantTechs(ws, playerID, def.ID)
		}
	}
}

// grantAllItems stocks the player inventory with qty of every catalog item,
// covering the item portion of building costs introduced by the DSP
// building-cost alignment so construction-focused tests can place buildings
// without replaying the full production chain.
func grantAllItems(ws *model.WorldState, playerID string, qty int) {
	if ws == nil {
		return
	}
	player := ws.Players[playerID]
	if player == nil {
		return
	}
	if player.Inventory == nil {
		player.Inventory = map[string]int{}
	}
	for _, def := range model.AllItems() {
		player.Inventory[def.ID] += qty
	}
}

// grantItems stocks specific items, for tests that pin a fresh-game inventory
// and only need the building components their builds consume.
func grantItems(ws *model.WorldState, playerID string, items ...model.ItemAmount) {
	if ws == nil {
		return
	}
	player := ws.Players[playerID]
	if player == nil {
		return
	}
	for _, item := range items {
		player.EnsureInventory()[item.ItemID] += item.Quantity
	}
}

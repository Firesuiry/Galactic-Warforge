package gamecore

import "siliconworld/internal/model"

type buildingInputCandidate struct {
	order    int
	buffer   int
	dir      model.ConveyorDirection
	conveyor *model.Building
	itemID   string
	quantity int
}

func buildingRecipe(building *model.Building) (model.RecipeDefinition, bool) {
	if building == nil || building.Production == nil || building.Production.RecipeID == "" {
		return model.RecipeDefinition{}, false
	}
	return model.Recipe(building.Production.RecipeID)
}

func buildingRecipeInputNeeds(building *model.Building) map[string]int {
	recipe, ok := buildingRecipe(building)
	if !ok {
		return nil
	}
	needs := make(map[string]int, len(recipe.Inputs))
	for _, input := range recipe.Inputs {
		if input.ItemID == "" || input.Quantity <= 0 {
			continue
		}
		needs[input.ItemID] += input.Quantity
	}
	if len(needs) == 0 {
		return nil
	}
	return needs
}

func buildingRecipeOutputItems(building *model.Building) []string {
	recipe, ok := buildingRecipe(building)
	if !ok {
		return nil
	}
	items := make([]string, 0, len(recipe.Outputs)+len(recipe.Byproducts))
	for _, output := range recipe.Outputs {
		if output.ItemID == "" {
			continue
		}
		items = append(items, output.ItemID)
	}
	for _, byproduct := range recipe.Byproducts {
		if byproduct.ItemID == "" {
			continue
		}
		items = append(items, byproduct.ItemID)
	}
	return dedupeItemIDs(items)
}

func buildingRecipePrimaryOutputItems(building *model.Building) []string {
	recipe, ok := buildingRecipe(building)
	if !ok {
		return nil
	}
	items := make([]string, 0, len(recipe.Outputs))
	for _, output := range recipe.Outputs {
		if output.ItemID == "" {
			continue
		}
		items = append(items, output.ItemID)
	}
	return dedupeItemIDs(items)
}

func buildingRecipeByproductItems(building *model.Building) []string {
	recipe, ok := buildingRecipe(building)
	if !ok {
		return nil
	}
	items := make([]string, 0, len(recipe.Byproducts))
	for _, output := range recipe.Byproducts {
		if output.ItemID == "" {
			continue
		}
		items = append(items, output.ItemID)
	}
	return dedupeItemIDs(items)
}

func buildingOutputAllowList(building *model.Building, port *model.IOPort) []string {
	if port != nil && len(port.AllowedItems) > 0 {
		return dedupeItemIDs(port.AllowedItems)
	}
	if building == nil {
		return nil
	}
	items := make([]string, 0)
	for _, candidate := range buildingRecipeOutputItems(building) {
		items = append(items, candidate)
	}
	for _, candidate := range outputPortAllowedItems(building) {
		items = append(items, candidate)
	}
	return dedupeItemIDs(items)
}

func buildingDirectionalOutputAllowList(building *model.Building, port *model.IOPort, dir model.ConveyorDirection) []string {
	allowed := buildingOutputAllowList(building, port)
	if len(allowed) == 0 {
		return nil
	}

	byproducts := buildingRecipeByproductItems(building)
	if len(byproducts) == 0 {
		return allowed
	}

	if isByproductOutputPort(port) {
		return intersectItemIDs(allowed, byproducts)
	}

	byproductSet := itemIDSet(byproducts)
	primaryAndGeneric := excludeItemIDs(allowed, byproductSet)
	if isMainOutputPort(port) {
		return primaryAndGeneric
	}
	if dir == model.ConveyorNorth {
		return primaryAndGeneric
	}

	items := append([]string(nil), intersectItemIDs(allowed, byproducts)...)
	items = append(items, primaryAndGeneric...)
	return dedupeItemIDs(items)
}

func outputPortAllowedItems(building *model.Building) []string {
	if building == nil {
		return nil
	}
	items := make([]string, 0)
	for _, port := range building.Runtime.Params.IOPorts {
		if port.Direction != model.PortOutput && port.Direction != model.PortBoth {
			continue
		}
		items = append(items, port.AllowedItems...)
	}
	return dedupeItemIDs(items)
}

func dedupeItemIDs(items []string) []string {
	if len(items) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(items))
	out := make([]string, 0, len(items))
	for _, itemID := range items {
		if itemID == "" {
			continue
		}
		if _, ok := seen[itemID]; ok {
			continue
		}
		seen[itemID] = struct{}{}
		out = append(out, itemID)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func isMainOutputPort(port *model.IOPort) bool {
	return port != nil && port.ID == "out-main"
}

func isByproductOutputPort(port *model.IOPort) bool {
	return port != nil && port.ID == "out-side"
}

func itemIDSet(items []string) map[string]struct{} {
	if len(items) == 0 {
		return nil
	}
	out := make(map[string]struct{}, len(items))
	for _, itemID := range items {
		if itemID == "" {
			continue
		}
		out[itemID] = struct{}{}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func excludeItemIDs(items []string, excluded map[string]struct{}) []string {
	if len(items) == 0 {
		return nil
	}
	if len(excluded) == 0 {
		return dedupeItemIDs(items)
	}
	out := make([]string, 0, len(items))
	for _, itemID := range items {
		if itemID == "" {
			continue
		}
		if _, ok := excluded[itemID]; ok {
			continue
		}
		out = append(out, itemID)
	}
	return dedupeItemIDs(out)
}

func intersectItemIDs(items, allowed []string) []string {
	if len(items) == 0 || len(allowed) == 0 {
		return nil
	}
	allowedSet := itemIDSet(allowed)
	if len(allowedSet) == 0 {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, itemID := range items {
		if itemID == "" {
			continue
		}
		if _, ok := allowedSet[itemID]; !ok {
			continue
		}
		out = append(out, itemID)
	}
	return dedupeItemIDs(out)
}

func ioPortAllowsItem(port model.IOPort, itemID string) bool {
	if itemID == "" {
		return false
	}
	if len(port.AllowedItems) == 0 {
		return true
	}
	for _, allowed := range port.AllowedItems {
		if allowed == itemID {
			return true
		}
	}
	return false
}

func compareInputCandidates(building *model.Building, a, b buildingInputCandidate) bool {
	needs := buildingRecipeInputNeeds(building)
	if len(needs) == 0 {
		return a.order < b.order
	}

	requiredA, okA := needs[a.itemID]
	requiredB, okB := needs[b.itemID]
	if okA != okB {
		return okA
	}
	if !okA {
		return a.order < b.order
	}

	currentA := currentProductionInputQuantity(building, a.itemID)
	currentB := currentProductionInputQuantity(building, b.itemID)

	left := currentA * requiredB
	right := currentB * requiredA
	if left != right {
		return left < right
	}
	if currentA != currentB {
		return currentA < currentB
	}
	return a.order < b.order
}

func currentProductionInputQuantity(building *model.Building, itemID string) int {
	if building == nil || building.Storage == nil || itemID == "" {
		return 0
	}
	return currentStorageItem(building.Storage.InputBuffer, itemID) + currentStorageItem(building.Storage.Inventory, itemID)
}

func refillBuildingOutputBuffer(building *model.Building) {
	if building == nil || building.Storage == nil {
		return
	}
	allowed := buildingOutputAllowList(building, nil)
	if len(allowed) == 0 {
		building.Storage.RefillOutput()
		return
	}

	allowedSet := make(map[string]struct{}, len(allowed))
	for _, itemID := range allowed {
		allowedSet[itemID] = struct{}{}
	}
	sanitizeOutputBuffer(building.Storage, allowedSet)
	refillAllowedOutputBuffer(building.Storage, allowed)
}

func sanitizeOutputBuffer(storage *model.StorageState, allowed map[string]struct{}) {
	if storage == nil || len(allowed) == 0 || storage.OutputBuffer == nil {
		return
	}
	inventory := storage.EnsureInventory()
	for itemID, qty := range storage.OutputBuffer {
		if qty <= 0 {
			delete(storage.OutputBuffer, itemID)
			continue
		}
		if _, ok := allowed[itemID]; ok {
			continue
		}
		inventory[itemID] += qty
		delete(storage.OutputBuffer, itemID)
	}
}

func refillAllowedOutputBuffer(storage *model.StorageState, allowed []string) int {
	if storage == nil || len(allowed) == 0 {
		return 0
	}
	outCap := storage.OutputBufferCapacity()
	if outCap <= 0 {
		return 0
	}
	available := outCap - storage.UsedOutputBuffer()
	if available <= 0 {
		return 0
	}
	inventory := storage.EnsureInventory()
	output := storage.EnsureOutputBuffer()
	moved := 0
	for _, itemID := range allowed {
		if available <= 0 {
			break
		}
		qty := inventory[itemID]
		if qty <= 0 {
			continue
		}
		take := minInt(qty, available)
		output[itemID] += take
		inventory[itemID] -= take
		if inventory[itemID] <= 0 {
			delete(inventory, itemID)
		}
		moved += take
		available -= take
	}
	return moved
}

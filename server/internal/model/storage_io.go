package model

import "fmt"

// StoragePortInput inserts items into a building storage via a specific IO port.
func StoragePortInput(building *Building, portID, itemID string, qty int) (int, int, error) {
	if building == nil {
		return 0, qty, fmt.Errorf("building required")
	}
	if building.Storage == nil {
		return 0, qty, fmt.Errorf("storage not available")
	}
	port, ok := findIOPort(building.Runtime.Params.IOPorts, portID)
	if !ok {
		return 0, qty, fmt.Errorf("io port %s not found", portID)
	}
	if port.Direction != PortInput && port.Direction != PortBoth {
		return 0, qty, fmt.Errorf("io port %s is not input", portID)
	}
	if !portAllowsItem(port, itemID) {
		return 0, qty, fmt.Errorf("item %s not allowed on port %s", itemID, portID)
	}
	requested := qty
	limit := applyPortCapacity(port, qty)
	limit = applyProductionInputLimit(building, itemID, limit)
	if limit <= 0 {
		return 0, requested, nil
	}
	accepted, remaining, err := building.Storage.Receive(itemID, limit)
	if err != nil {
		return 0, qty, err
	}
	remaining += requested - limit
	return accepted, remaining, nil
}

// StoragePortPreviewInput calculates accepted quantities without mutating storage.
func StoragePortPreviewInput(building *Building, portID, itemID string, qty int) (int, int, error) {
	if building == nil {
		return 0, qty, fmt.Errorf("building required")
	}
	if building.Storage == nil {
		return 0, qty, fmt.Errorf("storage not available")
	}
	port, ok := findIOPort(building.Runtime.Params.IOPorts, portID)
	if !ok {
		return 0, qty, fmt.Errorf("io port %s not found", portID)
	}
	if port.Direction != PortInput && port.Direction != PortBoth {
		return 0, qty, fmt.Errorf("io port %s is not input", portID)
	}
	if !portAllowsItem(port, itemID) {
		return 0, qty, fmt.Errorf("item %s not allowed on port %s", itemID, portID)
	}
	requested := qty
	limit := applyPortCapacity(port, qty)
	limit = applyProductionInputLimit(building, itemID, limit)
	if limit <= 0 {
		return 0, requested, nil
	}
	accepted, remaining, err := building.Storage.PreviewReceive(itemID, limit)
	if err != nil {
		return 0, qty, err
	}
	remaining += requested - limit
	return accepted, remaining, nil
}

// StoragePortOutput extracts items from a building storage via a specific IO port.
func StoragePortOutput(building *Building, portID, itemID string, qty int) (int, int, error) {
	if building == nil {
		return 0, qty, fmt.Errorf("building required")
	}
	if building.Storage == nil {
		return 0, qty, fmt.Errorf("storage not available")
	}
	port, ok := findIOPort(building.Runtime.Params.IOPorts, portID)
	if !ok {
		return 0, qty, fmt.Errorf("io port %s not found", portID)
	}
	if port.Direction != PortOutput && port.Direction != PortBoth {
		return 0, qty, fmt.Errorf("io port %s is not output", portID)
	}
	if !portAllowsItem(port, itemID) {
		return 0, qty, fmt.Errorf("item %s not allowed on port %s", itemID, portID)
	}
	requested := qty
	limit := applyPortCapacity(port, qty)
	provided, remaining, err := building.Storage.Provide(itemID, limit)
	if err != nil {
		return 0, qty, err
	}
	remaining += requested - limit
	return provided, remaining, nil
}

func findIOPort(ports []IOPort, portID string) (IOPort, bool) {
	for _, port := range ports {
		if port.ID == portID {
			return port, true
		}
	}
	return IOPort{}, false
}

func portAllowsItem(port IOPort, itemID string) bool {
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

func applyPortCapacity(port IOPort, qty int) int {
	if qty <= 0 {
		return 0
	}
	if port.Capacity <= 0 {
		return qty
	}
	if qty > port.Capacity {
		return port.Capacity
	}
	return qty
}

func applyProductionInputLimit(building *Building, itemID string, qty int) int {
	if building == nil || building.Storage == nil || qty <= 0 {
		return qty
	}
	if building.Runtime.Functions.Production == nil || building.Production == nil || building.Production.RecipeID == "" {
		return qty
	}
	recipe, ok := Recipe(building.Production.RecipeID)
	if !ok {
		return qty
	}

	required := 0
	for _, input := range recipe.Inputs {
		if input.ItemID == itemID {
			required += input.Quantity
		}
	}
	if required <= 0 {
		return 0
	}

	window := productionInputWindow(building)
	maxBuffered := required * window
	current := storageItemQuantity(building.Storage.InputBuffer, itemID) + storageItemQuantity(building.Storage.Inventory, itemID)
	if current >= maxBuffered {
		return 0
	}
	remaining := maxBuffered - current
	if qty > remaining {
		return remaining
	}
	return qty
}

func productionInputWindow(building *Building) int {
	window := 2
	if building == nil || building.Runtime.Functions.Production == nil {
		return window
	}
	if throughput := building.Runtime.Functions.Production.Throughput; throughput > window {
		return throughput
	}
	return window
}

func storageItemQuantity(inv ItemInventory, itemID string) int {
	if inv == nil || itemID == "" {
		return 0
	}
	if qty := inv[itemID]; qty > 0 {
		return qty
	}
	return 0
}

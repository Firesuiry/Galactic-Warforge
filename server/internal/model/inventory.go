package model

// ItemInventory stores item quantities by item id.
type ItemInventory map[string]int

// Clone returns a deep copy of the inventory.
func (inv ItemInventory) Clone() ItemInventory {
	if len(inv) == 0 {
		return nil
	}
	out := make(ItemInventory, len(inv))
	for id, qty := range inv {
		if qty <= 0 {
			continue
		}
		out[id] = qty
	}
	return out
}

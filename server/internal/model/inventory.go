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

// Ensure returns a writable inventory map (allocating it when nil).
func (inv *ItemInventory) Ensure() ItemInventory {
	if *inv == nil {
		*inv = make(ItemInventory)
	}
	return *inv
}

// HasItems checks whether the inventory holds the required item amounts.
func (inv ItemInventory) HasItems(cost []ItemAmount) bool {
	if len(cost) == 0 {
		return true
	}
	for _, item := range cost {
		if item.Quantity <= 0 {
			continue
		}
		if inv[item.ItemID] < item.Quantity {
			return false
		}
	}
	return true
}

// DeductItems removes item amounts from the inventory if possible.
func (inv ItemInventory) DeductItems(cost []ItemAmount) bool {
	if len(cost) == 0 {
		return true
	}
	if !inv.HasItems(cost) {
		return false
	}
	for _, item := range cost {
		if item.Quantity <= 0 {
			continue
		}
		inv[item.ItemID] -= item.Quantity
		if inv[item.ItemID] <= 0 {
			delete(inv, item.ItemID)
		}
	}
	return true
}

// Count returns how many items the inventory holds in total.
func (inv ItemInventory) Count() int {
	total := 0
	for _, qty := range inv {
		total += qty
	}
	return total
}

// SlotsUsed 返回背包占用的格数：每种物品占 ceil(数量/该物品的单格上限) 格，
// 再把各物品相加（DSP 机甲背包口径：格子数 + 每格按物品的堆叠上限）。
// 单格上限取 items.yaml 的 stack_limit；目录里查不到的物品按 1 格算（宁可多占）。
func (inv ItemInventory) SlotsUsed() int {
	slots := 0
	for id, qty := range inv {
		if qty <= 0 {
			continue
		}
		slots += ItemSlots(id, qty)
	}
	return slots
}

// AddItems adds item amounts and returns how many were accepted.
// slots > 0 是背包格数上限：按每件物品的 stack_limit 折算占格，装不下的部分
// 直接丢弃，任何调用方都不可能把背包顶到上限之上。slots <= 0 表示不限。
func (inv ItemInventory) AddItems(items []ItemAmount, slots int) int {
	if len(items) == 0 {
		return 0
	}
	accepted := 0
	for _, item := range items {
		if item.Quantity <= 0 {
			continue
		}
		add := item.Quantity
		if slots > 0 {
			add = min(add, inv.FreeSlotsFor(item.ItemID, slots))
			if add <= 0 {
				continue
			}
		}
		inv[item.ItemID] += add
		accepted += add
	}
	return accepted
}

// FreeSlotsFor 返回在 slots 格上限下还能再装下多少件 itemID：
// 已有该物品时先用满当前那格剩余的堆叠空间，再按整格上限算剩余格数。
// slots <= 0 表示不限，返回 maxInt。
func (inv ItemInventory) FreeSlotsFor(itemID string, slots int) int {
	if slots <= 0 {
		return maxInt
	}
	free := slots - inv.SlotsUsed()
	if free < 0 {
		free = 0
	}
	have := inv[itemID]
	room := 0
	if def, ok := Item(itemID); ok && def.StackLimit > 0 && have > 0 {
		room = def.StackLimit - have%def.StackLimit
		if room == def.StackLimit {
			room = 0
		}
	}
	return room + free*stackSize(itemID)
}

// ItemSlots 返回 qty 件该物品占用的背包格数（向上取整到 stack_limit）。
func ItemSlots(itemID string, qty int) int {
	if qty <= 0 {
		return 0
	}
	def, ok := Item(itemID)
	if !ok || def.StackLimit <= 0 {
		return qty
	}
	return (qty + def.StackLimit - 1) / def.StackLimit
}

// ItemStackSize 返回该物品单格可堆叠的数量（items.yaml 的 stack_limit；
// 目录缺失时按 1）。
func ItemStackSize(itemID string) int {
	if def, ok := Item(itemID); ok && def.StackLimit > 0 {
		return def.StackLimit
	}
	return 1
}

func stackSize(itemID string) int { return ItemStackSize(itemID) }

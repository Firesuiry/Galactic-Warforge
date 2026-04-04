package model

import (
	"fmt"
	"sort"
)

// StoragePriority configures input/output bias for storage buffers.
type StoragePriority struct {
	Input  int `json:"input" yaml:"input"`
	Output int `json:"output" yaml:"output"`
}

// StorageState tracks the storage inventory and IO buffers.
type StorageState struct {
	Capacity       int             `json:"capacity"`
	Slots          int             `json:"slots"`
	BufferCapacity int             `json:"buffer_capacity"`
	Priority       StoragePriority `json:"priority"`
	Inventory      ItemInventory   `json:"inventory,omitempty"`
	InputBuffer    ItemInventory   `json:"input_buffer,omitempty"`
	OutputBuffer   ItemInventory   `json:"output_buffer,omitempty"`
}

// NewStorageState initializes a storage state from a storage module definition.
func NewStorageState(module StorageModule) *StorageState {
	state := &StorageState{
		Capacity:       module.Capacity,
		Slots:          module.Slots,
		BufferCapacity: module.Buffer,
		Priority: StoragePriority{
			Input:  module.InputPriority,
			Output: module.OutputPriority,
		},
	}
	state.normalize()
	return state
}

// Clone returns a deep copy of the storage state.
func (s *StorageState) Clone() *StorageState {
	if s == nil {
		return nil
	}
	out := *s
	out.Inventory = s.Inventory.Clone()
	out.InputBuffer = s.InputBuffer.Clone()
	out.OutputBuffer = s.OutputBuffer.Clone()
	return &out
}

// EnsureInventory returns a writable inventory map.
func (s *StorageState) EnsureInventory() ItemInventory {
	if s == nil {
		return nil
	}
	if s.Inventory == nil {
		s.Inventory = make(ItemInventory)
	}
	return s.Inventory
}

// EnsureInputBuffer returns a writable input buffer map.
func (s *StorageState) EnsureInputBuffer() ItemInventory {
	if s == nil {
		return nil
	}
	if s.InputBuffer == nil {
		s.InputBuffer = make(ItemInventory)
	}
	return s.InputBuffer
}

// EnsureOutputBuffer returns a writable output buffer map.
func (s *StorageState) EnsureOutputBuffer() ItemInventory {
	if s == nil {
		return nil
	}
	if s.OutputBuffer == nil {
		s.OutputBuffer = make(ItemInventory)
	}
	return s.OutputBuffer
}

// InputBufferCapacity returns the computed input buffer capacity.
func (s *StorageState) InputBufferCapacity() int {
	in, _ := s.bufferCaps()
	return in
}

// OutputBufferCapacity returns the computed output buffer capacity.
func (s *StorageState) OutputBufferCapacity() int {
	_, out := s.bufferCaps()
	return out
}

// UsedInventory returns total quantity in the main inventory.
func (s *StorageState) UsedInventory() int {
	return inventoryQty(s.Inventory)
}

// UsedInputBuffer returns total quantity in the input buffer.
func (s *StorageState) UsedInputBuffer() int {
	return inventoryQty(s.InputBuffer)
}

// UsedOutputBuffer returns total quantity in the output buffer.
func (s *StorageState) UsedOutputBuffer() int {
	return inventoryQty(s.OutputBuffer)
}

// DistinctItems returns the number of distinct item ids held.
func (s *StorageState) DistinctItems() int {
	return distinctItems(s.Inventory, s.InputBuffer, s.OutputBuffer)
}

// Receive accepts items into storage buffers/inventory and returns accepted and remaining quantities.
func (s *StorageState) Receive(itemID string, qty int) (int, int, error) {
	if s == nil {
		return 0, qty, fmt.Errorf("storage required")
	}
	if err := validateItemQuantity(itemID, qty); err != nil {
		return 0, qty, err
	}
	if !s.canAcceptNewItem(itemID) {
		return 0, qty, nil
	}

	accepted := 0
	remaining := qty

	inCap := s.InputBufferCapacity()
	if inCap > 0 {
		available := inCap - s.UsedInputBuffer()
		if available > 0 {
			take := minInt(available, remaining)
			if take > 0 {
				addToInventory(s.EnsureInputBuffer(), itemID, take)
				accepted += take
				remaining -= take
			}
		}
	}

	if remaining > 0 {
		available := s.availableInventory()
		if available > 0 {
			take := minInt(available, remaining)
			if take > 0 {
				addToInventory(s.EnsureInventory(), itemID, take)
				accepted += take
				remaining -= take
			}
		}
	}

	return accepted, remaining, nil
}

// PreviewReceive calculates how many items would be accepted without mutating state.
func (s *StorageState) PreviewReceive(itemID string, qty int) (int, int, error) {
	if s == nil {
		return 0, qty, fmt.Errorf("storage required")
	}
	if err := validateItemQuantity(itemID, qty); err != nil {
		return 0, qty, err
	}
	if !s.canAcceptNewItem(itemID) {
		return 0, qty, nil
	}

	accepted := 0
	remaining := qty

	inCap := s.InputBufferCapacity()
	if inCap > 0 {
		available := inCap - s.UsedInputBuffer()
		if available > 0 {
			take := minInt(available, remaining)
			if take > 0 {
				accepted += take
				remaining -= take
			}
		}
	}

	if remaining > 0 {
		available := s.availableInventory()
		if available > 0 {
			take := minInt(available, remaining)
			if take > 0 {
				accepted += take
				remaining -= take
			}
		}
	}

	return accepted, remaining, nil
}

// Load stores player-delivered items directly into local storage so they can be
// consumed immediately by building logic such as production or launch.
func (s *StorageState) Load(itemID string, qty int) (int, int, error) {
	if s == nil {
		return 0, qty, fmt.Errorf("storage required")
	}
	if err := validateItemQuantity(itemID, qty); err != nil {
		return 0, qty, err
	}
	if !s.canAcceptNewItem(itemID) {
		return 0, qty, nil
	}

	accepted := 0
	remaining := qty

	if remaining > 0 {
		available := s.availableInventory()
		if available > 0 {
			take := minInt(available, remaining)
			if take > 0 {
				addToInventory(s.EnsureInventory(), itemID, take)
				accepted += take
				remaining -= take
			}
		}
	}

	if remaining > 0 {
		available := s.InputBufferCapacity() - s.UsedInputBuffer()
		if available > 0 {
			take := minInt(available, remaining)
			if take > 0 {
				addToInventory(s.EnsureInputBuffer(), itemID, take)
				accepted += take
				remaining -= take
			}
		}
	}

	return accepted, remaining, nil
}

// OutputQuantity returns total quantity available for output for an item.
func (s *StorageState) OutputQuantity(itemID string) int {
	if s == nil || itemID == "" {
		return 0
	}
	total := 0
	if s.OutputBuffer != nil {
		if qty := s.OutputBuffer[itemID]; qty > 0 {
			total += qty
		}
	}
	if s.Inventory != nil {
		if qty := s.Inventory[itemID]; qty > 0 {
			total += qty
		}
	}
	return total
}

// OutputCandidates returns item ids available for output, preferring output buffer contents.
func (s *StorageState) OutputCandidates() []string {
	if s == nil {
		return nil
	}
	outputKeys := sortedItemKeys(s.OutputBuffer)
	invKeys := sortedItemKeys(s.Inventory)
	if len(outputKeys) == 0 {
		return invKeys
	}
	if len(invKeys) == 0 {
		return outputKeys
	}
	seen := make(map[string]struct{}, len(outputKeys))
	out := make([]string, 0, len(outputKeys)+len(invKeys))
	for _, id := range outputKeys {
		seen[id] = struct{}{}
		out = append(out, id)
	}
	for _, id := range invKeys {
		if _, ok := seen[id]; ok {
			continue
		}
		out = append(out, id)
	}
	return out
}

// Provide supplies items from output buffers/inventory and returns provided and remaining quantities.
func (s *StorageState) Provide(itemID string, qty int) (int, int, error) {
	if s == nil {
		return 0, qty, fmt.Errorf("storage required")
	}
	if err := validateItemQuantity(itemID, qty); err != nil {
		return 0, qty, err
	}

	provided := 0
	remaining := qty

	if remaining > 0 {
		take := removeFromInventory(s.OutputBuffer, itemID, remaining)
		provided += take
		remaining -= take
	}

	if remaining > 0 {
		take := removeFromInventory(s.Inventory, itemID, remaining)
		provided += take
		remaining -= take
	}

	return provided, remaining, nil
}

// Tick flushes input buffers and refills output buffers.
func (s *StorageState) Tick() {
	if s == nil {
		return
	}
	s.FlushInput()
	s.RefillOutput()
}

// FlushInput moves items from input buffer to main inventory.
func (s *StorageState) FlushInput() int {
	if s == nil {
		return 0
	}
	available := s.availableInventory()
	if available <= 0 {
		return 0
	}
	return moveUpTo(s.InputBuffer, s.EnsureInventory(), available)
}

// RefillOutput moves items from inventory into output buffer.
func (s *StorageState) RefillOutput() int {
	if s == nil {
		return 0
	}
	outCap := s.OutputBufferCapacity()
	if outCap <= 0 {
		return 0
	}
	available := outCap - s.UsedOutputBuffer()
	if available <= 0 {
		return 0
	}
	return moveUpTo(s.Inventory, s.EnsureOutputBuffer(), available)
}

// InputPriorityValue returns normalized input priority.
func (s *StorageState) InputPriorityValue() int {
	input, _ := normalizePriority(s.Priority.Input, s.Priority.Output)
	return input
}

// OutputPriorityValue returns normalized output priority.
func (s *StorageState) OutputPriorityValue() int {
	_, output := normalizePriority(s.Priority.Input, s.Priority.Output)
	return output
}

func (s *StorageState) normalize() {
	if s.Capacity < 0 {
		s.Capacity = 0
	}
	if s.Slots < 0 {
		s.Slots = 0
	}
	if s.BufferCapacity < 0 {
		s.BufferCapacity = 0
	}
	if s.Priority.Input < 0 {
		s.Priority.Input = 0
	}
	if s.Priority.Output < 0 {
		s.Priority.Output = 0
	}
	if s.Priority.Input == 0 && s.Priority.Output == 0 {
		s.Priority.Input = 1
		s.Priority.Output = 1
	}
}

func (s *StorageState) bufferCaps() (int, int) {
	if s == nil || s.BufferCapacity <= 0 {
		return 0, 0
	}
	input, output := normalizePriority(s.Priority.Input, s.Priority.Output)
	total := input + output
	if total <= 0 {
		return 0, 0
	}
	inCap := s.BufferCapacity * input / total
	outCap := s.BufferCapacity - inCap
	if inCap == 0 && input > 0 && s.BufferCapacity > 0 {
		inCap = 1
		outCap = s.BufferCapacity - inCap
	}
	if outCap == 0 && output > 0 && s.BufferCapacity > 0 {
		outCap = 1
		inCap = s.BufferCapacity - outCap
		if inCap < 0 {
			inCap = 0
		}
	}
	return inCap, outCap
}

func (s *StorageState) availableInventory() int {
	if s.Capacity <= 0 {
		return 0
	}
	used := s.UsedInventory()
	if used >= s.Capacity {
		return 0
	}
	return s.Capacity - used
}

func (s *StorageState) canAcceptNewItem(itemID string) bool {
	if s.Slots <= 0 {
		return true
	}
	if hasItemInInventories(itemID, s.Inventory, s.InputBuffer, s.OutputBuffer) {
		return true
	}
	return s.DistinctItems() < s.Slots
}

func normalizePriority(input, output int) (int, int) {
	if input < 0 {
		input = 0
	}
	if output < 0 {
		output = 0
	}
	if input == 0 && output == 0 {
		input = 1
		output = 1
	}
	return input, output
}

func validateItemQuantity(itemID string, qty int) error {
	if qty <= 0 {
		return fmt.Errorf("quantity must be positive")
	}
	if _, ok := Item(itemID); !ok {
		return fmt.Errorf("unknown item: %s", itemID)
	}
	return nil
}

func inventoryQty(inv ItemInventory) int {
	if len(inv) == 0 {
		return 0
	}
	total := 0
	for _, qty := range inv {
		if qty > 0 {
			total += qty
		}
	}
	return total
}

func addToInventory(inv ItemInventory, itemID string, qty int) {
	if inv == nil || qty <= 0 {
		return
	}
	inv[itemID] += qty
}

func removeFromInventory(inv ItemInventory, itemID string, qty int) int {
	if inv == nil || qty <= 0 {
		return 0
	}
	current := inv[itemID]
	if current <= 0 {
		return 0
	}
	take := minInt(current, qty)
	current -= take
	if current <= 0 {
		delete(inv, itemID)
	} else {
		inv[itemID] = current
	}
	return take
}

func moveUpTo(src ItemInventory, dest ItemInventory, limit int) int {
	if src == nil || dest == nil || limit <= 0 {
		return 0
	}
	keys := sortedItemKeys(src)
	moved := 0
	for _, id := range keys {
		if moved >= limit {
			break
		}
		qty := src[id]
		if qty <= 0 {
			continue
		}
		take := minInt(limit-moved, qty)
		if take <= 0 {
			continue
		}
		dest[id] += take
		src[id] -= take
		if src[id] <= 0 {
			delete(src, id)
		}
		moved += take
	}
	return moved
}

func distinctItems(inventories ...ItemInventory) int {
	seen := make(map[string]struct{})
	for _, inv := range inventories {
		for id, qty := range inv {
			if qty <= 0 {
				continue
			}
			seen[id] = struct{}{}
		}
	}
	return len(seen)
}

func hasItemInInventories(itemID string, inventories ...ItemInventory) bool {
	if itemID == "" {
		return false
	}
	for _, inv := range inventories {
		if inv == nil {
			continue
		}
		if inv[itemID] > 0 {
			return true
		}
	}
	return false
}

func sortedItemKeys(inv ItemInventory) []string {
	if len(inv) == 0 {
		return nil
	}
	keys := make([]string, 0, len(inv))
	for id, qty := range inv {
		if qty > 0 {
			keys = append(keys, id)
		}
	}
	sort.Strings(keys)
	return keys
}

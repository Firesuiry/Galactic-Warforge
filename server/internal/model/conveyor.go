package model

import "fmt"

// ConveyorDirection represents a belt direction on the grid.
type ConveyorDirection string

const (
	ConveyorNorth ConveyorDirection = "north"
	ConveyorEast  ConveyorDirection = "east"
	ConveyorSouth ConveyorDirection = "south"
	ConveyorWest  ConveyorDirection = "west"
	ConveyorAuto  ConveyorDirection = "auto"
)

var validConveyorDirections = map[ConveyorDirection]struct{}{
	ConveyorNorth: {},
	ConveyorEast:  {},
	ConveyorSouth: {},
	ConveyorWest:  {},
	ConveyorAuto:  {},
}

// Valid returns true when the direction is supported.
func (d ConveyorDirection) Valid() bool {
	_, ok := validConveyorDirections[d]
	return ok
}

// Opposite returns the opposite direction.
func (d ConveyorDirection) Opposite() ConveyorDirection {
	switch d {
	case ConveyorNorth:
		return ConveyorSouth
	case ConveyorSouth:
		return ConveyorNorth
	case ConveyorEast:
		return ConveyorWest
	case ConveyorWest:
		return ConveyorEast
	case ConveyorAuto:
		return ConveyorAuto
	default:
		return ""
	}
}

// Delta returns the grid delta for this direction.
func (d ConveyorDirection) Delta() (int, int) {
	switch d {
	case ConveyorNorth:
		return 0, -1
	case ConveyorSouth:
		return 0, 1
	case ConveyorEast:
		return 1, 0
	case ConveyorWest:
		return -1, 0
	default:
		return 0, 0
	}
}

// Left returns the left turn for this direction.
func (d ConveyorDirection) Left() ConveyorDirection {
	switch d {
	case ConveyorNorth:
		return ConveyorWest
	case ConveyorWest:
		return ConveyorSouth
	case ConveyorSouth:
		return ConveyorEast
	case ConveyorEast:
		return ConveyorNorth
	default:
		return ConveyorAuto
	}
}

// Right returns the right turn for this direction.
func (d ConveyorDirection) Right() ConveyorDirection {
	switch d {
	case ConveyorNorth:
		return ConveyorEast
	case ConveyorEast:
		return ConveyorSouth
	case ConveyorSouth:
		return ConveyorWest
	case ConveyorWest:
		return ConveyorNorth
	default:
		return ConveyorAuto
	}
}

// ConveyorState tracks items moving along a conveyor segment.
type ConveyorState struct {
	Input      ConveyorDirection `json:"input"`
	Output     ConveyorDirection `json:"output"`
	Buffer     []ItemStack       `json:"buffer,omitempty"`
	MaxStack   int               `json:"max_stack"`
	Throughput int               `json:"throughput"`
}

// Clone returns a deep copy of the conveyor state.
func (c *ConveyorState) Clone() *ConveyorState {
	if c == nil {
		return nil
	}
	out := *c
	if len(c.Buffer) > 0 {
		out.Buffer = make([]ItemStack, len(c.Buffer))
		for i, stack := range c.Buffer {
			out.Buffer[i] = ItemStack{
				ItemID:   stack.ItemID,
				Quantity: stack.Quantity,
				Spray:    cloneSprayState(stack.Spray),
			}
		}
	}
	return &out
}

// TotalItems returns total items currently on the belt segment.
func (c *ConveyorState) TotalItems() int {
	if c == nil {
		return 0
	}
	total := 0
	for _, stack := range c.Buffer {
		if stack.Quantity > 0 {
			total += stack.Quantity
		}
	}
	return total
}

// AvailableCapacity returns remaining capacity on the segment.
func (c *ConveyorState) AvailableCapacity() int {
	if c == nil {
		return 0
	}
	if c.MaxStack <= 0 {
		return maxInt
	}
	used := c.TotalItems()
	if used >= c.MaxStack {
		return 0
	}
	return c.MaxStack - used
}

// Insert attempts to insert items into the conveyor buffer.
func (c *ConveyorState) Insert(itemID string, qty int) (int, int, error) {
	if c == nil {
		return 0, qty, fmt.Errorf("conveyor required")
	}
	if err := validateItemQuantity(itemID, qty); err != nil {
		return 0, qty, err
	}
	available := c.AvailableCapacity()
	if available <= 0 {
		return 0, qty, nil
	}
	take := minInt(available, qty)
	if take <= 0 {
		return 0, qty, nil
	}
	c.appendStack(ItemStack{ItemID: itemID, Quantity: take})
	return take, qty - take, nil
}

// Take removes up to qty items from the front of the buffer.
func (c *ConveyorState) Take(qty int) []ItemStack {
	if c == nil || qty <= 0 {
		return nil
	}
	remaining := qty
	var taken []ItemStack
	for remaining > 0 && len(c.Buffer) > 0 {
		stack := c.Buffer[0]
		if stack.Quantity <= remaining {
			taken = append(taken, stack)
			c.Buffer = c.Buffer[1:]
			remaining -= stack.Quantity
			continue
		}
		taken = append(taken, ItemStack{
			ItemID:   stack.ItemID,
			Quantity: remaining,
			Spray:    cloneSprayState(stack.Spray),
		})
		c.Buffer[0].Quantity -= remaining
		remaining = 0
	}
	return taken
}

// TakeAt removes up to qty items from the stack at the provided buffer index.
func (c *ConveyorState) TakeAt(index, qty int) []ItemStack {
	if c == nil || qty <= 0 || index < 0 || index >= len(c.Buffer) {
		return nil
	}
	stack := c.Buffer[index]
	if stack.Quantity <= 0 {
		return nil
	}
	take := minInt(qty, stack.Quantity)
	if take <= 0 {
		return nil
	}
	taken := []ItemStack{{
		ItemID:   stack.ItemID,
		Quantity: take,
		Spray:    cloneSprayState(stack.Spray),
	}}
	if take == stack.Quantity {
		c.Buffer = append(c.Buffer[:index], c.Buffer[index+1:]...)
		return taken
	}
	c.Buffer[index].Quantity -= take
	return taken
}

// AppendStacks appends stacks to the buffer (caller ensures capacity).
func (c *ConveyorState) AppendStacks(stacks []ItemStack) {
	if c == nil {
		return
	}
	for _, stack := range stacks {
		if stack.Quantity <= 0 {
			continue
		}
		c.appendStack(ItemStack{
			ItemID:   stack.ItemID,
			Quantity: stack.Quantity,
			Spray:    cloneSprayState(stack.Spray),
		})
	}
}

// PrependStacks inserts stacks at the front of the buffer.
func (c *ConveyorState) PrependStacks(stacks []ItemStack) {
	if c == nil || len(stacks) == 0 {
		return
	}
	newBuf := make([]ItemStack, 0, len(stacks)+len(c.Buffer))
	for _, stack := range stacks {
		if stack.Quantity <= 0 {
			continue
		}
		newBuf = append(newBuf, ItemStack{
			ItemID:   stack.ItemID,
			Quantity: stack.Quantity,
			Spray:    cloneSprayState(stack.Spray),
		})
	}
	if len(newBuf) == 0 {
		return
	}
	if len(c.Buffer) > 0 && canMergeStacks(newBuf[len(newBuf)-1], c.Buffer[0]) {
		newBuf[len(newBuf)-1].Quantity += c.Buffer[0].Quantity
		newBuf = append(newBuf, c.Buffer[1:]...)
	} else {
		newBuf = append(newBuf, c.Buffer...)
	}
	c.Buffer = newBuf
}

// InsertAt inserts stacks before the provided buffer index while preserving order.
func (c *ConveyorState) InsertAt(index int, stacks []ItemStack) {
	if c == nil || len(stacks) == 0 {
		return
	}
	if index < 0 {
		index = 0
	}
	if index > len(c.Buffer) {
		index = len(c.Buffer)
	}
	newBuf := make([]ItemStack, 0, len(c.Buffer)+len(stacks))
	appendOne := func(stack ItemStack) {
		if stack.Quantity <= 0 {
			return
		}
		if len(newBuf) > 0 && canMergeStacks(newBuf[len(newBuf)-1], stack) {
			newBuf[len(newBuf)-1].Quantity += stack.Quantity
			return
		}
		newBuf = append(newBuf, ItemStack{
			ItemID:   stack.ItemID,
			Quantity: stack.Quantity,
			Spray:    cloneSprayState(stack.Spray),
		})
	}
	for _, stack := range c.Buffer[:index] {
		appendOne(stack)
	}
	for _, stack := range stacks {
		appendOne(stack)
	}
	for _, stack := range c.Buffer[index:] {
		appendOne(stack)
	}
	c.Buffer = newBuf
}

func (c *ConveyorState) appendStack(stack ItemStack) {
	if stack.Quantity <= 0 {
		return
	}
	if len(c.Buffer) > 0 {
		last := &c.Buffer[len(c.Buffer)-1]
		if canMergeStacks(*last, stack) {
			last.Quantity += stack.Quantity
			return
		}
	}
	c.Buffer = append(c.Buffer, stack)
}

func canMergeStacks(a, b ItemStack) bool {
	if a.ItemID != b.ItemID {
		return false
	}
	if (a.Spray == nil) != (b.Spray == nil) {
		return false
	}
	if a.Spray == nil && b.Spray == nil {
		return true
	}
	return a.Spray.Level == b.Spray.Level && a.Spray.RemainingUses == b.Spray.RemainingUses
}

func cloneSprayState(state *SprayState) *SprayState {
	if state == nil {
		return nil
	}
	clone := *state
	return &clone
}

const maxInt = int(^uint(0) >> 1)

// IsConveyorBuilding returns true for belt-like buildings.
func IsConveyorBuilding(btype BuildingType) bool {
	switch btype {
	case BuildingTypeConveyorBeltMk1, BuildingTypeConveyorBeltMk2, BuildingTypeConveyorBeltMk3:
		return true
	default:
		return false
	}
}

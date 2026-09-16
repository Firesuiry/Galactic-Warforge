package model

import "fmt"

// SprayCoaterState preserves material stacks and the unused units of a real dose.
type SprayCoaterState struct {
	InputBuffer          []ItemStack       `json:"input_buffer"`
	OutputBuffer         []ItemStack       `json:"output_buffer"`
	BufferCapacity       int               `json:"buffer_capacity"`
	Throughput           int               `json:"throughput"`
	InputDirection       ConveyorDirection `json:"input_direction"`
	OutputDirection      ConveyorDirection `json:"output_direction"`
	ReagentDirection     ConveyorDirection `json:"reagent_direction"`
	State                string            `json:"state"`
	CoatedItems          int64             `json:"coated_items"`
	ConsumedProliferator int64             `json:"consumed_proliferator"`
	LastSprayTick        int64             `json:"last_spray_tick"`
	SprayItemID          string            `json:"spray_item_id"`
	SprayUnits           int               `json:"spray_units"`
	SprayEffect          *SprayState       `json:"spray_effect,omitempty"`
}

func InitBuildingSprayCoater(b *Building) {
	if b == nil || b.Type != BuildingTypeSprayCoater || b.SprayCoater != nil {
		return
	}
	b.SprayCoater = &SprayCoaterState{BufferCapacity: 24, Throughput: 6, InputDirection: ConveyorWest, OutputDirection: ConveyorEast, ReagentDirection: ConveyorNorth, State: "idle"}
}
func (s *SprayCoaterState) Clone() *SprayCoaterState {
	if s == nil {
		return nil
	}
	out := *s
	out.InputBuffer = cloneItemStacks(s.InputBuffer)
	out.OutputBuffer = cloneItemStacks(s.OutputBuffer)
	out.SprayEffect = cloneSprayState(s.SprayEffect)
	return &out
}
func (s *SprayCoaterState) Validate() error {
	if s == nil || s.BufferCapacity != 24 || s.Throughput != 6 || s.InputDirection != ConveyorWest || s.OutputDirection != ConveyorEast || s.ReagentDirection != ConveyorNorth {
		return fmt.Errorf("invalid spray coater configuration")
	}
	if s.CoatedItems < 0 || s.ConsumedProliferator < 0 || s.LastSprayTick < 0 || s.SprayUnits < 0 {
		return fmt.Errorf("invalid spray coater counters")
	}
	if s.SprayUnits > 0 {
		def, ok := SprayDefinitionByItem(s.SprayItemID)
		if !ok || s.SprayUnits > def.UnitYield || s.SprayEffect == nil || s.SprayEffect.Level != def.Level || s.SprayEffect.RemainingUses <= 0 {
			return fmt.Errorf("invalid spray coater charged units")
		}
	}
	for _, buffer := range [][]ItemStack{s.InputBuffer, s.OutputBuffer} {
		total := 0
		for _, stack := range buffer {
			if stack.Quantity <= 0 {
				return fmt.Errorf("invalid spray coater cargo")
			}
			if err := stack.Validate(); err != nil {
				return err
			}
			total += stack.Quantity
		}
		if total > s.BufferCapacity {
			return fmt.Errorf("spray coater buffer exceeds capacity")
		}
	}
	return nil
}

package model

import (
	"fmt"
	"hash/fnv"
)

const (
	FractionationBufferCapacity  = 24
	FractionationThroughput      = 6
	FractionationBaseProbability = 0.01
)

// FractionationState holds real material independently of count-only storage:
// unconverted hydrogen keeps its spray and can only be retried through external IO.
type FractionationState struct {
	InputBuffer        []ItemStack       `json:"input_buffer"`
	HydrogenBuffer     []ItemStack       `json:"hydrogen_buffer"`
	DeuteriumBuffer    int               `json:"deuterium_buffer"`
	BufferCapacity     int               `json:"buffer_capacity"`
	Throughput         int               `json:"throughput"`
	InputDirection     ConveyorDirection `json:"input_direction"`
	HydrogenDirection  ConveyorDirection `json:"hydrogen_direction"`
	DeuteriumDirection ConveyorDirection `json:"deuterium_direction"`
	State              string            `json:"state"`
	Attempts           int64             `json:"attempts"`
	Converted          int64             `json:"converted"`
	ReturnedHydrogen   int64             `json:"returned_hydrogen"`
	LastProcessTick    int64             `json:"last_process_tick"`
	LastProbability    float64           `json:"last_probability"`
	LastSprayLevel     int               `json:"last_spray_level"`
	RNGState           uint32            `json:"rng_state"`
}

func InitBuildingFractionation(b *Building) {
	if b == nil || b.Type != BuildingTypeFractionator || b.Fractionation != nil {
		return
	}
	h := fnv.New32a()
	fmt.Fprintf(h, "fractionation:%s:%s:%d:%d", b.OwnerID, b.ID, b.Position.X, b.Position.Y)
	seed := h.Sum32()
	if seed == 0 {
		seed = 1
	}
	b.Fractionation = &FractionationState{BufferCapacity: FractionationBufferCapacity, Throughput: FractionationThroughput, InputDirection: ConveyorWest, HydrogenDirection: ConveyorEast, DeuteriumDirection: ConveyorSouth, State: "idle", LastProbability: FractionationBaseProbability, RNGState: seed}
}

func (s *FractionationState) Clone() *FractionationState {
	if s == nil {
		return nil
	}
	out := *s
	out.InputBuffer = cloneItemStacks(s.InputBuffer)
	out.HydrogenBuffer = cloneItemStacks(s.HydrogenBuffer)
	return &out
}

func (s *FractionationState) Validate() error {
	if s == nil {
		return fmt.Errorf("fractionation state required")
	}
	if s.BufferCapacity != FractionationBufferCapacity || s.Throughput != FractionationThroughput || s.InputDirection != ConveyorWest || s.HydrogenDirection != ConveyorEast || s.DeuteriumDirection != ConveyorSouth {
		return fmt.Errorf("invalid fractionation transport configuration")
	}
	if s.RNGState == 0 || s.Attempts < 0 || s.Converted < 0 || s.ReturnedHydrogen < 0 || s.Converted+s.ReturnedHydrogen != s.Attempts || s.LastProcessTick < 0 {
		return fmt.Errorf("invalid fractionation counters or random state")
	}
	if s.DeuteriumBuffer < 0 || s.DeuteriumBuffer > s.BufferCapacity {
		return fmt.Errorf("invalid deuterium buffer")
	}
	for _, buffer := range [][]ItemStack{s.InputBuffer, s.HydrogenBuffer} {
		total := 0
		for _, stack := range buffer {
			if stack.ItemID != ItemHydrogen || stack.Quantity <= 0 {
				return fmt.Errorf("fractionation accepts hydrogen stacks only")
			}
			if err := stack.Validate(); err != nil {
				return err
			}
			total += stack.Quantity
		}
		if total > s.BufferCapacity {
			return fmt.Errorf("fractionation buffer exceeds capacity")
		}
	}
	if s.LastProbability < FractionationBaseProbability || s.LastProbability > 1 || s.LastSprayLevel < 0 {
		return fmt.Errorf("invalid fractionation probability")
	}
	return nil
}

// FractionationProbability consumes one real spray use per attempted molecule.
// The returned stack is the exact hydrogen to return when conversion fails.
func FractionationProbability(stack ItemStack) (float64, int, ItemStack) {
	stack.Spray = cloneSprayState(stack.Spray)
	probability := FractionationBaseProbability
	level := 0
	if stack.Spray != nil && stack.Spray.RemainingUses > 0 {
		if tier, ok := ProductionBonusTierByLevel(stack.Spray.Level); ok {
			probability = min(1.0, probability*tier.SpeedMultiplier)
			level = stack.Spray.Level
			stack.Spray.Consume(1)
			if stack.Spray.RemainingUses == 0 {
				stack.Spray = nil
			}
		}
	}
	return probability, level, stack
}

// Draw advances only after both possible outputs have reserved space. Xorshift32
// uses a persisted nonzero state, independent of map iteration and wall clock.
func (s *FractionationState) Draw(probability float64) bool {
	x := s.RNGState
	x ^= x << 13
	x ^= x >> 17
	x ^= x << 5
	s.RNGState = x
	return float64(x)/4294967296.0 < probability
}

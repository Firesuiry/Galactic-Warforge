package model

import "testing"

func TestFractionationProbabilityIndependentTrials(t *testing.T) {
	s := &FractionationState{RNGState: 1234567}
	converted := 0
	for n := 0; n < 100000; n++ {
		if s.Draw(FractionationBaseProbability) {
			converted++
		}
	}
	if converted < 850 || converted > 1150 {
		t.Fatalf("1%% draw outside expected distribution: %d", converted)
	}
	for level, want := range map[int]float64{0: 0.01, 1: 0.0125, 2: 0.015, 3: 0.02} {
		input := ItemStack{ItemID: ItemHydrogen, Quantity: 1}
		if level > 0 {
			input.Spray = &SprayState{Level: level, RemainingUses: 1}
		}
		probability, gotLevel, returned := FractionationProbability(input)
		if probability != want || gotLevel != level || returned.Spray != nil {
			t.Fatalf("level %d probability/consumption incorrect: %f", level, probability)
		}
		if input.Spray != nil && input.Spray.RemainingUses != 1 {
			t.Fatal("probability consumed source stack alias")
		}
	}
}

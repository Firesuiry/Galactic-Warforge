package model

import "testing"

func TestConveyorInsertRespectsMaxStackAndMerges(t *testing.T) {
	conveyor := &ConveyorState{MaxStack: 3}

	accepted, remaining, err := conveyor.Insert(ItemIronOre, 2)
	if err != nil {
		t.Fatalf("insert error: %v", err)
	}
	if accepted != 2 || remaining != 0 {
		t.Fatalf("expected accepted 2 remaining 0, got %d/%d", accepted, remaining)
	}
	if len(conveyor.Buffer) != 1 || conveyor.Buffer[0].Quantity != 2 {
		t.Fatalf("expected single stack qty 2, got %+v", conveyor.Buffer)
	}

	accepted, remaining, err = conveyor.Insert(ItemIronOre, 2)
	if err != nil {
		t.Fatalf("insert error: %v", err)
	}
	if accepted != 1 || remaining != 1 {
		t.Fatalf("expected accepted 1 remaining 1, got %d/%d", accepted, remaining)
	}
	if len(conveyor.Buffer) != 1 || conveyor.Buffer[0].Quantity != 3 {
		t.Fatalf("expected merged stack qty 3, got %+v", conveyor.Buffer)
	}
}

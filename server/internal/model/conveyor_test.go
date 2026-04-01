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

func TestConveyorTakeAtAndInsertAtPreserveOrder(t *testing.T) {
	conveyor := &ConveyorState{
		Buffer: []ItemStack{
			{ItemID: ItemStoneOre, Quantity: 2},
			{ItemID: ItemWater, Quantity: 3},
			{ItemID: ItemRefinedOil, Quantity: 1},
		},
	}

	taken := conveyor.TakeAt(1, 2)
	if len(taken) != 1 || taken[0].ItemID != ItemWater || taken[0].Quantity != 2 {
		t.Fatalf("expected to take 2 water, got %+v", taken)
	}
	if len(conveyor.Buffer) != 3 || conveyor.Buffer[1].ItemID != ItemWater || conveyor.Buffer[1].Quantity != 1 {
		t.Fatalf("expected remaining middle water stack, got %+v", conveyor.Buffer)
	}

	conveyor.InsertAt(1, taken)
	if len(conveyor.Buffer) != 3 {
		t.Fatalf("expected three stacks after rollback, got %+v", conveyor.Buffer)
	}
	if conveyor.Buffer[0].ItemID != ItemStoneOre || conveyor.Buffer[0].Quantity != 2 {
		t.Fatalf("unexpected first stack after rollback: %+v", conveyor.Buffer[0])
	}
	if conveyor.Buffer[1].ItemID != ItemWater || conveyor.Buffer[1].Quantity != 3 {
		t.Fatalf("expected merged water stack after rollback, got %+v", conveyor.Buffer[1])
	}
	if conveyor.Buffer[2].ItemID != ItemRefinedOil || conveyor.Buffer[2].Quantity != 1 {
		t.Fatalf("unexpected last stack after rollback: %+v", conveyor.Buffer[2])
	}
}

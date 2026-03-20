package model

import "testing"

func TestStorageCapacityAndSlots(t *testing.T) {
	storage := NewStorageState(StorageModule{Capacity: 5, Slots: 1})

	accepted, remaining, err := storage.Receive(ItemIronOre, 5)
	if err != nil {
		t.Fatalf("receive error: %v", err)
	}
	if accepted != 5 || remaining != 0 {
		t.Fatalf("expected accept 5/0, got %d/%d", accepted, remaining)
	}

	accepted, remaining, err = storage.Receive(ItemCopperOre, 1)
	if err != nil {
		t.Fatalf("receive error: %v", err)
	}
	if accepted != 0 || remaining != 1 {
		t.Fatalf("expected slot limit reject, got %d/%d", accepted, remaining)
	}

	accepted, remaining, err = storage.Receive(ItemIronOre, 1)
	if err != nil {
		t.Fatalf("receive error: %v", err)
	}
	if accepted != 0 || remaining != 1 {
		t.Fatalf("expected capacity reject, got %d/%d", accepted, remaining)
	}
}

func TestStorageBuffersAndTick(t *testing.T) {
	storage := NewStorageState(StorageModule{
		Capacity:       4,
		Slots:          2,
		Buffer:         4,
		InputPriority:  1,
		OutputPriority: 1,
	})

	accepted, remaining, err := storage.Receive(ItemIronOre, 3)
	if err != nil {
		t.Fatalf("receive error: %v", err)
	}
	if accepted != 3 || remaining != 0 {
		t.Fatalf("expected accept 3/0, got %d/%d", accepted, remaining)
	}
	if storage.UsedInputBuffer() != 2 {
		t.Fatalf("expected input buffer 2, got %d", storage.UsedInputBuffer())
	}
	if storage.UsedInventory() != 1 {
		t.Fatalf("expected inventory 1, got %d", storage.UsedInventory())
	}

	storage.Tick()

	if storage.UsedInputBuffer() != 0 {
		t.Fatalf("expected input buffer drained, got %d", storage.UsedInputBuffer())
	}
	if storage.UsedInventory() != 1 {
		t.Fatalf("expected inventory 1 after refill, got %d", storage.UsedInventory())
	}
	if storage.UsedOutputBuffer() != 2 {
		t.Fatalf("expected output buffer 2, got %d", storage.UsedOutputBuffer())
	}

	provided, remaining, err := storage.Provide(ItemIronOre, 1)
	if err != nil {
		t.Fatalf("provide error: %v", err)
	}
	if provided != 1 || remaining != 0 {
		t.Fatalf("expected provide 1/0, got %d/%d", provided, remaining)
	}
	if storage.UsedOutputBuffer() != 1 {
		t.Fatalf("expected output buffer 1, got %d", storage.UsedOutputBuffer())
	}
}

func TestStorageNetworkPriority(t *testing.T) {
	s1 := NewStorageState(StorageModule{
		Capacity:       4,
		Slots:          2,
		InputPriority:  2,
		OutputPriority: 1,
	})
	s2 := NewStorageState(StorageModule{
		Capacity:       10,
		Slots:          2,
		InputPriority:  1,
		OutputPriority: 3,
	})
	network := StorageNetwork{
		Nodes: []StorageNode{
			{ID: "a", Storage: s1},
			{ID: "b", Storage: s2},
		},
	}

	accepted, remaining, err := network.Insert(ItemIronOre, 6)
	if err != nil {
		t.Fatalf("insert error: %v", err)
	}
	if accepted != 6 || remaining != 0 {
		t.Fatalf("expected accept 6/0, got %d/%d", accepted, remaining)
	}
	if s1.Inventory[ItemIronOre] != 4 {
		t.Fatalf("expected s1 receive 4, got %d", s1.Inventory[ItemIronOre])
	}
	if s2.Inventory[ItemIronOre] != 2 {
		t.Fatalf("expected s2 receive 2, got %d", s2.Inventory[ItemIronOre])
	}

	_, _, err = s2.Receive(ItemIronOre, 5)
	if err != nil {
		t.Fatalf("receive error: %v", err)
	}

	provided, remaining, err := network.Extract(ItemIronOre, 5)
	if err != nil {
		t.Fatalf("extract error: %v", err)
	}
	if provided != 5 || remaining != 0 {
		t.Fatalf("expected provide 5/0, got %d/%d", provided, remaining)
	}
	if s1.Inventory[ItemIronOre] != 4 {
		t.Fatalf("expected s1 untouched by output priority, got %d", s1.Inventory[ItemIronOre])
	}
}

func TestStoragePortIO(t *testing.T) {
	profile := BuildingProfileFor(BuildingTypeDepotMk1, 1)
	building := &Building{
		ID:          "b-1",
		Type:        BuildingTypeDepotMk1,
		OwnerID:     "p1",
		Position:    Position{X: 1, Y: 1},
		HP:          profile.MaxHP,
		MaxHP:       profile.MaxHP,
		Level:       1,
		VisionRange: profile.VisionRange,
		Runtime:     profile.Runtime,
	}
	InitBuildingStorage(building)

	accepted, remaining, err := StoragePortInput(building, "in-0", ItemIronOre, 2)
	if err != nil {
		t.Fatalf("input error: %v", err)
	}
	if accepted != 2 || remaining != 0 {
		t.Fatalf("expected input accept 2/0, got %d/%d", accepted, remaining)
	}

	building.Storage.Tick()
	provided, remaining, err := StoragePortOutput(building, "out-0", ItemIronOre, 1)
	if err != nil {
		t.Fatalf("output error: %v", err)
	}
	if provided != 1 || remaining != 0 {
		t.Fatalf("expected output provide 1/0, got %d/%d", provided, remaining)
	}
}

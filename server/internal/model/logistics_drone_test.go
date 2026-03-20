package model

import "testing"

func TestLogisticsDroneCapacity(t *testing.T) {
	drone := &LogisticsDroneState{
		ID:        "drone-1",
		StationID: "station-1",
		Capacity:  10,
		Speed:     2,
		Status:    LogisticsDroneIdle,
	}
	drone.Normalize()

	accepted, remaining, err := drone.Load(ItemIronOre, 6)
	if err != nil {
		t.Fatalf("load error: %v", err)
	}
	if accepted != 6 || remaining != 0 {
		t.Fatalf("expected accepted 6 remaining 0, got %d %d", accepted, remaining)
	}

	accepted, remaining, err = drone.Load(ItemIronOre, 6)
	if err != nil {
		t.Fatalf("load error: %v", err)
	}
	if accepted != 4 || remaining != 2 {
		t.Fatalf("expected accepted 4 remaining 2, got %d %d", accepted, remaining)
	}

	if drone.CargoQty() != 10 {
		t.Fatalf("expected cargo 10, got %d", drone.CargoQty())
	}
	if drone.AvailableCapacity() != 0 {
		t.Fatalf("expected available capacity 0, got %d", drone.AvailableCapacity())
	}
}

func TestLogisticsDroneTravelTicks(t *testing.T) {
	slow := LogisticsDroneTravelTicks(10, 2)
	fast := LogisticsDroneTravelTicks(10, 5)
	if slow != 5 {
		t.Fatalf("expected slow travel ticks 5, got %d", slow)
	}
	if fast != 2 {
		t.Fatalf("expected fast travel ticks 2, got %d", fast)
	}
	if slow <= fast {
		t.Fatalf("expected slow > fast, got %d <= %d", slow, fast)
	}
}

func TestLogisticsDroneStationCapacity(t *testing.T) {
	ws := NewWorldState("planet-1", 2, 2)
	station := NewLogisticsStationState()
	station.DroneCapacity = 1
	ws.LogisticsStations["station-1"] = station

	d1 := NewLogisticsDroneState("drone-1", "station-1", Position{X: 0, Y: 0})
	if err := RegisterLogisticsDrone(ws, d1); err != nil {
		t.Fatalf("register drone 1: %v", err)
	}
	d2 := NewLogisticsDroneState("drone-2", "station-1", Position{X: 0, Y: 0})
	if err := RegisterLogisticsDrone(ws, d2); err == nil {
		t.Fatalf("expected capacity error, got nil")
	}
}

package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestLogisticsDroneTakeoffAndLanding(t *testing.T) {
	ws := model.NewWorldState("planet-1", 5, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	origin := newLogisticsStationBuilding("station-a", model.Position{X: 0, Y: 0})
	target := newLogisticsStationBuilding("station-b", model.Position{X: 4, Y: 0})

	attachBuilding(ws, origin)
	attachBuilding(ws, target)
	model.RegisterLogisticsStation(ws, origin)
	model.RegisterLogisticsStation(ws, target)

	origin.LogisticsStation.DroneCapacity = 1
	drone := model.NewLogisticsDroneState("drone-1", origin.ID, origin.Position)
	drone.Speed = 2
	if err := model.RegisterLogisticsDrone(ws, drone); err != nil {
		t.Fatalf("register drone: %v", err)
	}
	if err := drone.BeginTrip(target.ID, target.Position); err != nil {
		t.Fatalf("begin trip: %v", err)
	}
	if drone.Status != model.LogisticsDroneTakeoff {
		t.Fatalf("expected takeoff status, got %s", drone.Status)
	}

	settleLogisticsDrones(ws)
	if drone.Status != model.LogisticsDroneInFlight {
		t.Fatalf("expected inflight status, got %s", drone.Status)
	}
	if drone.RemainingTicks != 2 {
		t.Fatalf("expected inflight remaining 2, got %d", drone.RemainingTicks)
	}

	settleLogisticsDrones(ws)
	if drone.Status != model.LogisticsDroneInFlight {
		t.Fatalf("expected inflight status, got %s", drone.Status)
	}
	if drone.RemainingTicks != 1 {
		t.Fatalf("expected inflight remaining 1, got %d", drone.RemainingTicks)
	}

	settleLogisticsDrones(ws)
	if drone.Status != model.LogisticsDroneLanding {
		t.Fatalf("expected landing status, got %s", drone.Status)
	}
	if drone.RemainingTicks != model.DefaultLogisticsDroneLandingTicks {
		t.Fatalf("expected landing remaining %d, got %d", model.DefaultLogisticsDroneLandingTicks, drone.RemainingTicks)
	}
	if drone.Position != target.Position {
		t.Fatalf("expected drone at target position, got %+v", drone.Position)
	}

	settleLogisticsDrones(ws)
	if drone.Status != model.LogisticsDroneIdle {
		t.Fatalf("expected idle status, got %s", drone.Status)
	}
	if drone.TargetPos != nil {
		t.Fatalf("expected target pos cleared")
	}
	if drone.TargetStationID != "" {
		t.Fatalf("expected target station cleared")
	}
	if drone.Position != target.Position {
		t.Fatalf("expected drone at target position, got %+v", drone.Position)
	}
}

func newLogisticsStationBuilding(id string, pos model.Position) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypePlanetaryLogisticsStation, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypePlanetaryLogisticsStation,
		OwnerID:     "p1",
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingLogisticsStation(b)
	return b
}

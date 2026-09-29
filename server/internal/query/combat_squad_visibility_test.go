package query

import (
	"testing"

	"siliconworld/internal/model"
)

func TestPlanetRuntimeExposesVisibleEnemySquads(t *testing.T) {
	ql, ws, planetID := newQueryTestContext(t)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	ws.Units["spotter"] = &model.Unit{
		ID:          "spotter",
		Type:        model.UnitTypeSoldier,
		OwnerID:     "p1",
		Position:    model.Position{X: 2, Y: 2},
		HP:          100,
		MaxHP:       100,
		VisionRange: 6,
	}
	ws.CombatRuntime.Squads["own"] = &model.CombatSquad{
		ID: "own", OwnerID: "p1", Position: model.Position{X: 1, Y: 1},
		HP: 10, MaxHP: 10, Count: 1, State: model.CombatSquadStateIdle,
	}
	ws.CombatRuntime.Squads["seen"] = &model.CombatSquad{
		ID: "seen", OwnerID: "p2", Position: model.Position{X: 4, Y: 4},
		HP: 10, MaxHP: 10, Count: 1, State: model.CombatSquadStateIdle,
	}
	ws.CombatRuntime.Squads["hidden"] = &model.CombatSquad{
		ID: "hidden", OwnerID: "p2", Position: model.Position{X: 40, Y: 20},
		HP: 10, MaxHP: 10, Count: 1, State: model.CombatSquadStateIdle,
	}

	view, ok := ql.PlanetRuntime(ws, "p1", planetID, planetID)
	if !ok || view == nil {
		t.Fatal("expected runtime view")
	}
	got := map[string]bool{}
	for _, squad := range view.CombatSquads {
		got[squad.ID] = true
	}
	if !got["own"] || !got["seen"] {
		t.Fatalf("own and in-vision enemy squads must be visible, got %+v", view.CombatSquads)
	}
	if got["hidden"] {
		t.Fatalf("enemy squad outside vision must stay hidden, got %+v", view.CombatSquads)
	}
}

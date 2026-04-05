package gamecore

import (
	"testing"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

func TestT096SettlePowerGenerationDoesNotCommitEnergyBeforeFinalize(t *testing.T) {
	ws := newPowerTestWorld()
	generator := addPowerTestBuilding(ws, "gen-t096", model.BuildingTypeWindTurbine, model.Position{X: 1, Y: 1})
	generator.Runtime.State = model.BuildingWorkRunning

	player := ws.Players["p1"]
	if player == nil {
		t.Fatal("expected player p1")
	}
	player.Resources.Energy = 20

	events := settlePowerGeneration(ws, mapmodel.PlanetEnvironment{WindFactor: 1, LightFactor: 1})

	if len(ws.PowerInputs) != 1 {
		t.Fatalf("expected 1 power input, got %d", len(ws.PowerInputs))
	}
	if player.Resources.Energy != 20 {
		t.Fatalf("expected generation stage to keep player energy unchanged before finalize, got %d", player.Resources.Energy)
	}
	if len(events) != 0 {
		t.Fatalf("expected no resource change events before finalize, got %d", len(events))
	}
}

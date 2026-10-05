package gamecore

import (
	"testing"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

// 命令期供电判定与 tick 结算同源：发电机只有结算出实际出力才算供电。
func TestBuildingOperationalForCommandUsesSettledPower(t *testing.T) {
	ws := newPowerTestWorld()
	wind := addPowerTestBuilding(ws, "wind", model.BuildingTypeWindTurbine, model.Position{X: 1, Y: 1})
	wind.Runtime.State = model.BuildingWorkRunning
	consumer := addPowerTestBuilding(ws, "asm", model.BuildingTypeAssemblingMachineMk1, model.Position{X: 2, Y: 1})
	consumer.Runtime.State = model.BuildingWorkRunning
	ws.PowerGrid = model.BuildPowerGridGraph(ws)

	// 无风：风机在役但出力为 0，命令期不再凭额定出力“估算”为有电。
	settlePowerGeneration(ws, mapmodel.PlanetEnvironment{WindFactor: 0, LightFactor: 1})
	if ok, reason := buildingOperationalForCommand(ws, consumer); ok || reason != stateReasonUnderPower {
		t.Fatalf("zero-output generator must not power commands, got ok=%v reason=%q", ok, reason)
	}

	settlePowerGeneration(ws, mapmodel.PlanetEnvironment{WindFactor: 1, LightFactor: 1})
	if ok, reason := buildingOperationalForCommand(ws, consumer); !ok {
		t.Fatalf("settled wind power should run the consumer, got reason %q", reason)
	}

	// 本 tick 已结算时复用权威快照。
	finalizePowerSettlement(ws, nil)
	if ws.PowerSnapshot == nil || ws.PowerSnapshot.Tick != ws.Tick {
		t.Fatal("expected fresh power snapshot")
	}
	if ok, _ := buildingOperationalForCommand(ws, consumer); !ok {
		t.Fatal("fresh snapshot should keep the consumer powered")
	}

	consumer.Runtime.State, consumer.Runtime.StateReason = model.BuildingWorkPaused, "manual"
	if ok, reason := buildingOperationalForCommand(ws, consumer); ok || reason != "manual" {
		t.Fatalf("paused building must short-circuit with its reason, got ok=%v reason=%q", ok, reason)
	}
}

func TestBuildingOperationalForCommandReportsCoverageReason(t *testing.T) {
	ws := newPowerTestWorld()
	wind := addPowerTestBuilding(ws, "wind", model.BuildingTypeWindTurbine, model.Position{X: 1, Y: 1})
	wind.Runtime.State = model.BuildingWorkRunning
	far := addPowerTestBuilding(ws, "asm", model.BuildingTypeAssemblingMachineMk1, model.Position{X: 6, Y: 6})
	far.Runtime.State = model.BuildingWorkRunning
	ws.PowerGrid = model.BuildPowerGridGraph(ws)
	settlePowerGeneration(ws, mapmodel.PlanetEnvironment{WindFactor: 1, LightFactor: 1})

	ok, reason := buildingOperationalForCommand(ws, far)
	if ok || reason == "" || reason == stateReasonUnderPower {
		t.Fatalf("disconnected consumer should report a coverage reason, got ok=%v reason=%q", ok, reason)
	}
}

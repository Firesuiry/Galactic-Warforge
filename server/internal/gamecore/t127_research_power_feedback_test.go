package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func startElectromagnetismResearch(t *testing.T, core *GameCore, ws *model.WorldState) {
	t.Helper()
	res, _ := core.execStartResearch(ws, "p1", model.Command{
		Type:    model.CmdStartResearch,
		Payload: map[string]any{"tech_id": "electromagnetism"},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("start research: %s (%s)", res.Code, res.Message)
	}
}

func setResearchLabPowerRatio(ws *model.WorldState, lab *model.Building, demand, allocated int, ratio float64) {
	ws.PowerSnapshot = &model.PowerSettlementSnapshot{
		Tick: ws.Tick,
		Allocations: model.PowerAllocationState{
			Buildings: map[string]model.PowerAllocation{
				lab.ID: {Demand: demand, Allocated: allocated, Ratio: ratio},
			},
		},
	}
}

func currentResearch(t *testing.T, ws *model.WorldState) *model.PlayerResearch {
	t.Helper()
	player := ws.Players["p1"]
	if player == nil || player.Tech == nil || player.Tech.CurrentResearch == nil {
		t.Fatal("expected p1 to have a current research")
	}
	return player.Tech.CurrentResearch
}

func TestT127ResearchReportsFullPowerSpeed(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	lab := newBuilding("lab-full-power", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	lab.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, lab)
	if _, _, err := lab.Storage.Load(model.ItemElectromagneticMatrix, 10); err != nil {
		t.Fatalf("load research matrices: %v", err)
	}
	setResearchLabPowerRatio(ws, lab, 4, 4, 1)
	startElectromagnetismResearch(t, core, ws)

	settleResearch(core.worlds)

	research := currentResearch(t, ws)
	if research.BlockedReason != "" {
		t.Fatalf("expected no blocked reason under full power, got %q", research.BlockedReason)
	}
	if research.SpeedMultiplier != 1 {
		t.Fatalf("expected speed multiplier 1 under full power, got %v", research.SpeedMultiplier)
	}
	if research.Progress != 1 {
		t.Fatalf("expected matrix lab to progress 1 per tick, got %d", research.Progress)
	}
	if want := int64(9); research.EstimatedTicksRemaining != want {
		t.Fatalf("expected %d estimated ticks remaining, got %d", want, research.EstimatedTicksRemaining)
	}
}

func TestT127ResearchReportsLowPowerSlowdown(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	lab := newBuilding("lab-brownout", model.BuildingTypeSelfEvolutionLab, "p1", model.Position{X: 6, Y: 6})
	lab.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, lab)
	if _, _, err := lab.Storage.Load(model.ItemElectromagneticMatrix, 10); err != nil {
		t.Fatalf("load research matrices: %v", err)
	}
	setResearchLabPowerRatio(ws, lab, 16, 8, 0.5)
	startElectromagnetismResearch(t, core, ws)

	settleResearch(core.worlds)

	research := currentResearch(t, ws)
	if research.BlockedReason != "low_power" {
		t.Fatalf("expected low_power blocked reason during brownout, got %q", research.BlockedReason)
	}
	if research.SpeedMultiplier != 0.5 {
		t.Fatalf("expected speed multiplier 0.5 during brownout, got %v", research.SpeedMultiplier)
	}
	if want := int64(2); research.Progress != want {
		t.Fatalf("expected brownout lab to progress %d per tick (3 base at half power), got %d", want, research.Progress)
	}
	if want := int64(4); research.EstimatedTicksRemaining != want {
		t.Fatalf("expected %d estimated ticks remaining, got %d", want, research.EstimatedTicksRemaining)
	}
}

func TestT127ResearchReportsLowPowerWhenLabUnpowered(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	lab := newBuilding("lab-no-power", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	lab.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, lab)
	if _, _, err := lab.Storage.Load(model.ItemElectromagneticMatrix, 10); err != nil {
		t.Fatalf("load research matrices: %v", err)
	}
	setResearchLabPowerRatio(ws, lab, 4, 4, 1)
	startElectromagnetismResearch(t, core, ws)

	lab.Runtime.State = model.BuildingWorkNoPower
	settleResearch(core.worlds)

	research := currentResearch(t, ws)
	if research.BlockedReason != "low_power" {
		t.Fatalf("expected low_power blocked reason when lab has no power, got %q", research.BlockedReason)
	}
	if research.SpeedMultiplier != 0 {
		t.Fatalf("expected speed multiplier 0 when lab has no power, got %v", research.SpeedMultiplier)
	}
	if research.Progress != 0 {
		t.Fatalf("expected no progress when lab has no power, got %d", research.Progress)
	}
	if research.EstimatedTicksRemaining != 0 {
		t.Fatalf("expected no estimate when research is stalled, got %d", research.EstimatedTicksRemaining)
	}
}

func TestT127ResearchStillReportsWaitingLabWithoutPowerIssue(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	lab := newBuilding("lab-paused", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	lab.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, lab)
	if _, _, err := lab.Storage.Load(model.ItemElectromagneticMatrix, 10); err != nil {
		t.Fatalf("load research matrices: %v", err)
	}
	setResearchLabPowerRatio(ws, lab, 4, 4, 1)
	startElectromagnetismResearch(t, core, ws)

	lab.Runtime.State = model.BuildingWorkPaused
	settleResearch(core.worlds)

	research := currentResearch(t, ws)
	if research.BlockedReason != "waiting_lab" {
		t.Fatalf("expected waiting_lab when the only lab is paused (not a power issue), got %q", research.BlockedReason)
	}
}

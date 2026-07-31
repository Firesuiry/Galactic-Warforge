package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/model"
)

func newResearchLabTestWorld(t *testing.T, btype model.BuildingType) (*model.WorldState, *model.Building) {
	t.Helper()
	ws := model.NewWorldState("planet-1", 1, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	b := newBuilding("lab-1", btype, "p1", model.Position{X: 2, Y: 2})
	// Research mode: empty recipe (InitBuildingProduction leaves RecipeID empty).
	if b.Production != nil {
		b.Production.RecipeID = ""
	}
	b.Runtime.State = model.BuildingWorkRunning
	ws.Buildings[b.ID] = b
	return ws, b
}

// Empty-recipe matrix_lab / self_evolution_lab is the recommended research-station
// state. Throughput-class alerts must stay silent; only power shortage remains.
func TestResearchModeLabSkipsThroughputAlerts(t *testing.T) {
	for _, btype := range []model.BuildingType{
		model.BuildingTypeMatrixLab,
		model.BuildingTypeSelfEvolutionLab,
	} {
		t.Run(string(btype), func(t *testing.T) {
			ws, lab := newResearchLabTestWorld(t, btype)
			if !isResearchLab(lab) {
				t.Fatalf("fixture must be research-mode lab, got production=%+v research=%v", lab.Production, lab.Runtime.Functions.Research)
			}

			pm := newProductionMonitor(newTestMonitorConfig())
			_, alerts := pm.settleProductionMonitoring(ws, 25)
			if len(alerts) != 0 {
				t.Fatalf("research-mode lab must not raise line alerts, got %v", alertTypes(alerts))
			}
			for _, unwanted := range []model.ProductionAlertType{
				model.AlertTypeBacklog,
				model.AlertTypeInputShortage,
				model.AlertTypeThroughputDrop,
				model.AlertTypeOutputBlocked,
			} {
				if alertTypes(alerts)[unwanted] {
					t.Fatalf("research-mode lab must not raise %s", unwanted)
				}
			}
		})
	}
}

// Power shortage is still a real problem for research stations.
func TestResearchModeLabStillAlertsOnPowerShortage(t *testing.T) {
	ws, lab := newResearchLabTestWorld(t, model.BuildingTypeMatrixLab)
	lab.Runtime.State = model.BuildingWorkNoPower

	pm := newProductionMonitor(newTestMonitorConfig())
	_, alerts := pm.settleProductionMonitoring(ws, 25)
	types := alertTypes(alerts)
	if !types[model.AlertTypePowerShortage] {
		t.Fatalf("expected power_shortage for unpowered research lab, got %v", types)
	}
	for _, unwanted := range []model.ProductionAlertType{
		model.AlertTypeBacklog,
		model.AlertTypeInputShortage,
		model.AlertTypeThroughputDrop,
		model.AlertTypeOutputBlocked,
	} {
		if types[unwanted] {
			t.Fatalf("power-only case must not raise %s, got %v", unwanted, types)
		}
	}
	if len(alerts) == 0 {
		t.Fatal("expected at least one power alert")
	}
	if !strings.Contains(alerts[0].Message, "电力不足") {
		t.Fatalf("expected Chinese power message, got %q", alerts[0].Message)
	}
}

// When a lab is switched to a production recipe, factory-line alerts apply again.
func TestLabWithRecipeStillRaisesInputShortage(t *testing.T) {
	ws, lab := newResearchLabTestWorld(t, model.BuildingTypeMatrixLab)
	lab.Production.RecipeID = "electromagnetic_matrix"
	// Empty storage + zero conveyor throughput → input shortage path.
	if lab.Storage != nil {
		lab.Storage.InputBuffer = nil
		lab.Storage.OutputBuffer = nil
		lab.Storage.Inventory = nil
	}

	pm := newProductionMonitor(newTestMonitorConfig())
	_, alerts := pm.settleProductionMonitoring(ws, 25)
	types := alertTypes(alerts)
	// With throughput>0, empty input buffer and zero conveyor moves, either
	// input_shortage or throughput_drop is expected for a production recipe.
	if !types[model.AlertTypeInputShortage] && !types[model.AlertTypeThroughputDrop] {
		t.Fatalf("production-recipe lab should raise line alerts, got %v", types)
	}
}

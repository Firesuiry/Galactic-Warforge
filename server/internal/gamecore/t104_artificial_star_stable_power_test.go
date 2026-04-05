package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/visibility"
)

func TestT104ArtificialStarRuntimeEventsAndQueryViewsStayConsistentAcrossFuelTicks(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	star := newFuelGeneratorForT099("star-t104", model.BuildingTypeArtificialStar, model.Position{X: 6, Y: 6})
	placeBuilding(ws, star)

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())

	core.processTick()

	assertBuildingRuntimeState(t, star, model.BuildingWorkNoPower, stateReasonNoFuel)
	assertInspectState(t, ql, ws, star.ID, model.BuildingWorkNoPower, stateReasonNoFuel)
	assertSceneState(t, ql, ws, star.ID, model.BuildingWorkNoPower, stateReasonNoFuel)
	if supply := powerNetworkSupplyForBuildingT099(t, ws, star.ID, planetNetworksForT099(t, core, ws)); supply != 0 {
		t.Fatalf("expected no artificial star supply without fuel, got %d", supply)
	}
	if generation := ws.Players["p1"].Stats.EnergyStats.Generation; generation != 0 {
		t.Fatalf("expected no player generation without fuel, got %d", generation)
	}

	ws.Players["p1"].Inventory = model.ItemInventory{model.ItemAntimatterFuelRod: 1}
	transferRes := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": star.ID,
			"item_id":     model.ItemAntimatterFuelRod,
			"quantity":    float64(1),
		},
	})
	if transferRes.Code != model.CodeOK {
		t.Fatalf("transfer antimatter fuel rod: %s (%s)", transferRes.Code, transferRes.Message)
	}

	core.processTick()

	assertBuildingRuntimeState(t, star, model.BuildingWorkRunning, "")
	assertInspectState(t, ql, ws, star.ID, model.BuildingWorkRunning, "")
	assertSceneState(t, ql, ws, star.ID, model.BuildingWorkRunning, "")
	if remaining := star.Storage.OutputQuantity(model.ItemAntimatterFuelRod); remaining != 0 {
		t.Fatalf("expected artificial star fuel storage 0 after the last rod is consumed, got %d", remaining)
	}
	if output := powerInputOutputForBuildingT099(ws, star.ID); output != 80 {
		t.Fatalf("expected artificial star output 80 on the fueled tick, got %d", output)
	}
	if supply := powerNetworkSupplyForBuildingT099(t, ws, star.ID, planetNetworksForT099(t, core, ws)); supply != 80 {
		t.Fatalf("expected artificial star network supply 80 on the fueled tick, got %d", supply)
	}
	if generation := ws.Players["p1"].Stats.EnergyStats.Generation; generation != 80 {
		t.Fatalf("expected player generation 80 on the fueled tick, got %d", generation)
	}

	tickEvents := buildingStateEventsForTick(core, ws.Tick)
	if !hasBuildingStateReasonEvent(tickEvents, star.ID, model.BuildingWorkNoPower, model.BuildingWorkRunning, stateReasonNoFuel, stateReasonStart) {
		t.Fatalf("expected no_power/no_fuel -> running(start) event, got %+v", tickEvents)
	}
	if hasBuildingStateReasonEvent(tickEvents, star.ID, model.BuildingWorkRunning, model.BuildingWorkNoPower, "", stateReasonNoFuel) {
		t.Fatalf("did not expect same-tick running -> no_power/no_fuel fallback, got %+v", tickEvents)
	}

	core.processTick()

	assertBuildingRuntimeState(t, star, model.BuildingWorkNoPower, stateReasonNoFuel)
	assertInspectState(t, ql, ws, star.ID, model.BuildingWorkNoPower, stateReasonNoFuel)
	assertSceneState(t, ql, ws, star.ID, model.BuildingWorkNoPower, stateReasonNoFuel)
	if output := powerInputOutputForBuildingT099(ws, star.ID); output != 0 {
		t.Fatalf("expected no artificial star output after fuel exhaustion, got %d", output)
	}
	if supply := powerNetworkSupplyForBuildingT099(t, ws, star.ID, planetNetworksForT099(t, core, ws)); supply != 0 {
		t.Fatalf("expected no artificial star supply after fuel exhaustion, got %d", supply)
	}
	if generation := ws.Players["p1"].Stats.EnergyStats.Generation; generation != 0 {
		t.Fatalf("expected player generation 0 after fuel exhaustion, got %d", generation)
	}

	tickEvents = buildingStateEventsForTick(core, ws.Tick)
	if !hasBuildingStateReasonEvent(tickEvents, star.ID, model.BuildingWorkRunning, model.BuildingWorkNoPower, "", stateReasonNoFuel) {
		t.Fatalf("expected running -> no_power/no_fuel event after fuel exhaustion, got %+v", tickEvents)
	}
}

func TestT104ArtificialStarConsumesOneFuelRodPerTickAcrossMultipleTicks(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	star := newFuelGeneratorForT099("star-t104-multi", model.BuildingTypeArtificialStar, model.Position{X: 6, Y: 6})
	if _, _, err := star.Storage.Load(model.ItemAntimatterFuelRod, 3); err != nil {
		t.Fatalf("load antimatter fuel rods: %v", err)
	}
	placeBuilding(ws, star)

	for tick := 1; tick <= 3; tick++ {
		core.processTick()

		assertBuildingRuntimeState(t, star, model.BuildingWorkRunning, "")
		expectedRemaining := 3 - tick
		if remaining := star.Storage.OutputQuantity(model.ItemAntimatterFuelRod); remaining != expectedRemaining {
			t.Fatalf("tick %d: expected %d antimatter fuel rods remaining, got %d", tick, expectedRemaining, remaining)
		}
		if output := powerInputOutputForBuildingT099(ws, star.ID); output != 80 {
			t.Fatalf("tick %d: expected artificial star output 80, got %d", tick, output)
		}
		if supply := powerNetworkSupplyForBuildingT099(t, ws, star.ID, planetNetworksForT099(t, core, ws)); supply != 80 {
			t.Fatalf("tick %d: expected artificial star network supply 80, got %d", tick, supply)
		}
		if generation := ws.Players["p1"].Stats.EnergyStats.Generation; generation != 80 {
			t.Fatalf("tick %d: expected player generation 80, got %d", tick, generation)
		}
	}

	core.processTick()

	assertBuildingRuntimeState(t, star, model.BuildingWorkNoPower, stateReasonNoFuel)
	if output := powerInputOutputForBuildingT099(ws, star.ID); output != 0 {
		t.Fatalf("expected no artificial star output after all fuel is exhausted, got %d", output)
	}
	if supply := powerNetworkSupplyForBuildingT099(t, ws, star.ID, planetNetworksForT099(t, core, ws)); supply != 0 {
		t.Fatalf("expected no artificial star network supply after all fuel is exhausted, got %d", supply)
	}
}

func TestT104FuelGeneratorsConsumeOneTickPerFuelAcrossSharedBranch(t *testing.T) {
	tests := []struct {
		name           string
		btype          model.BuildingType
		fuelItem       string
		expectedOutput int
	}{
		{name: "thermal", btype: model.BuildingTypeThermalPowerPlant, fuelItem: model.ItemCoal, expectedOutput: 20},
		{name: "fusion", btype: model.BuildingTypeMiniFusionPowerPlant, fuelItem: model.ItemHydrogenFuelRod, expectedOutput: 40},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			core := newE2ETestCore(t)
			ws := core.World()

			generator := newFuelGeneratorForT099("generator-"+tc.name, tc.btype, model.Position{X: 6, Y: 6})
			if _, _, err := generator.Storage.Load(tc.fuelItem, 1); err != nil {
				t.Fatalf("load %s: %v", tc.fuelItem, err)
			}
			placeBuilding(ws, generator)

			core.processTick()

			assertBuildingRuntimeState(t, generator, model.BuildingWorkRunning, "")
			if remaining := generator.Storage.OutputQuantity(tc.fuelItem); remaining != 0 {
				t.Fatalf("expected %s storage to consume the last fuel on the powered tick, got %d", tc.fuelItem, remaining)
			}
			if output := powerInputOutputForBuildingT099(ws, generator.ID); output != tc.expectedOutput {
				t.Fatalf("expected %s output %d on the fueled tick, got %d", tc.btype, tc.expectedOutput, output)
			}
			if supply := powerNetworkSupplyForBuildingT099(t, ws, generator.ID, planetNetworksForT099(t, core, ws)); supply != tc.expectedOutput {
				t.Fatalf("expected %s network supply %d on the fueled tick, got %d", tc.btype, tc.expectedOutput, supply)
			}

			core.processTick()

			assertBuildingRuntimeState(t, generator, model.BuildingWorkNoPower, stateReasonNoFuel)
			if output := powerInputOutputForBuildingT099(ws, generator.ID); output != 0 {
				t.Fatalf("expected %s output 0 after fuel exhaustion, got %d", tc.btype, output)
			}
		})
	}
}

func assertBuildingRuntimeState(t *testing.T, building *model.Building, wantState model.BuildingWorkState, wantReason string) {
	t.Helper()
	if building.Runtime.State != wantState {
		t.Fatalf("expected building state %s, got %s", wantState, building.Runtime.State)
	}
	if building.Runtime.StateReason != wantReason {
		t.Fatalf("expected building reason %q, got %q", wantReason, building.Runtime.StateReason)
	}
}

func assertInspectState(t *testing.T, ql *query.Layer, ws *model.WorldState, buildingID string, wantState model.BuildingWorkState, wantReason string) {
	t.Helper()
	view, ok := ql.PlanetInspect(ws, "p1", ws.PlanetID, query.PlanetInspectRequest{
		TargetType: "building",
		TargetID:   buildingID,
	})
	if !ok || view == nil || view.Building == nil {
		t.Fatalf("expected inspect view for building %s", buildingID)
	}
	assertBuildingRuntimeState(t, view.Building, wantState, wantReason)
}

func assertSceneState(t *testing.T, ql *query.Layer, ws *model.WorldState, buildingID string, wantState model.BuildingWorkState, wantReason string) {
	t.Helper()
	view, ok := ql.PlanetScene(ws, "p1", ws.PlanetID, query.PlanetSceneRequest{})
	if !ok || view == nil {
		t.Fatalf("expected scene view for planet %s", ws.PlanetID)
	}
	building := view.Buildings[buildingID]
	if building == nil {
		t.Fatalf("expected building %s in scene view", buildingID)
	}
	assertBuildingRuntimeState(t, building, wantState, wantReason)
}

func buildingStateEventsForTick(core *GameCore, tick int64) []*model.GameEvent {
	events, _, _, _ := core.EventHistory().Snapshot([]model.EventType{model.EvtBuildingStateChanged}, "", tick, 50)
	filtered := make([]*model.GameEvent, 0, len(events))
	for _, evt := range events {
		if evt == nil || evt.Tick != tick {
			continue
		}
		filtered = append(filtered, evt)
	}
	return filtered
}

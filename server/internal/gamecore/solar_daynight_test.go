package gamecore

import (
	"encoding/json"
	"testing"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

func addSolarPanel(ws *model.WorldState) *model.Building {
	return addPowerTestBuilding(ws, "sol-1", model.BuildingTypeSolarPanel, model.Position{X: 1, Y: 1})
}

func TestSolarOutputFollowsDayNightCycle(t *testing.T) {
	// One-hour day: 36000 ticks per cycle, noon at the cycle boundary.
	env := mapmodel.PlanetEnvironment{WindFactor: 1, LightFactor: 1, DayLengthHours: 1}
	cases := []struct {
		tick   int64
		output int
	}{
		{0, 12},     // noon: full output
		{4500, 8},   // morning: 12 * cos(pi/4) ~= 8.49 -> 8
		{9000, 0},   // dusk: cos(pi/2) = 0
		{18000, 0},  // midnight: night side
		{27000, 0},  // dawn boundary: cos(3pi/2) = 0
		{36000, 12}, // next noon
	}
	for _, tc := range cases {
		ws := newPowerTestWorld()
		addSolarPanel(ws)
		ws.Tick = tc.tick
		settlePowerGeneration(ws, env)
		input := powerInputFor(ws, "sol-1")
		if tc.output == 0 {
			if input != nil && input.Output != 0 {
				t.Fatalf("tick %d: expected no solar output, got %+v", tc.tick, input)
			}
			continue
		}
		if input == nil || input.Output != tc.output {
			t.Fatalf("tick %d: expected solar output %d, got %+v", tc.tick, tc.output, ws.PowerInputs)
		}
	}
}

func TestSolarTidalLockedPlanetHasConstantOutput(t *testing.T) {
	env := mapmodel.PlanetEnvironment{WindFactor: 1, LightFactor: 1.5, TidalLocked: true, DayLengthHours: 240}
	for _, tick := range []int64{0, 9000, 18000, 4321} {
		ws := newPowerTestWorld()
		addSolarPanel(ws)
		ws.Tick = tick
		settlePowerGeneration(ws, env)
		input := powerInputFor(ws, "sol-1")
		if input == nil || input.Output != 18 {
			t.Fatalf("tick %d: expected constant tidal-locked output 18, got %+v", tick, ws.PowerInputs)
		}
	}
}

func TestSolarOutputConsistentAcrossSaveRestore(t *testing.T) {
	env := mapmodel.PlanetEnvironment{WindFactor: 1, LightFactor: 1, DayLengthHours: 2}

	run := func(ws *model.WorldState, tick int64) int {
		ws.Tick = tick
		ws.PowerInputs = nil
		settlePowerGeneration(ws, env)
		if input := powerInputFor(ws, "sol-1"); input != nil {
			return input.Output
		}
		return 0
	}

	ws := newPowerTestWorld()
	addSolarPanel(ws)
	const tick = 12345
	before := run(ws, tick)

	// Serialize and restore the world, then re-run the same tick: the
	// day/night curve is a pure function of (environment, tick), so the
	// restored world must reproduce identical output.
	data, err := json.Marshal(ws)
	if err != nil {
		t.Fatalf("marshal world: %v", err)
	}
	var restored model.WorldState
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatalf("unmarshal world: %v", err)
	}
	after := run(&restored, tick)

	if before != after {
		t.Fatalf("expected identical output after restore, before=%d after=%d", before, after)
	}
	if before == 0 {
		t.Fatalf("expected non-zero output at tick %d to make the check meaningful", tick)
	}
}

func TestSolarWithoutDayLengthKeepsLegacyConstantOutput(t *testing.T) {
	env := mapmodel.PlanetEnvironment{WindFactor: 1, LightFactor: 1}
	ws := newPowerTestWorld()
	addSolarPanel(ws)
	ws.Tick = 9000
	settlePowerGeneration(ws, env)
	if input := powerInputFor(ws, "sol-1"); input == nil || input.Output != 12 {
		t.Fatalf("expected legacy constant output 12, got %+v", ws.PowerInputs)
	}
}

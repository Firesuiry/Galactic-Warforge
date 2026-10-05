package gamecore

import (
	"math"
	"testing"

	"siliconworld/internal/model"
)

func TestPaceResearchMultipliesCostWithoutChangingCatalog(t *testing.T) {
	core := newE2ETestCore(t)
	core.cfg.Battlefield.PaceResearch = 2
	ws := core.World()
	grantTechs(ws, "p1", "mecha_core")
	lab := setupPerLevelResearchLab(t, core, ws)
	if _, _, err := lab.Storage.Load("coal", 15); err != nil {
		t.Fatal(err)
	}
	if _, _, err := lab.Storage.Load("engine", 5); err != nil {
		t.Fatal(err)
	}
	res, _ := execCommand(core, model.CmdStartResearch, ws, "p1", model.Command{
		Type:    model.CmdStartResearch,
		Payload: map[string]any{"tech_id": "drive_engine"},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("start research: %s (%s)", res.Code, res.Message)
	}
	research := ws.Players["p1"].Tech.CurrentResearch
	if research == nil || research.TotalCost != 40 {
		t.Fatalf("paced TotalCost = %v, want 40", research)
	}
	got := map[string]int{}
	for _, c := range research.RequiredCost {
		got[c.ItemID] = c.Quantity
	}
	if got["coal"] != 30 || got["engine"] != 10 {
		t.Fatalf("paced required cost = %+v", research.RequiredCost)
	}
}

func TestPaceBuildMultipliesConstructionDuration(t *testing.T) {
	core := newE2ETestCore(t)
	core.cfg.Battlefield.PaceBuild = 2
	ws := core.World()
	grantTechs(ws, "p1", "solar_collection")
	grantAllItems(ws, "p1", 100)
	pos, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatal(err)
	}
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Position: pos},
		Payload: map[string]any{"building_type": "solar_panel"},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("build failed: %s (%s)", res.Status, res.Message)
	}
	if ws.Construction == nil || len(ws.Construction.Tasks) != 1 {
		t.Fatalf("expected one construction task, got %+v", ws.Construction)
	}
	for _, task := range ws.Construction.Tasks {
		if task.TotalTicks != 2 || task.RemainingTicks != 2 {
			t.Fatalf("paced construction duration = %d/%d, want 2", task.TotalTicks, task.RemainingTicks)
		}
	}
}

func TestPaceOutputMultipliesRecipeDuration(t *testing.T) {
	ws, b, generator := newProductionPowerFixture()
	ws.PaceOutput = 2
	productionPowerTick(ws, generator, 24)
	if b.Production == nil || b.Production.RemainingTicks != 240 {
		t.Fatalf("paced remaining ticks = %+v, want 240", b.Production)
	}
}

func TestTimeLimitDeclaresScoreAndFreezesSettlement(t *testing.T) {
	core := newE2ETestCore(t)
	core.cfg.Battlefield.TimeLimitTicks = 1
	ws := core.World()
	ws.Players["p1"].Stats.CombatStats.UnitsKilled = 4
	ws.Players["p1"].Stats.CombatStats.BuildingsDestroyed = 1
	ws.Players["p2"].Stats.CombatStats.UnitsKilled = 2

	core.processTick()
	if !core.Finished() {
		t.Fatal("time limit must finish the game")
	}
	victory := core.Victory()
	if victory.WinnerID != "p1" || victory.Reason != model.VictoryReasonTimeLimit {
		t.Fatalf("unexpected time-limit victory: %+v", victory)
	}
	if victory.DeclaredTick != ws.Tick {
		t.Fatalf("declared tick %d != world %d", victory.DeclaredTick, ws.Tick)
	}
	report := core.Settlement()
	if report == nil || report.WinnerID != "p1" || report.Reason != model.VictoryReasonTimeLimit || report.DeclaredTick != victory.DeclaredTick || report.DurationTicks != victory.DeclaredTick {
		t.Fatalf("F2 settlement not frozen: %+v", report)
	}
	found := false
	for _, entry := range report.Players {
		if entry.PlayerID == "p1" && entry.UnitsKilled == 4 && entry.BuildingsDestroyed == 1 {
			found = true
		}
	}
	if !found {
		t.Fatalf("settlement missing p1 combat stats: %+v", report.Players)
	}
	res, _ := core.executeRequest(f2CommandRequest("p1"))
	if len(res) != 1 || res[0].Code != model.CodeGameFinished {
		t.Fatalf("time-limit finish must reject with GAME_FINISHED, got %+v", res)
	}
}

func TestTimeLimitScoreTieBreaksByLossesThenPlayerID(t *testing.T) {
	ws := model.NewWorldState("planet-1-1", 8)
	ws.Players = map[string]*model.PlayerState{
		"p2": {PlayerID: "p2", Stats: model.NewPlayerStats("p2")},
		"p1": {PlayerID: "p1", Stats: model.NewPlayerStats("p1")},
	}
	ws.Players["p1"].Stats.CombatStats.UnitsKilled = 3
	ws.Players["p2"].Stats.CombatStats.UnitsKilled = 3
	ws.Players["p1"].Stats.CombatStats.UnitsLost = 2
	worlds := map[string]*model.WorldState{ws.PlanetID: ws}
	victory := resolveScoreVictory(worlds, model.VictoryRuleElimination)
	if victory.WinnerID != "p2" || victory.Reason != model.VictoryReasonTimeLimit {
		t.Fatalf("fewer losses should win, got %+v", victory)
	}
	ws.Players["p2"].Stats.CombatStats.UnitsLost = 2
	victory = resolveScoreVictory(worlds, model.VictoryRuleElimination)
	if victory.WinnerID != "p1" {
		t.Fatalf("equal score must pick lexicographic player_id, got %+v", victory)
	}
}

func TestSandboxIgnoresTimeLimit(t *testing.T) {
	core := newE2ETestCore(t)
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	core.cfg.Battlefield.TimeLimitTicks = 1
	core.processTick()
	if core.Finished() || core.Settlement() != nil {
		t.Fatalf("sandbox must not finish on time limit, got %+v", core.Victory())
	}
}

func TestEliminationStillBeatsTimeLimit(t *testing.T) {
	core := newE2ETestCore(t)
	core.cfg.Battlefield.TimeLimitTicks = 1
	eliminatePlayerForTest(core.World(), "p2")
	core.processTick()
	victory := core.Victory()
	if victory.WinnerID != "p1" || victory.Reason != model.VictoryReasonElimination {
		t.Fatalf("elimination must win before score, got %+v", victory)
	}
}

func TestThreatGrowthScaleDoublesMeter(t *testing.T) {
	base := threatAfterOneTick(t, 1)
	scaled := threatAfterOneTick(t, 2)
	if base <= 0 {
		t.Fatalf("expected threat accumulation, got %v", base)
	}
	ratio := scaled / base
	if math.Abs(ratio-2) > 0.02 {
		t.Fatalf("scale=2 meter %v vs scale=1 %v, ratio %v", scaled, base, ratio)
	}
}

func threatAfterOneTick(t *testing.T, scale float64) float64 {
	t.Helper()
	core := newE2ETestCore(t)
	core.cfg.Battlefield.ThreatGrowthScale = scale
	core.cfg.Battlefield.EnemyDifficulty = "normal"
	ws := core.World()
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID}
	for i := 0; i < 4; i++ {
		turbine := newBuilding("turbine-pace-"+string(rune('a'+i)), model.BuildingTypeWindTurbine, "p1", model.Position{X: 10 + i, Y: 10})
		turbine.Runtime.State = model.BuildingWorkRunning
		placeBuilding(ws, turbine)
	}
	ws.Tick++
	env := currentPlanetEnvironment(core.maps, ws.PlanetID)
	settlePowerGeneration(ws, env)
	finalizePowerSettlement(ws, nil)
	core.settleEnemyForcesWithGrowth(ws)
	if ws.EnemyForces == nil {
		t.Fatal("missing enemy forces")
	}
	return ws.EnemyForces.ThreatMeter
}

package gamecore

import (
	"testing"
	"time"

	"siliconworld/internal/model"
)

// 3.4 性能基线：单行星 300 单位同时交战的单 tick 结算耗时。
// 预算很宽松（CI 抖动、-race、慢机器都留足余量），只用来拦截数量级的退化。
const massBattleTickBudget = 150 * time.Millisecond

func TestMassBattle300UnitsTickBudget(t *testing.T) {
	if testing.Short() {
		t.Skip("perf baseline skipped in -short")
	}
	ws := model.NewWorldState("mass", 64)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
	ws.Tick = 1

	roster := []model.UnitType{model.UnitTypeSoldier, model.UnitTypeSoldier, model.UnitTypeSoldier, model.UnitTypeMecha, model.UnitTypeArtillery, model.UnitTypeMissileVehicle, model.UnitTypeSupplyTruck}
	// 两个 10x15 方阵相距 3 格，全线接敌。
	n := 0
	for side, owner := range []string{"p1", "p2"} {
		baseX := 20 + side*13
		for col := 0; col < 10; col++ {
			for row := 0; row < 15; row++ {
				u := spawnWorldTestUnit(ws, roster[n%len(roster)], owner, model.Position{X: baseX + col*(1-2*side), Y: 10 + row})
				u.HP, u.MaxHP = 5000, 5000 // 保证整个观测窗口内两军都在交战
				n++
			}
		}
	}
	if len(ws.Units) != 300 {
		t.Fatalf("scene has %d units", len(ws.Units))
	}
	var worst, total time.Duration
	const ticks = 40
	shots := 0
	for i := 0; i < ticks; i++ {
		start := time.Now()
		ws.Tick++
		settleAmmunitionSupply(ws)
		settleUnitMovement(ws)
		events := settleUnitCombat(ws)
		settleCombatRuntime(ws, ws.Tick)
		d := time.Since(start)
		total += d
		if d > worst {
			worst = d
		}
		for _, e := range events {
			if e.EventType == model.EvtDamageApplied {
				shots++
			}
		}
	}
	avg := total / ticks
	t.Logf("300 units: avg=%v worst=%v shots=%d", avg, worst, shots)
	if shots == 0 {
		t.Fatal("scene never engaged; the benchmark measures nothing")
	}
	if avg > massBattleTickBudget {
		t.Fatalf("average tick %v exceeds budget %v", avg, massBattleTickBudget)
	}
}

package gamecore

import (
	"fmt"
	"math/rand"
	"testing"

	"siliconworld/internal/model"
	modelpower "siliconworld/internal/model/power"
)

// 差分测试：命令期供电分配（resolveCommandPowerAllocations）与 tick 期
// model.ResolvePowerAllocations 在随机世界上逐项对比。唯一允许的差异是
// 快照过期时，命令期为“本 tick 没有 PowerInputs 的在役发电机”估算出力。
func TestCommandPowerAllocationsMatchModel(t *testing.T) {
	types := []model.BuildingType{
		model.BuildingTypeWindTurbine,
		model.BuildingTypeSolarPanel,
		model.BuildingTypeThermalPowerPlant,
		model.BuildingTypeRayReceiver,
		model.BuildingTypeTeslaTower,
		model.BuildingTypeAssemblingMachineMk1,
		model.BuildingTypeMatrixLab,
		model.BuildingTypeArcSmelter,
		model.BuildingTypeMiningMachine,
	}
	states := []model.BuildingWorkState{
		model.BuildingWorkRunning, model.BuildingWorkRunning, model.BuildingWorkRunning,
		model.BuildingWorkIdle, model.BuildingWorkPaused, model.BuildingWorkNoPower, model.BuildingWorkError,
	}
	fallbackCases, exactCases := 0, 0
	for seed := int64(0); seed < 400; seed++ {
		rng := rand.New(rand.NewSource(seed))
		ws := model.NewWorldState("p1", 24)
		ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
		n := 2 + rng.Intn(12)
		x, y := 1, 1
		for i := 0; i < n; i++ {
			btype := types[rng.Intn(len(types))]
			b := addPowerTestBuilding(ws, fmt.Sprintf("b-%02d", i), btype, model.Position{X: x, Y: y})
			b.Runtime.State = states[rng.Intn(len(states))]
			if rng.Intn(4) == 0 {
				b.Runtime.Params.PowerPriority = 1 + rng.Intn(120)
			}
			if module := b.Runtime.Functions.Energy; module != nil && len(module.FuelRules) > 0 && b.Storage != nil && rng.Intn(3) > 0 {
				b.Storage.EnsureInventory()[module.FuelRules[0].ItemID] = rng.Intn(4)
			}
			if modelpower.IsPowerGeneratorModule(b.Runtime.Functions.Energy) && rng.Intn(2) == 0 {
				ws.PowerInputs = append(ws.PowerInputs, model.PowerInput{BuildingID: b.ID, OwnerID: "p1", Output: rng.Intn(60)})
			}
			x += 1 + rng.Intn(2)
			if rng.Intn(6) == 0 { // 断开：另起一张电网
				x, y = 1, y+4
			}
			if x > 20 {
				x, y = 1, y+4
			}
		}
		ws.PowerGrid = model.BuildPowerGridGraph(ws)
		coverage := model.ResolvePowerCoverage(ws)

		want := model.ResolvePowerAllocations(ws, coverage)

		// 快照与当前 tick 一致：两套实现必须完全相同。
		ws.PowerSnapshot = &model.PowerSettlementSnapshot{Tick: ws.Tick}
		assertPowerAllocationsEqual(t, seed, "fresh", resolveCommandPowerAllocations(ws, coverage), want)

		// 快照过期（命令期常态：Tick++ 先于命令执行）：仅估算出力不同。
		ws.PowerSnapshot = nil
		got := resolveCommandPowerAllocations(ws, coverage)
		inputs := commandPowerInputsByBuilding(ws.PowerInputs)
		delta := make(map[string]int)
		networks := model.ResolvePowerNetworks(ws)
		for _, network := range networks.Networks {
			for _, id := range network.NodeIDs {
				b := ws.Buildings[id]
				if b == nil || !commandPowerSupplyActive(b) || !modelpower.IsPowerGeneratorModule(b.Runtime.Functions.Energy) || inputs[id] > 0 {
					continue
				}
				delta[network.ID] += estimatedCommandGeneratorOutput(b, b.Runtime.Functions.Energy)
			}
		}
		for id, wantNet := range want.Networks {
			gotNet := got.Networks[id]
			if gotNet == nil {
				t.Fatalf("seed %d: network %s missing in command view", seed, id)
			}
			if gotNet.Supply != wantNet.Supply+delta[id] {
				t.Fatalf("seed %d: network %s supply %d, want model %d + fallback %d", seed, id, gotNet.Supply, wantNet.Supply, delta[id])
			}
			if delta[id] == 0 {
				exactCases++
				if *gotNet != *wantNet {
					t.Fatalf("seed %d: network %s differs without fallback: %+v vs %+v", seed, id, *gotNet, *wantNet)
				}
				for bid, alloc := range want.Buildings {
					if alloc.NetworkID == id && got.Buildings[bid] != alloc {
						t.Fatalf("seed %d: building %s differs without fallback: %+v vs %+v", seed, bid, got.Buildings[bid], alloc)
					}
				}
			} else {
				fallbackCases++
			}
		}
	}
	t.Logf("networks identical: %d, differing only by generator fallback estimate: %d", exactCases, fallbackCases)
	if fallbackCases == 0 || exactCases == 0 {
		t.Fatalf("differential test did not cover both branches (exact=%d fallback=%d)", exactCases, fallbackCases)
	}
}

func assertPowerAllocationsEqual(t *testing.T, seed int64, label string, got, want model.PowerAllocationState) {
	t.Helper()
	if len(got.Networks) != len(want.Networks) || len(got.Buildings) != len(want.Buildings) {
		t.Fatalf("seed %d %s: size mismatch got %d/%d want %d/%d", seed, label, len(got.Networks), len(got.Buildings), len(want.Networks), len(want.Buildings))
	}
	for id, w := range want.Networks {
		if g := got.Networks[id]; g == nil || *g != *w {
			t.Fatalf("seed %d %s: network %s got %+v want %+v", seed, label, id, g, *w)
		}
	}
	for id, w := range want.Buildings {
		if got.Buildings[id] != w {
			t.Fatalf("seed %d %s: building %s got %+v want %+v", seed, label, id, got.Buildings[id], w)
		}
	}
}

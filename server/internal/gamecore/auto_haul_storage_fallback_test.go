package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 试玩 1016 严重 2：自动搬运机器人载着货、全场没有需求时，必须把货送回最近的
// 「能收下这种货的落货建筑」，而不是永久待命。落货点按**功能**判定（有 storage
// 功能、没有生产/采集功能）——补给站在 buildings.yaml 里是 category: production，
// 旧实现只认 logistics 站与 category == storage，于是补给站被漏掉，机器人带着
// 4 铜矿原地 idle 上万 tick。

// demolishAutoBuildingsOfType 移除世界里该类型的所有建筑（测试夹具用）。
func demolishAutoBuildingsOfType(ws *model.WorldState, btype model.BuildingType) {
	ids := make([]string, 0, 2)
	for id, building := range ws.Buildings {
		if building != nil && building.Type == btype {
			ids = append(ids, id)
		}
	}
	for _, id := range ids {
		demolishAutoBuilding(ws, id)
	}
}

// 1) 载 4 铜矿、无需求、附近只有补给站 → 送到补给站，货不丢。
func TestAutoHaulCargoReturnsToSupplyStation(t *testing.T) {
	f := newAutoHaulFixture(t)
	// 拆掉夹具里的储物仓与开局 HQ（否则最近的落货点是它们，测不到补给站）。
	demolishAutoBuilding(f.ws, f.depot.ID)
	demolishAutoBuildingsOfType(f.ws, model.BuildingTypeBattlefieldAnalysisBase)
	station := placeAutoBuilding(t, f.ws, "b-supply", model.BuildingTypeSupplyStation, model.Position{X: 36, Y: 30})
	robot := autoRobot(t, f.ws, model.Position{X: 30, Y: 20})
	robot.Haul.Load(model.ItemCopperOre, 4)

	advanceAutoTicks(f.core, f.ws, 1200)

	if got := haulStored(station, model.ItemCopperOre); got != 4 {
		t.Fatalf("补给站应收到 4 铜矿，got %d (robot haul=%+v)", got, robot.Haul)
	}
	if robot.Haul.CargoQuantity() != 0 {
		t.Fatalf("货应已卸完，got %+v", robot.Haul.Cargo)
	}
	if robot.Haul.DeliveredTotal != 4 {
		t.Fatalf("delivered_total = %d, want 4", robot.Haul.DeliveredTotal)
	}
	// 卸完回到自动待命，等下一次派单。
	if robot.Haul.ToBuildingID != "" || robot.Haul.Phase != model.HaulPhaseIdle {
		t.Fatalf("送达后应回到空闲待命，got %+v", robot.Haul)
	}
}

// 2) 落货点判定按功能而不是 category 字符串：补给站 / 战场分析基站是落货点，
//    熔炉、装配机、采矿机、研究站不是（它们有自己的产出）。
func TestHaulStorageSinkUsesFunctionsNotCategory(t *testing.T) {
	_, ws := haulTestCoreWithFace(t, 48)
	sinkTypes := []model.BuildingType{
		model.BuildingTypeDepotMk1,
		model.BuildingTypeStorageTank,
		model.BuildingTypeSupplyStation,
		model.BuildingTypeBattlefieldAnalysisBase,
		model.BuildingTypePlanetaryLogisticsStation,
	}
	for i, btype := range sinkTypes {
		b := placeAutoBuilding(t, ws, "sink-"+itoa(i), btype, model.Position{X: 4 + i*6, Y: 4})
		if !haulIsStorageSink(b) {
			t.Fatalf("%s 应可作为落货点（有 storage、无生产/采集功能）", btype)
		}
	}
	notSinks := []model.BuildingType{
		model.BuildingTypeArcSmelter,
		model.BuildingTypeAssemblingMachineMk1,
		model.BuildingTypeMiningMachine,
		model.BuildingTypeMatrixLab,
	}
	for i, btype := range notSinks {
		b := placeAutoBuilding(t, ws, "producer-"+itoa(i), btype, model.Position{X: 4 + i*6, Y: 24})
		if haulIsStorageSink(b) {
			t.Fatalf("%s 有生产/采集功能，不应作为落货点", btype)
		}
	}
}

// 3) 所有落货点都满 / 没有落货点时：货留在车上、不丢、不每 tick 全图扫描；
//    腾出空间后下一次派单自动送达。
func TestAutoHaulCargoRetriesWhenNoStorageAccepts(t *testing.T) {
	f := newAutoHaulFixture(t)
	// 拆掉夹具里的储物仓与开局 HQ（否则它们才是最近落货点），只留补给站并把它填满。
	demolishAutoBuilding(f.ws, f.depot.ID)
	demolishAutoBuildingsOfType(f.ws, model.BuildingTypeBattlefieldAnalysisBase)
	station := placeAutoBuilding(t, f.ws, "b-supply", model.BuildingTypeSupplyStation, model.Position{X: 36, Y: 30})
	robot := autoRobot(t, f.ws, model.Position{X: 30, Y: 20})
	robot.Haul.Load(model.ItemCopperOre, 4)
	// 把补给站填满：主库存顶到容量、输入缓冲也塞满（PreviewReceive 两处都不收）。
	station.Storage.EnsureInventory()[model.ItemStoneOre] = station.Storage.Capacity
	if cap := station.Storage.InputBufferCapacity(); cap > 0 {
		station.Storage.EnsureInputBuffer()[model.ItemStoneOre] = cap
	}
	if accepted, _ := haulDepositPreview(station, model.ItemCopperOre, 4); accepted > 0 {
		t.Fatalf("补给站应已满，got accepted=%d", accepted)
	}

	advanceAutoTicks(f.core, f.ws, 600)
	if robot.Haul.CargoQuantity() != 4 || robot.Haul.Cargo.ItemID != model.ItemCopperOre {
		t.Fatalf("无处可送时货必须留在车上，got %+v", robot.Haul.Cargo)
	}
	if robot.Haul.ToBuildingID != "" {
		t.Fatalf("无处可送时不应有任务，got %+v", robot.Haul)
	}
	if got := haulStored(station, model.ItemCopperOre); got != 0 {
		t.Fatalf("已满的补给站不该收货，got %d", got)
	}

	// 腾出空间：下一次派单 tick 应自动送货。
	station.Storage.EnsureInventory()[model.ItemStoneOre] = 0
	if station.Storage.InputBuffer != nil {
		station.Storage.InputBuffer[model.ItemStoneOre] = 0
	}
	advanceAutoTicks(f.core, f.ws, 1200)
	if got := haulStored(station, model.ItemCopperOre); got != 4 {
		t.Fatalf("腾出空间后应送达补给站，got %d (robot haul=%+v)", got, robot.Haul)
	}
	if robot.Haul.CargoQuantity() != 0 {
		t.Fatalf("送达后车上应清空，got %+v", robot.Haul.Cargo)
	}
}

// 4) 有需求时仍优先服务需求，回仓只是兜底。
func TestAutoHaulCargoPrefersDemandOverStorage(t *testing.T) {
	f := newAutoHaulFixture(t)
	demolishAutoBuilding(f.ws, f.depot.ID)
	demolishAutoBuildingsOfType(f.ws, model.BuildingTypeBattlefieldAnalysisBase)
	station := placeAutoBuilding(t, f.ws, "b-supply", model.BuildingTypeSupplyStation, model.Position{X: 36, Y: 30})
	smelter := placeAutoSmelter(t, f.ws, "b-copper-smelter", model.Position{X: 36, Y: 10})
	smelter.Production.RecipeID = "smelt_copper"
	smelter.SyncStorageReserve()
	robot := autoRobot(t, f.ws, model.Position{X: 30, Y: 20})
	robot.Haul.Load(model.ItemCopperOre, 4)

	// 只在送达那一刻采样：熔炉收到铜矿后会立刻投产，长跑后库存会被消耗成 0。
	delivered := 0
	for i := 0; i < 1200; i++ {
		advanceAutoTicks(f.core, f.ws, 1)
		if got := haulStored(smelter, model.ItemCopperOre); got > delivered {
			delivered = got
		}
		if robot.Haul.CargoQuantity() == 0 {
			break
		}
	}
	if delivered == 0 {
		t.Fatalf("熔炉缺铜矿时应优先送熔炉，got 0 (station=%d, robot=%+v)", haulStored(station, model.ItemCopperOre), robot.Haul)
	}
}

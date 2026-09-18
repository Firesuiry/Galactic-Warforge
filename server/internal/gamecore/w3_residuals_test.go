package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
)

// --- W3 residuals: geothermal placement, exchanger mode command, turret alt
// ammo, logistics bot research gate + flight budget, loot->hidden research ---

// TestGeothermalBuildRequiresLavaProximity 建造校验：地热电站必须落在岩浆格
// 或岩浆邻接格；裸地拒绝，岩浆格本身放行。
func TestGeothermalBuildRequiresLavaProximity(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "geothermal")
	grantAllItems(ws, "p1", 100)
	player := ws.Players["p1"]
	player.Resources.Minerals = 10000
	player.Resources.Energy = 10000

	pos, err := findOpenTile(ws, 2)
	if err != nil || pos == nil {
		t.Fatalf("find open tile: %v", err)
	}

	// 保证目标格周围没有任何岩浆（布景确定化）。
	clearRing := func(center model.Position, r int) {
		for dy := -r; dy <= r; dy++ {
			for dx := -r; dx <= r; dx++ {
				x, y := center.X+dx, center.Y+dy
				if ws.InBounds(x, y) {
					ws.Grid[y][x].Terrain = terrain.TileBuildable
				}
			}
		}
	}
	clearRing(*pos, 3)

	buildGeo := func(target model.Position) model.CommandResult {
		res, _ := core.execBuild(ws, "p1", model.Command{
			Type:   model.CmdBuild,
			Target: model.CommandTarget{Position: &target},
			Payload: map[string]any{
				"building_type": string(model.BuildingTypeGeothermalPowerStation),
			},
		})
		return res
	}

	// 裸地：拒绝。
	res := buildGeo(*pos)
	if res.Status != model.StatusFailed || res.Code != model.CodeInvalidTarget {
		t.Fatalf("geothermal on bare ground must fail with INVALID_TARGET, got %+v", res)
	}

	// 岩浆邻接：放行。
	lavaAdj := model.Position{X: pos.X + 1, Y: pos.Y}
	if !ws.InBounds(lavaAdj.X, lavaAdj.Y) {
		t.Fatalf("adjacent tile out of bounds: %+v", lavaAdj)
	}
	ws.Grid[lavaAdj.Y][lavaAdj.X].Terrain = terrain.TileLava
	res = buildGeo(*pos)
	if res.Status != model.StatusExecuted {
		t.Fatalf("geothermal adjacent to lava must be accepted, got %+v", res)
	}

	// 直接建在岩浆格上：放行（其他建筑类型仍然拒绝岩浆格）。
	res = buildGeo(lavaAdj)
	if res.Status != model.StatusExecuted {
		t.Fatalf("geothermal on lava tile must be accepted, got %+v", res)
	}

	// 对照：普通建筑不可建在岩浆格上。
	grantTechs(ws, "p1", "solar_collection")
	solarSpot := model.Position{X: pos.X, Y: pos.Y + 1}
	if ws.InBounds(solarSpot.X, solarSpot.Y) {
		ws.Grid[solarSpot.Y][solarSpot.X].Terrain = terrain.TileLava
		resSolar, _ := core.execBuild(ws, "p1", model.Command{
			Type:   model.CmdBuild,
			Target: model.CommandTarget{Position: &solarSpot},
			Payload: map[string]any{
				"building_type": string(model.BuildingTypeSolarPanel),
			},
		})
		if resSolar.Status != model.StatusFailed || resSolar.Code != model.CodeInvalidTarget {
			t.Fatalf("solar panel on lava must be rejected, got %+v", resSolar)
		}
	}
}

// TestSetEnergyExchangerModeCommand 蓄电器能量枢纽三态切换 + 非法值/目标拒绝。
func TestSetEnergyExchangerModeCommand(t *testing.T) {
	ws, exchanger := newExchangerTestWorld()
	core := &GameCore{}
	module := exchanger.Runtime.Functions.EnergyExchanger
	if module == nil {
		t.Fatal("fixture exchanger missing energy exchanger module")
	}

	setMode := func(playerID, buildingID, mode string) model.CommandResult {
		payload := map[string]any{}
		if buildingID != "" {
			payload["building_id"] = buildingID
		}
		if mode != "" {
			payload["mode"] = mode
		}
		res, _ := core.execSetEnergyExchangerMode(ws, playerID, model.Command{
			Type:    model.CmdSetEnergyExchangerMode,
			Payload: payload,
		})
		return res
	}

	// 三态切换全部生效。
	for _, mode := range []model.EnergyExchangerMode{
		model.EnergyExchangerModeCharge,
		model.EnergyExchangerModeDischarge,
		model.EnergyExchangerModeStandby,
	} {
		res := setMode("p1", exchanger.ID, string(mode))
		if res.Code != model.CodeOK || module.Mode != mode {
			t.Fatalf("mode %s switch failed: %+v (module mode %s)", mode, res, module.Mode)
		}
	}

	// 非法值拒绝且不改变当前模式。
	if res := setMode("p1", exchanger.ID, "bogus"); res.Code != model.CodeValidationFailed || module.Mode != model.EnergyExchangerModeStandby {
		t.Fatalf("invalid mode must be rejected without state change: %+v (module mode %s)", res, module.Mode)
	}

	// 缺 payload 字段。
	if res := setMode("p1", "", "charge"); res.Code != model.CodeValidationFailed {
		t.Fatalf("missing building_id must fail validation, got %+v", res)
	}
	if res := setMode("p1", exchanger.ID, ""); res.Code != model.CodeValidationFailed {
		t.Fatalf("missing mode must fail validation, got %+v", res)
	}

	// 建筑不存在 / 非拥有者 / 非蓄电器。
	if res := setMode("p1", "ghost-building", "charge"); res.Code != model.CodeEntityNotFound {
		t.Fatalf("missing building must return ENTITY_NOT_FOUND, got %+v", res)
	}
	if res := setMode("p2", exchanger.ID, "charge"); res.Code != model.CodeNotOwner {
		t.Fatalf("foreign building must return NOT_OWNER, got %+v", res)
	}
	if res := setMode("p1", "gen-1", "charge"); res.Code != model.CodeValidationFailed {
		t.Fatalf("non-exchanger building must fail validation, got %+v", res)
	}
}

// TestSetEnergyExchangerModeCommandDispatch 经命令分发链（case 接线）落地模式切换。
func TestSetEnergyExchangerModeCommandDispatch(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	exchanger := newBuilding("ex-dispatch", model.BuildingTypeEnergyExchanger, "p1", model.Position{X: 7, Y: 7})
	placeBuilding(ws, exchanger)

	res := issueInternalCommand(core, "p1", model.Command{
		Type:    model.CmdSetEnergyExchangerMode,
		Payload: map[string]any{"building_id": exchanger.ID, "mode": "discharge"},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("dispatch of set_energy_exchanger_mode failed: %+v", res)
	}
	if got := exchanger.Runtime.Functions.EnergyExchanger.Mode; got != model.EnergyExchangerModeDischarge {
		t.Fatalf("mode not applied through dispatch, got %s", got)
	}
}

// TestGaussTurretFallsBackToTitaniumAmmo 高斯塔主弹仓耗尽时回退钛弹药，
// 按 AltAmmoAttack 计伤；主弹药充足时优先消耗主弹药。
func TestGaussTurretFallsBackToTitaniumAmmo(t *testing.T) {
	t.Run("fallback", func(t *testing.T) {
		ws, unit := mechaTestWorld()
		turret := newGaussTurret(ws, "t-alt", "p2", model.Position{X: 2, Y: 1})
		combat := turret.Runtime.Functions.Combat
		// 主弹仓为空，只装钛弹药。
		if _, _, err := turret.Storage.Load(model.ItemTitaniumAmmo, 2); err != nil {
			t.Fatalf("load titanium ammo: %v", err)
		}

		events := settleTurrets(ws)

		wantTotal := max(1, combat.AltAmmoAttack-unit.Defense)
		found := false
		for _, evt := range events {
			if evt.EventType != model.EvtDamageApplied || evt.Payload["target_id"] != unit.ID {
				continue
			}
			found = true
			damage, _ := evt.Payload["damage"].(int)
			absorbed, _ := evt.Payload["shield_absorbed"].(int)
			if damage+absorbed != wantTotal {
				t.Fatalf("alt ammo damage = %d (+%d absorbed), want %d", damage, absorbed, wantTotal)
			}
		}
		if !found {
			t.Fatalf("expected turret to fire on titanium fallback, events=%+v", events)
		}
		if got := turret.Storage.ItemQuantity(model.ItemTitaniumAmmo); got != 1 {
			t.Fatalf("expected 1 titanium ammo consumed, %d left", got)
		}
		if turret.Runtime.StateReason == "no_ammunition" {
			t.Fatal("titanium fallback must not report no_ammunition")
		}
	})

	t.Run("primary preferred", func(t *testing.T) {
		ws, unit := mechaTestWorld()
		turret := newGaussTurret(ws, "t-pri", "p2", model.Position{X: 2, Y: 1})
		combat := turret.Runtime.Functions.Combat
		if _, _, err := turret.Storage.Load(model.ItemAmmoBullet, 1); err != nil {
			t.Fatalf("load bullets: %v", err)
		}
		// 单槽弹仓装不下第二种弹药；两种弹药直接布景进同一弹匣的不同桶。
		turret.Storage.EnsureInventory()[model.ItemAmmoBullet] = 1
		turret.Storage.OutputBuffer = model.ItemInventory{model.ItemTitaniumAmmo: 2}

		events := settleTurrets(ws)

		wantTotal := max(1, combat.Attack-unit.Defense)
		found := false
		for _, evt := range events {
			if evt.EventType != model.EvtDamageApplied || evt.Payload["target_id"] != unit.ID {
				continue
			}
			found = true
			damage, _ := evt.Payload["damage"].(int)
			absorbed, _ := evt.Payload["shield_absorbed"].(int)
			if damage+absorbed != wantTotal {
				t.Fatalf("primary ammo damage = %d (+%d absorbed), want %d", damage, absorbed, wantTotal)
			}
		}
		if !found {
			t.Fatalf("expected turret to fire with primary ammo, events=%+v", events)
		}
		if got := turret.Storage.ItemQuantity(model.ItemAmmoBullet); got != 0 {
			t.Fatalf("expected primary ammo consumed first, %d left", got)
		}
		if got := turret.Storage.ItemQuantity(model.ItemTitaniumAmmo); got != 2 {
			t.Fatalf("titanium ammo must stay untouched while primary available, %d left", got)
		}
	})
}

// TestInstallLogisticsBotRequiresResearch 机器人安装需配送物流科技门控。
func TestInstallLogisticsBotRequiresResearch(t *testing.T) {
	ws, home, _ := distributorTestWorld(t)
	player := ws.Players["p1"]
	player.Inventory[model.ItemLogisticsBot] = 2
	core := &GameCore{}
	cmd := model.Command{Target: model.CommandTarget{EntityID: home.ID}, Payload: map[string]any{"quantity": 1}}

	res, _ := core.execInstallLogisticsBot(ws, "p1", cmd)
	if res.Status != model.StatusFailed || res.Code != model.CodeValidationFailed {
		t.Fatalf("install without research must fail validation, got %+v", res)
	}
	if len(ws.LogisticsBots) != 0 || player.Inventory[model.ItemLogisticsBot] != 2 {
		t.Fatalf("rejected install must not consume items or register bots: %+v", ws.LogisticsBots)
	}

	grantTechs(ws, "p1", "distribution_logistics")
	res, _ = core.execInstallLogisticsBot(ws, "p1", cmd)
	if res.Code != model.CodeOK || len(ws.LogisticsBots) != 1 {
		t.Fatalf("install with distribution_logistics must succeed: %+v", res)
	}
}

// TestLogisticsBotValidateAllowsTechExtendedFlightBudget 远程航班预付能量上限
// 按配送范围科技推导（2*(12+5*5)=74），不再是硬编码 24。
func TestLogisticsBotValidateAllowsTechExtendedFlightBudget(t *testing.T) {
	if model.MaxLogisticsBotFlightEnergy != 74 {
		t.Fatalf("flight budget ceiling must derive to 2*(12+5*5)=74, got %d", model.MaxLogisticsBotFlightEnergy)
	}

	home := model.Position{X: 1, Y: 1}
	target := model.Position{X: 30, Y: 30}
	bot := model.NewLogisticsBotState("bot-long", "d1", home)
	bot.OwnerID = "p1"
	bot.TargetPos = &target
	bot.TargetKind = "distributor"
	bot.TargetID = "d2"
	bot.TripKind = "delivery"
	bot.PickupItemID = model.ItemIronOre
	bot.PickupQuantity = 1
	bot.Status = model.LogisticsDroneInFlight

	bot.EnergyCost = model.MaxLogisticsBotFlightEnergy
	bot.EnergyRemaining = model.MaxLogisticsBotFlightEnergy
	if err := bot.Validate(); err != nil {
		t.Fatalf("max-range flight budget must validate: %v", err)
	}

	bot.EnergyCost = model.MaxLogisticsBotFlightEnergy + 1
	bot.EnergyRemaining = model.MaxLogisticsBotFlightEnergy + 1
	if err := bot.Validate(); err == nil {
		t.Fatal("flight budget above the tech-derived ceiling must be rejected")
	}
}

// TestDarkFogLootRevealsHiddenResearch 黑雾掉落 → 隐藏科技揭示 → 研究入队全链：
// 击杀 hive 掉落 dark_fog_matrix 入击杀者背包，隐藏科技随之可见；
// 矩阵经 transfer_item 进入研究站库存后 execStartResearch 返回 OK。
func TestDarkFogLootRevealsHiddenResearch(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	ws.Tick = 10
	grantTechs(ws, "p1", "information_matrix") // dark_fog_matrix 前置
	player := ws.Players["p1"]

	lab := newBuilding("lab-loot-chain", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	lab.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, lab)

	// 击杀 hive：dark_fog_matrix 必掉，进入击杀者玩家背包。
	spawnLootKillerUnit(core, ws, "p1", model.Position{X: 2, Y: 2})
	spawnLootTestForce(ws, "hive-research", model.EnemyForceTypeHive, 10, model.Position{X: 3, Y: 2})
	core.settleCombat()
	if len(ws.EnemyForces.Forces) != 0 {
		t.Fatalf("hive should be destroyed, remaining %+v", ws.EnemyForces.Forces)
	}
	looted := player.Inventory[model.ItemDarkFogMatrix]
	if looted < 1 {
		t.Fatalf("dark_fog_matrix must reach killer inventory, got %d", looted)
	}

	cmd := model.Command{
		Type:    model.CmdStartResearch,
		Payload: map[string]any{"tech_id": "dark_fog_matrix"},
	}

	// 持有触发物品后隐藏科技已揭示；但研究站库存尚无矩阵，不能入队。
	res, _ := core.execStartResearch(ws, "p1", cmd)
	if res.Code == model.CodeOK {
		t.Fatal("research must wait for matrices in lab storage")
	}
	if strings.Contains(res.Message, "hidden") {
		t.Fatalf("looted trigger item must reveal the hidden tech, got %q", res.Message)
	}

	// 把掉落矩阵转入研究站：全链闭合，研究入队。
	tres, _ := core.execTransferItem(ws, "p1", model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": lab.ID,
			"item_id":     model.ItemDarkFogMatrix,
			"quantity":    looted,
		},
	})
	if tres.Code != model.CodeOK {
		t.Fatalf("transfer looted matrices into lab failed: %+v", tres)
	}
	res, _ = core.execStartResearch(ws, "p1", cmd)
	if res.Code != model.CodeOK {
		t.Fatalf("loot-derived dark_fog_matrix must start hidden research: %s (%s)", res.Code, res.Message)
	}
	if player.Tech.CurrentResearch == nil || player.Tech.CurrentResearch.TechID != "dark_fog_matrix" {
		t.Fatalf("research not queued: %+v", player.Tech.CurrentResearch)
	}
}

package gamecore

import (
	"siliconworld/internal/model"
	"sort"
)

// botIndustry plans one real player command. Materials stay in their owning
// inventory until transfer, crafting or production consumes them.
func (gc *GameCore) botIndustry(ws *model.WorldState, owner string, tuning botTuning, ctx *botSurvey, issue func(model.Command) bool) bool {
	if ctx.executor == nil || ctx.executor.Mecha == nil {
		return false
	}
	if ctx.executor.Mecha.Energy*2 < ctx.executor.Mecha.MaxEnergy || ws.Players[owner].Inventory[model.ItemCoal] < 40 {
		return false
	}
	if ctx.powerCount < tuning.powerTarget || ctx.minerCount < tuning.minerTarget {
		return false
	}
	for _, typ := range []model.BuildingType{model.BuildingTypeTeslaTower, "barracks", "supply_station"} {
		if botBuildingOfType(ctx, typ) != nil {
			continue
		}
		if cmd, ok := gc.botEnsureBuilding(ws, owner, ctx, typ, "", map[string]bool{}); ok {
			return issue(cmd)
		}
		return false
	}
	if cmd, ok := gc.botPowerLink(ws, owner, ctx); ok {
		return issue(cmd)
	}
	// Supply stations and turrets use the same manufactured ammunition.
	for _, b := range ctx.buildings {
		ammo := ""
		if b.Type == "supply_station" {
			ammo = "ammo_bullet"
		}
		if c := b.Runtime.Functions.Combat; c != nil {
			ammo = c.AmmoItem
		}
		if ammo == "" || b.Storage == nil || b.Storage.ItemQuantity(ammo) >= 60 {
			continue
		}
		if cmd, ok := gc.botFeedBuilding(ws, owner, ctx, b, ammo, 60-b.Storage.ItemQuantity(ammo)); ok {
			return issue(cmd)
		}
	}
	// 冶炼产线：矿石→锭/磁铁必须由电弧熔炉做，否则全部落在机甲手搓上——
	// 一台机甲既是采矿车又是唯一的冶炼厂，矩阵链永远供不上
	// （试玩报告 D：bot 的电磁学要 7000+ tick 才开工）。
	if cmd, ok := gc.botSmelters(ws, owner, ctx, tuning); ok {
		return issue(cmd)
	}
	// 矩阵产线（磁线圈/电路板专机 + 矩阵专机）要在研究站之前就位：
	// 全靠机甲手搓时，20 个矩阵要 7000+ tick 纯手搓时间（每矩阵约 360 tick），
	// 电磁学永远赶不上首攻（试玩报告 D：tick 8000 后发育冻结）。
	if cmd, ok := gc.botMatrixLine(ws, owner, ctx, tuning); ok {
		return issue(cmd)
	}
	// 研究站是整条科技链的前提：没有它矩阵备料无处可去，科技永远开不了
	// （试玩报告 D：bot 在 tick 8000 后发育冻结）。放在 botIndustry 而不是
	// botResearch，是因为 botResearch 在决策链末尾、命令槽位会被前面吃光。
	if ctx.labCount == 0 && botPendingBuilds(ws, owner, model.BuildingTypeMatrixLab) == 0 {
		if cmd, ok := gc.botEnsureBuilding(ws, owner, ctx, model.BuildingTypeMatrixLab, "", map[string]bool{}); ok {
			return issue(cmd)
		}
	}
	// Keep the basic army fed before investing in advanced vehicles.
	for _, producer := range ctx.producers {
		for _, cost := range model.UnitCost(model.UnitTypeSoldier) {
			if producer.Type != "barracks" || producer.Storage.ItemQuantity(cost.ItemID) >= cost.Quantity*3 {
				continue
			}
			need := cost.Quantity*3 - producer.Storage.ItemQuantity(cost.ItemID)
			if cmd, ok := gc.botFeedBuilding(ws, owner, ctx, producer, cost.ItemID, need); ok {
				return issue(cmd)
			}
		}
	}
	// 备料量按本局 pace_research 缩放后的主攻科技成本计算（与结算一致），
	// 否则高倍率下 bot 会以为 20 个矩阵就够、反复发起开不了的 research。
	// 单台研究站缓存上限 96（matrix_lab storage.capacity），超过就取上限。
	// 这里的补料必须让位给"缺料时的手搓/采矿"：矩阵进研究站是终点，
	// 而机甲手搓磁铁/电路板/磁线圈才是研究站真正等的东西。
	reserve := botResearchMatrixReserve(ws.Players[owner], tuning)
	labShort := false
	for _, lab := range ctx.buildings {
		if lab.Type != model.BuildingTypeMatrixLab || lab.Production != nil && lab.Production.RecipeID != "" {
			continue
		}
		target := reserve
		if lab.Storage.Capacity > 0 && target > lab.Storage.Capacity {
			target = lab.Storage.Capacity
		}
		if lab.Storage.OutputQuantity(model.ItemElectromagneticMatrix) < target {
			labShort = true
		}
	}
	// 研究站缺矩阵：送料（弹药槽位若排在前面，会每拍抢走唯一的一条命令，
	// 研究站永远等不到矩阵——试玩报告 D 的根因）。
	if labShort {
		if cmd, ok := gc.botMatrixReserve(ws, owner, ctx, tuning, reserve); ok {
			return issue(cmd)
		}
	}
	// 研究站缺矩阵时的补料已在上面的 labShort 分支处理（优先级高于弹药/兵力备料）。
	for _, typ := range []model.BuildingType{model.BuildingTypeMatrixLab, "vehicle_factory", "airfield"} {
		if !CanBuildTech(ws.Players[owner], model.TechUnlockBuilding, string(typ)) || botBuildingOfType(ctx, typ) != nil {
			continue
		}
		if cmd, ok := gc.botEnsureBuilding(ws, owner, ctx, typ, "", map[string]bool{}); ok {
			return issue(cmd)
		}
	}
	for _, producer := range ctx.producers {
		for _, typ := range botArmyPreference(ctx, tuning) {
			spec, _ := model.UnitDefinitionByID(typ)
			if spec.Producer != producer.Type {
				continue
			}
			for _, cost := range spec.Cost {
				if producer.Storage.ItemQuantity(cost.ItemID) >= cost.Quantity*2 {
					continue
				}
				if cmd, ok := gc.botFeedBuilding(ws, owner, ctx, producer, cost.ItemID, cost.Quantity*2-producer.Storage.ItemQuantity(cost.ItemID)); ok {
					return issue(cmd)
				}
			}
		}
	}
	return false
}

func botBuildingOfType(ctx *botSurvey, typ model.BuildingType) *model.Building {
	for _, b := range ctx.buildings {
		if b.Type == typ {
			return b
		}
	}
	return nil
}

// botMatrixLine 研究矩阵专用产线：矩阵专机 + 前置（磁线圈/电路板）专机，
// 前置专机也缺料时沿缺料链下钻（熔炉→采矿），必要时让机甲手搓补位。
// 与研究站/研究命令解耦，先于它们执行，保证科技链不断料。
func (gc *GameCore) botMatrixLine(ws *model.WorldState, owner string, ctx *botSurvey, tuning botTuning) (model.Command, bool) {
	if tuning.matrixMachineTarget <= 0 {
		return model.Command{}, false
	}
	if pending := botPendingMatrixMachines(ws, owner); len(matrixMachines(ctx))+pending < tuning.matrixMachineTarget {
		if cmd, ok := gc.botEnsureBuilding(ws, owner, ctx, model.BuildingTypeAssemblingMachineMk1, model.ItemElectromagneticMatrix, map[string]bool{}); ok {
			return cmd, true
		}
	}
	for _, input := range botMatrixInputRecipes() {
		if botDedicatedAssembler(ctx, input) {
			continue
		}
		if cmd, ok := gc.botEnsureBuilding(ws, owner, ctx, model.BuildingTypeAssemblingMachineMk1, input, map[string]bool{}); ok {
			return cmd, true
		}
	}
	// 专机就位后按缺口补料（缺料会下钻到熔炉/采矿/手搓）。
	for _, recipeID := range append([]string{model.ItemElectromagneticMatrix}, botMatrixInputRecipes()...) {
		r, ok := model.Recipe(recipeID)
		if !ok {
			continue
		}
		for _, b := range ctx.assemblers {
			if b.Production == nil || b.Production.RecipeID != recipeID {
				continue
			}
			for _, input := range r.Inputs {
				need := input.Quantity*8 - b.Storage.ItemQuantity(input.ItemID)
				if need <= 0 {
					continue
				}
				if cmd, ok := gc.botEnsureItem(ws, owner, ctx, input.ItemID, need, map[string]bool{}); ok {
					return cmd, true
				}
			}
		}
	}
	return model.Command{}, false
}

// botMatrixReserve 研究站缺矩阵时优先走这条路：先确保矩阵产线本身在跑
// （专用制造台 + 前置料），再补研究站库存，最后才轮到机甲手搓。
// 与 botIndustry 后面的"常规补料"分开，是为了让缺矩阵时的优先级
// 高于弹药/兵力备料——否则弹药补货每拍抢走唯一的一条命令，
// 矩阵链永远供不上（试玩报告 D 的根因）。
func (gc *GameCore) botMatrixReserve(ws *model.WorldState, owner string, ctx *botSurvey, tuning botTuning, reserve int) (model.Command, bool) {
	// 矩阵产线本身由 botMatrixLine 保证（先于本函数执行）。
	// 矩阵有货：送进研究站。
	for _, lab := range ctx.buildings {
		if lab.Type != model.BuildingTypeMatrixLab || lab.Production != nil && lab.Production.RecipeID != "" {
			continue
		}
		target := reserve
		if lab.Storage.Capacity > 0 && target > lab.Storage.Capacity {
			target = lab.Storage.Capacity
		}
		if lab.Storage.OutputQuantity(model.ItemElectromagneticMatrix) >= target {
			continue
		}
		if cmd, ok := gc.botFeedBuilding(ws, owner, ctx, lab, model.ItemElectromagneticMatrix, target); ok {
			return cmd, true
		}
	}
	// 都没有：走常规缺料链（botEnsureItem 会选配方/建产线/手搓/采矿）。
	if cmd, ok := gc.botEnsureItem(ws, owner, ctx, model.ItemElectromagneticMatrix, reserve, map[string]bool{}); ok {
		return cmd, true
	}
	return model.Command{}, false
}

// botSmelters 冶炼产线建设：铁/铜/磁铁各一台电弧熔炉，按缺口补。
// 不建熔炉时，bot 只能靠机甲手搓把矿石变成锭，产能远远不够
// （试玩报告 D：电磁学要 7000+ tick 才开工）。
//
// 只建"现在付得起"的炉子，绝不追着备料：熔炉只是手段，若为了它把机甲
// 绑在采铜上，研究站/矩阵专机反而永远排不上（botIndustry 每拍只出一条命令）。
func (gc *GameCore) botSmelters(ws *model.WorldState, owner string, ctx *botSurvey, tuning botTuning) (model.Command, bool) {
	if tuning.smelterTarget <= 0 {
		return model.Command{}, false
	}
	player := ws.Players[owner]
	built := 0
	for _, b := range ctx.buildings {
		if b.Type == model.BuildingTypeArcSmelter {
			built++
		}
	}
	if built+botPendingBuilds(ws, owner, model.BuildingTypeArcSmelter) >= tuning.smelterTarget {
		return model.Command{}, false
	}
	def, ok := model.BuildingDefinitionByID(model.BuildingTypeArcSmelter)
	if !ok || !CanBuildTech(player, model.TechUnlockBuilding, string(model.BuildingTypeArcSmelter)) {
		return model.Command{}, false
	}
	if !botCanAffordBuild(player, def) {
		return model.Command{}, false
	}
	// 铁/铜/磁铁/石材按缺口各补一台，直到 smelterTarget：
	// 一台熔炉只能跑一个配方，磁铁与铜块共用一台会把研究站备料串死。
	for _, recipe := range botSmelterRecipes {
		if _, ok := model.Recipe(recipe); !ok || !CanUseRecipeTech(player, recipe) {
			continue
		}
		if botSmelterCovers(ctx, recipe) || botPendingSmelter(ws, owner, recipe) {
			continue
		}
		pos := botBuildSpotNear(ws, *ctx.home, botConstructRadius(ws, owner, ctx), model.BuildingTypeArcSmelter)
		if pos == nil {
			return model.Command{}, false
		}
		return model.Command{
			Type:    model.CmdBuild,
			Target:  model.CommandTarget{Layer: "planet", Position: pos},
			Payload: map[string]any{"building_type": string(model.BuildingTypeArcSmelter), "recipe_id": recipe},
		}, true
	}
	return model.Command{}, false
}

// botPendingSmelter 是否已有在建熔炉指定了该配方。
func botPendingSmelter(ws *model.WorldState, owner, recipeID string) bool {
	if ws == nil || ws.Construction == nil {
		return false
	}
	ids := make([]string, 0, len(ws.Construction.Tasks))
	for id := range ws.Construction.Tasks {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		task := ws.Construction.Tasks[id]
		if task == nil || task.PlayerID != owner || task.BuildingType != model.BuildingTypeArcSmelter {
			continue
		}
		if task.State == model.ConstructionCancelled || task.State == model.ConstructionCompleted {
			continue
		}
		if task.RecipeID == recipeID {
			return true
		}
	}
	return false
}

// botSmelterCovers 是否已有熔炉按该配方生产。
func botSmelterCovers(ctx *botSurvey, recipeID string) bool {
	for _, b := range ctx.buildings {
		if b.Type != model.BuildingTypeArcSmelter || b.Production == nil {
			continue
		}
		if b.Production.RecipeID == recipeID {
			return true
		}
	}
	return false
}

// botMatrixInputRecipes 矩阵专用产线的前置配方（磁线圈、电路板）。
func botMatrixInputRecipes() []string {
	r, ok := model.Recipe(model.ItemElectromagneticMatrix)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(r.Inputs))
	for _, input := range r.Inputs {
		if recipe, ok := botRecipeFor(&model.PlayerState{}, input.ItemID); ok {
			out = append(out, recipe.ID)
		}
	}
	return out
}

// botDedicatedAssembler 是否已有（或已有在建）制造台专跑该配方。
func botDedicatedAssembler(ctx *botSurvey, recipeID string) bool {
	for _, b := range ctx.buildings {
		if b.Type != model.BuildingTypeAssemblingMachineMk1 || b.Production == nil {
			continue
		}
		if b.Production.RecipeID == recipeID {
			return true
		}
	}
	return false
}

// matrixMachines 已建成的电磁矩阵专用制造台。
func matrixMachines(ctx *botSurvey) []*model.Building {
	var out []*model.Building
	for _, b := range ctx.buildings {
		if b.Type != model.BuildingTypeAssemblingMachineMk1 || b.Production == nil {
			continue
		}
		if b.Production.RecipeID == model.ItemElectromagneticMatrix {
			out = append(out, b)
		}
	}
	return out
}

// botPendingMatrixMachines 在建中的矩阵专用制造台（同一 tick 只能发一条建造命令，
// 因此按在建数量补齐目标，避免重复下单）。
func botPendingMatrixMachines(ws *model.WorldState, owner string) int {
	if ws == nil || ws.Construction == nil {
		return 0
	}
	n := 0
	ids := make([]string, 0, len(ws.Construction.Tasks))
	for id := range ws.Construction.Tasks {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		task := ws.Construction.Tasks[id]
		if task == nil || task.PlayerID != owner || task.BuildingType != model.BuildingTypeAssemblingMachineMk1 {
			continue
		}
		if task.State == model.ConstructionCancelled || task.State == model.ConstructionCompleted {
			continue
		}
		if task.RecipeID == model.ItemElectromagneticMatrix {
			n++
		}
	}
	return n
}

// botResearchMatrixReserve 研究站矩阵备料目标：默认 20，主攻科技（researchTarget）
// 在缩放后的实际成本更高时按实际成本备料（上限 200，避免囤到天荒地老）。
// 只算还没完成的那部分：已经研究完的前置科技不再计入，否则 bot 会一直
// 囤到整条链的总成本（hard 下 80+ 个矩阵），把研究站缓存占满、
// 后续科技反而开不了（试玩报告 D：15 个矩阵用完后 research 一直空转）。
func botResearchMatrixReserve(player *model.PlayerState, tuning botTuning) int {
	reserve := tuning.researchReserve
	if reserve <= 0 {
		reserve = 20
	}
	if player == nil || player.Tech == nil || tuning.researchTarget == "" {
		return reserve
	}
	pace := player.Tech.ResearchPace
	for _, id := range botResearchChain(tuning.researchTarget) {
		def, ok := model.TechDefinitionByID(id)
		if !ok || def == nil {
			continue
		}
		level := player.Tech.CompletedTechs[id] + 1
		if def.MaxLevel == 0 && player.Tech.HasTech(id) {
			continue // 已完成的一次性科技不再备料
		}
		if def.MaxLevel > 0 && player.Tech.CompletedTechs[id] >= def.MaxLevel {
			continue
		}
		for _, item := range model.ScaledResearchCost(def.CostForLevel(level), pace) {
			if item.ItemID != model.ItemElectromagneticMatrix {
				continue
			}
			if item.Quantity > reserve {
				reserve = item.Quantity
			}
		}
	}
	if reserve > 200 {
		reserve = 200
	}
	return reserve
}

func (gc *GameCore) botFeedBuilding(ws *model.WorldState, owner string, ctx *botSurvey, b *model.Building, item string, n int) (model.Command, bool) {
	if n <= 0 || b.Storage == nil {
		return model.Command{}, false
	}
	if qty := min(n, ws.Players[owner].Inventory[item]); qty > 0 {
		return botTransferCommand(b.ID, item, qty, "to_building"), true
	}
	return gc.botEnsureItem(ws, owner, ctx, item, n, map[string]bool{})
}

func botTransferCommand(id, item string, n int, direction string) model.Command {
	return model.Command{Type: model.CmdTransferItem, Target: model.CommandTarget{Layer: "planet", EntityID: id}, Payload: map[string]any{"building_id": id, "item_id": item, "quantity": n, "direction": direction}}
}

// Catalog recipes are sorted: a map iteration must never change a bot replay.
func botRecipeFor(player *model.PlayerState, item string) (model.RecipeDefinition, bool) {
	for _, def := range model.RecipesProducingItem(item) {
		if CanUseRecipeTech(player, def.ID) {
			return def, true
		}
	}
	return model.RecipeDefinition{}, false
}

func (gc *GameCore) botEnsureItem(ws *model.WorldState, owner string, ctx *botSurvey, item string, quantity int, visiting map[string]bool) (model.Command, bool) {
	player := ws.Players[owner]
	if player.Inventory[item] >= quantity || visiting[item] {
		return model.Command{}, false
	}
	visiting[item] = true
	defer delete(visiting, item)
	for _, b := range ctx.buildings {
		// Only collect a machine's product, never steal inputs from military sinks.
		if b.Storage == nil {
			continue
		}
		if b.Production != nil && b.Production.RecipeID != "" {
			r, _ := model.Recipe(b.Production.RecipeID)
			product := false
			for _, out := range r.AllOutputs() {
				if out.ItemID == item {
					product = true
				}
			}
			if !product {
				continue
			}
		}
		exports := b.ExportableItemQuantity(item)
		if b.Runtime.Functions.Collect == nil && b.Runtime.Functions.Production == nil {
			continue
		}
		if exports > 0 {
			return botTransferCommand(b.ID, item, min(quantity-player.Inventory[item], exports), "to_player"), true
		}
	}
	recipe, ok := botRecipeFor(player, item)
	if !ok {
		if ctx.executor.Mecha.Job != nil {
			return model.Command{}, false
		}
		if botNearestNode(ws, ctx.executor.Position, item) == nil {
			return model.Command{}, false
		}
		return gc.botMineKind(ws, owner, ctx.executor, item, ctx)
	}
	batches := 1
	for _, o := range recipe.Outputs {
		if o.ItemID == item {
			batches = min(8, max(1, (quantity-player.Inventory[item]+o.Quantity-1)/o.Quantity))
		}
	}
	// 已有机器在跑这个配方：先喂机器，只有机器吃不下的部分才留给机甲手搓。
	// 手搓每批 60 tick/个且与机甲所有其它作业串行，把机甲当唯一产线时
	// 矩阵链永远供不上（试玩报告 D：电磁学要 7000+ tick 才开工）。
	for _, b := range ctx.assemblers {
		if b.Production == nil || b.Production.RecipeID != recipe.ID {
			continue
		}
		for _, input := range recipe.Inputs {
			needed := input.Quantity*batches - b.Storage.ItemQuantity(input.ItemID)
			if needed <= 0 {
				continue
			}
			if n := min(needed, player.Inventory[input.ItemID]); n > 0 {
				return botTransferCommand(b.ID, input.ItemID, n, "to_building"), true
			}
			if cmd, ok := gc.botEnsureItem(ws, owner, ctx, input.ItemID, needed, visiting); ok {
				return cmd, true
			}
		}
		return model.Command{}, false // In production: never invent its output.
	}
	if recipe.HandcraftAllowed {
		for _, input := range recipe.Inputs {
			if player.Inventory[input.ItemID] < input.Quantity*batches {
				return gc.botEnsureItem(ws, owner, ctx, input.ItemID, input.Quantity*batches, visiting)
			}
		}
		if ctx.executor.Mecha.Job != nil {
			return model.Command{}, false
		}
		return model.Command{Type: model.CmdCraftItem, Target: model.CommandTarget{Layer: "planet", EntityID: ctx.executor.ID}, Payload: map[string]any{"recipe_id": recipe.ID, "quantity": batches}}, true
	}
	// 已有机器在跑这个配方：喂机器而不是新建产线。
	for _, b := range ctx.assemblers {
		if b.Production == nil || b.Production.RecipeID != recipe.ID {
			continue
		}
		for _, input := range recipe.Inputs {
			needed := input.Quantity*batches - b.Storage.ItemQuantity(input.ItemID)
			if needed <= 0 {
				continue
			}
			if n := min(needed, player.Inventory[input.ItemID]); n > 0 {
				return botTransferCommand(b.ID, input.ItemID, n, "to_building"), true
			}
			if cmd, ok := gc.botEnsureItem(ws, owner, ctx, input.ItemID, needed, visiting); ok {
				return cmd, true
			}
		}
		return model.Command{}, false // In production: never invent its output.
	}
	for _, b := range ctx.assemblers {
		if b.Production != nil && b.Production.RecipeID != "" {
			continue
		}
		if b.Type == model.BuildingTypeMatrixLab {
			continue
		} // Preserve a research station.
		for _, typ := range recipe.BuildingTypes {
			if b.Type == typ {
				return model.Command{Type: model.CmdSetRecipe, Target: model.CommandTarget{EntityID: b.ID}, Payload: map[string]any{"recipe_id": recipe.ID}}, true
			}
		}
	}
	for _, typ := range recipe.BuildingTypes {
		if CanBuildTech(player, model.TechUnlockBuilding, string(typ)) {
			return gc.botEnsureBuilding(ws, owner, ctx, typ, recipe.ID, visiting)
		}
	}
	return model.Command{}, false
}

func (gc *GameCore) botEnsureBuilding(ws *model.WorldState, owner string, ctx *botSurvey, typ model.BuildingType, recipe string, visiting map[string]bool) (model.Command, bool) {
	player := ws.Players[owner]
	if !CanBuildTech(player, model.TechUnlockBuilding, string(typ)) || botPendingBuilds(ws, owner, typ) > 0 {
		return model.Command{}, false
	}
	def, ok := model.BuildingDefinitionByID(typ)
	if !ok {
		return model.Command{}, false
	}
	for _, cost := range def.BuildCost.Items {
		if player.Inventory[cost.ItemID] < cost.Quantity {
			return gc.botEnsureItem(ws, owner, ctx, cost.ItemID, cost.Quantity, visiting)
		}
	}
	if !botCanAffordBuild(player, def) {
		return model.Command{}, false
	}
	pos := botBuildSpotNear(ws, *ctx.home, botConstructRadius(ws, owner, ctx), typ)
	if pos == nil {
		return model.Command{}, false
	}
	payload := map[string]any{"building_type": string(typ)}
	if recipe != "" {
		payload["recipe_id"] = recipe
	}
	return model.Command{Type: model.CmdBuild, Target: model.CommandTarget{Layer: "planet", Position: pos}, Payload: payload}, true
}

func botArmyPreference(ctx *botSurvey, tuning botTuning) []model.UnitType {
	counts := map[model.UnitType]int{}
	for _, u := range ctx.soldiers {
		counts[u.Type]++
	}
	for _, b := range ctx.producers {
		for _, order := range b.UnitQueue {
			counts[order.UnitType]++
		}
	}
	types := []model.UnitType{}
	if len(ctx.soldiers) >= tuning.supportAt && counts[model.UnitTypeSupplyTruck] == 0 {
		types = append(types, model.UnitTypeSupplyTruck)
	}
	if botPreferMecha(ctx.soldierCount, ctx.mechaCount, tuning) {
		types = append(types, model.UnitTypeMecha)
	}
	if len(ctx.soldiers) >= tuning.heavyAt {
		for _, typ := range []model.UnitType{model.UnitTypeArtillery, model.UnitTypeMissileVehicle, model.UnitTypeRepairVehicle, model.UnitTypeAttackDrone} {
			if counts[typ] < max(1, len(ctx.soldiers)/8) {
				types = append(types, typ)
			}
		}
	}
	return append(types, model.UnitTypeSoldier)
}

// botTeslaCap bot 电感应塔上限：够把十来座建筑连进电网即可，避免满地铺塔。
const botTeslaCap = 10

// botPowerLink 给断电建筑接电：从已带电电网里离它最近的节点出发，
// 在无线覆盖范围内朝它放一座电感应塔，逐座延伸，直到接上。
func (gc *GameCore) botPowerLink(ws *model.WorldState, owner string, ctx *botSurvey) (model.Command, bool) {
	if botPendingBuilds(ws, owner, model.BuildingTypeTeslaTower) > 0 {
		return model.Command{}, false
	}
	towers := 0
	for _, b := range ctx.buildings {
		if b.Type == model.BuildingTypeTeslaTower {
			towers++
		}
	}
	if towers >= botTeslaCap {
		return model.Command{}, false
	}
	powered := botPoweredGrid(ws, ctx)
	reach := model.BuildingProfileFor(model.BuildingTypeTeslaTower, 1).Runtime.Functions.PowerGrid.WirelessRange
	for _, b := range ctx.buildings {
		if b.Runtime.StateReason != "power_out_of_range" && b.Runtime.StateReason != "power_no_provider" {
			continue
		}
		var anchor *model.Building
		for _, node := range ctx.buildings {
			if !powered[node.ID] {
				continue
			}
			if anchor == nil || ws.SurfaceDistance(node.Position, b.Position) < ws.SurfaceDistance(anchor.Position, b.Position) {
				anchor = node
			}
		}
		if anchor == nil {
			return model.Command{}, false
		}
		def, _ := model.BuildingDefinitionByID(model.BuildingTypeTeslaTower)
		for _, cost := range def.BuildCost.Items {
			if ws.Players[owner].Inventory[cost.ItemID] < cost.Quantity {
				return gc.botEnsureItem(ws, owner, ctx, cost.ItemID, cost.Quantity, map[string]bool{})
			}
		}
		if !botCanAffordBuild(ws.Players[owner], def) {
			return model.Command{}, false
		}
		pos := botTowerStep(ws, anchor.Position, b.Position, reach)
		// 只放能朝目标推进的塔：地形挡住时跳过这座建筑，避免原地堆塔。
		if pos == nil || ws.SurfaceDistance(*pos, b.Position) >= ws.SurfaceDistance(anchor.Position, b.Position) || gc.requireBuildRange(ws, owner, *pos) != nil {
			continue
		}
		// 复用与 execBuild 相同的围死校验：拉线时的电塔同样不能把基地封死
		// （试玩报告 1010 阻断 A 的修法，否则 bot 会反复发注定被拒的建造命令）。
		if buildingEnclosure(ws, model.BuildingTypeTeslaTower, model.PlanRotation0, *pos) != nil {
			continue
		}
		return model.Command{Type: model.CmdBuild, Target: model.CommandTarget{Layer: "planet", Position: pos}, Payload: map[string]any{"building_type": string(model.BuildingTypeTeslaTower)}}, true
	}
	return model.Command{}, false
}

// botPoweredGrid 与己方发电建筑连通的电网节点（按电网图的边做 BFS）。
func botPoweredGrid(ws *model.WorldState, ctx *botSurvey) map[string]bool {
	powered := map[string]bool{}
	if ws.PowerGrid == nil {
		return powered
	}
	queue := []string{}
	for _, b := range ctx.buildings {
		if b.Runtime.Functions.Energy != nil && b.Runtime.Functions.Energy.OutputPerTick > 0 {
			powered[b.ID] = true
			queue = append(queue, b.ID)
		}
	}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		for next := range ws.PowerGrid.Edges[id] {
			if !powered[next] {
				powered[next] = true
				queue = append(queue, next)
			}
		}
	}
	return powered
}

// botTowerStep 在 from 的无线覆盖范围内选离 to 最近的空地（同距取坐标小者）。
func botTowerStep(ws *model.WorldState, from, to model.Position, reach int) *model.Position {
	var best *model.Position
	bestDist := 0
	for _, c := range ws.SurfaceDisc(from, reach) {
		if !ws.InBounds(c.X, c.Y) || !ws.Grid[c.Y][c.X].Terrain.Buildable() || ws.Grid[c.Y][c.X].BuildingID != "" || ws.Grid[c.Y][c.X].ResourceNodeID != "" {
			continue
		}
		if ws.Construction != nil && ws.Construction.IsTileReserved(model.TileKey(c.X, c.Y)) {
			continue
		}
		d := ws.SurfaceDistance(c, to)
		if best == nil || d < bestDist || (d == bestDist && (c.Y < best.Y || c.Y == best.Y && c.X < best.X)) {
			p := c
			best, bestDist = &p, d
		}
	}
	return best
}

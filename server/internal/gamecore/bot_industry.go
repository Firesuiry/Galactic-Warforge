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
	// Research receives physical matrices, including a dedicated matrix machine.
	for _, lab := range ctx.buildings {
		if lab.Type != model.BuildingTypeMatrixLab || lab.Production != nil && lab.Production.RecipeID != "" {
			continue
		}
		if lab.Storage.OutputQuantity(model.ItemElectromagneticMatrix) < 20 {
			if cmd, ok := gc.botFeedBuilding(ws, owner, ctx, lab, model.ItemElectromagneticMatrix, 20); ok {
				return issue(cmd)
			}
		}
	}
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
	recipes := model.AllRecipes()
	sort.Slice(recipes, func(i, j int) bool { return recipes[i].ID < recipes[j].ID })
	for _, r := range recipes {
		if !CanUseRecipeTech(player, r.ID) {
			continue
		}
		for _, o := range r.Outputs {
			if o.ItemID == item {
				return r, true
			}
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
	pos := botBuildSpotNear(ws, *ctx.home, botConstructRadius(ws, owner, ctx))
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

func (gc *GameCore) botPowerLink(ws *model.WorldState, owner string, ctx *botSurvey) (model.Command, bool) {
	if botPendingBuilds(ws, owner, model.BuildingTypeTeslaTower) > 0 {
		return model.Command{}, false
	}
	for _, b := range ctx.buildings {
		if b.Runtime.StateReason != "power_out_of_range" && b.Runtime.StateReason != "power_no_provider" {
			continue
		}
		def, _ := model.BuildingDefinitionByID(model.BuildingTypeTeslaTower)
		for _, cost := range def.BuildCost.Items {
			if ws.Players[owner].Inventory[cost.ItemID] < cost.Quantity {
				return gc.botEnsureItem(ws, owner, ctx, cost.ItemID, cost.Quantity, map[string]bool{})
			}
		}
		if !botCanAffordBuild(ws.Players[owner], def) {
			continue
		}
		pos := botBuildSpotNear(ws, b.Position, 2)
		if pos == nil {
			continue
		}
		if gc.requireBuildRange(ws, owner, *pos) != nil {
			continue
		}
		return model.Command{Type: model.CmdBuild, Target: model.CommandTarget{Layer: "planet", Position: pos}, Payload: map[string]any{"building_type": string(model.BuildingTypeTeslaTower)}}, true
	}
	return model.Command{}, false
}

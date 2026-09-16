package gamecore

import (
	"fmt"
	"siliconworld/internal/model"
	"sort"
)

func ownedDistributor(ws *model.WorldState, playerID, id string) (*model.Building, *model.CommandResult) {
	b := ws.Buildings[id]
	failure := &model.CommandResult{Status: model.StatusFailed, Code: model.CodeInvalidTarget, Message: "valid owned distributor required"}
	if b == nil {
		failure.Code = model.CodeEntityNotFound
		return nil, failure
	}
	if b.OwnerID != playerID {
		failure.Code = model.CodeNotOwner
		return nil, failure
	}
	if b.Type != model.BuildingTypeLogisticsDistributor || b.Distributor == nil || b.Job != nil {
		return nil, failure
	}
	return b, nil
}

func (gc *GameCore) execConfigureDistributor(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	b, failure := ownedDistributor(ws, playerID, cmd.Target.EntityID)
	if failure != nil {
		return *failure, nil
	}
	fail := func(s string) (model.CommandResult, []*model.GameEvent) {
		return mechaJobFailed(model.CodeValidationFailed, s)
	}
	state := b.Distributor.Clone()
	item, ok := cmd.Payload["item_id"].(string)
	if !ok {
		return fail("item_id must be a string")
	}
	mode, err := payloadStrictString(cmd.Payload, "mode")
	if err != nil {
		return fail(err.Error())
	}
	quantity, err := payloadStrictInt(cmd.Payload, "local_storage")
	if err != nil {
		return fail(err.Error())
	}
	state.ItemID = item
	state.Mode = model.LogisticsStationMode(mode)
	state.LocalStorage = quantity
	for key, dest := range map[string]*bool{"player_delivery_enabled": &state.PlayerDeliveryEnabled, "player_collection_enabled": &state.PlayerCollectionEnabled} {
		if raw, exists := cmd.Payload[key]; exists {
			value, valid := raw.(bool)
			if !valid {
				return fail(key + " must be boolean")
			}
			*dest = value
		}
	}
	if err := state.Validate(); err != nil {
		return fail(err.Error())
	}
	host := model.DistributorHost(ws, b)
	if host == nil {
		return fail("distributor host unavailable")
	}
	if quantity > host.Storage.Capacity+host.Storage.InputBufferCapacity()+host.Storage.OutputBufferCapacity() {
		return fail("local_storage exceeds host capacity")
	}
	b.Distributor = state
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "distributor configured"}, nil
}

func (gc *GameCore) execInstallLogisticsBot(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	b, failure := ownedDistributor(ws, playerID, cmd.Target.EntityID)
	if failure != nil {
		return *failure, nil
	}
	fail := func(s string) (model.CommandResult, []*model.GameEvent) {
		return mechaJobFailed(model.CodeValidationFailed, s)
	}
	host := model.DistributorHost(ws, b)
	if host == nil {
		return fail("distributor host unavailable")
	}
	n, err := payloadStrictInt(cmd.Payload, "quantity")
	if err != nil || n <= 0 || n > b.Distributor.BotCapacity-model.DistributorBotCount(ws, b.ID) {
		return fail("quantity exceeds available robot slots")
	}
	source := "player"
	if raw, ok := cmd.Payload["source"]; ok {
		v, valid := raw.(string)
		if !valid || (v != "player" && v != "storage") {
			return fail("source must be player or storage")
		}
		source = v
	}
	player := ws.Players[playerID]
	if player == nil {
		return fail("player unavailable")
	}
	count := player.Inventory[model.ItemLogisticsBot]
	if source == "storage" {
		count = host.Storage.OutputQuantity(model.ItemLogisticsBot)
	}
	if count < n {
		return mechaJobFailed(model.CodeInsufficientResource, "manufactured logistics_bot items required in "+source)
	}
	added := make([]string, 0, n)
	for i := 0; i < n; i++ {
		bot := model.NewLogisticsBotState(ws.NextEntityID("bot"), b.ID, b.Position)
		if err := model.RegisterLogisticsBot(ws, bot); err != nil {
			for _, id := range added {
				model.UnregisterLogisticsBot(ws, id)
			}
			return fail(err.Error())
		}
		added = append(added, bot.ID)
	}
	if source == "player" {
		player.DeductItems([]model.ItemAmount{{ItemID: model.ItemLogisticsBot, Quantity: n}})
	} else {
		host.Storage.Provide(model.ItemLogisticsBot, n)
	}
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: fmt.Sprintf("installed %d logistics bots", n)}, nil
}

func (gc *GameCore) execUninstallLogisticsBot(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	b, failure := ownedDistributor(ws, playerID, cmd.Target.EntityID)
	if failure != nil {
		return *failure, nil
	}
	n, err := payloadStrictInt(cmd.Payload, "quantity")
	if err != nil || n <= 0 {
		return mechaJobFailed(model.CodeValidationFailed, "quantity must be positive")
	}
	ids := []string{}
	for id, bot := range ws.LogisticsBots {
		if bot != nil && bot.DistributorID == b.ID && bot.OwnerID == playerID && bot.Status == model.LogisticsDroneIdle && bot.CargoQty() == 0 {
			ids = append(ids, id)
		}
	}
	if n > len(ids) || ws.Players[playerID] == nil {
		return mechaJobFailed(model.CodeValidationFailed, "not enough empty idle robots")
	}
	sort.Strings(ids)
	for _, id := range ids[:n] {
		model.UnregisterLogisticsBot(ws, id)
	}
	ws.Players[playerID].AddItems([]model.ItemAmount{{ItemID: model.ItemLogisticsBot, Quantity: n}})
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "robots returned to player inventory"}, nil
}

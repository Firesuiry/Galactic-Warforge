package gamecore

import (
	"fmt"
	"siliconworld/internal/model"
	"sort"
)

func ownedDistributor(ws *model.WorldState, playerID, id string) (*model.Building, *model.CommandResult) {
	b := ws.Buildings[id]
	failure := &model.CommandResult{Status: model.StatusFailed, Code: model.CodeInvalidTarget, Message: "需要有效的己方配送器"}
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

type configureDistributorPayload struct {
	ItemID                  string `json:"item_id" payload:"required,allowempty"`
	Mode                    string `json:"mode" payload:"required"`
	LocalStorage            int    `json:"local_storage" payload:"required"`
	PlayerDeliveryEnabled   *bool  `json:"player_delivery_enabled"`
	PlayerCollectionEnabled *bool  `json:"player_collection_enabled"`
}

func (gc *GameCore) execConfigureDistributor(ws *model.WorldState, playerID string, cmd model.Command, p configureDistributorPayload) (model.CommandResult, []*model.GameEvent) {
	b, failure := ownedDistributor(ws, playerID, cmd.Target.EntityID)
	if failure != nil {
		return *failure, nil
	}
	fail := func(s string) (model.CommandResult, []*model.GameEvent) {
		return mechaJobFailed(model.CodeValidationFailed, s)
	}
	state := b.Distributor.Clone()
	quantity := p.LocalStorage
	state.ItemID = p.ItemID
	state.Mode = model.LogisticsStationMode(p.Mode)
	state.LocalStorage = quantity
	if p.PlayerDeliveryEnabled != nil {
		state.PlayerDeliveryEnabled = *p.PlayerDeliveryEnabled
	}
	if p.PlayerCollectionEnabled != nil {
		state.PlayerCollectionEnabled = *p.PlayerCollectionEnabled
	}
	if err := state.Validate(); err != nil {
		return fail(err.Error())
	}
	host := model.DistributorHost(ws, b)
	if host == nil {
		return fail("配送器宿主仓库不可用")
	}
	if quantity > host.Storage.Capacity+host.Storage.InputBufferCapacity()+host.Storage.OutputBufferCapacity() {
		return fail("local_storage 超出宿主仓库容量")
	}
	b.Distributor = state
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "配送器已配置"}, []*model.GameEvent{{
		EventType: model.EvtEntityUpdated, VisibilityScope: playerID,
		Payload: map[string]any{"building_id": b.ID, "distributor": state.Clone()},
	}}
}

type installLogisticsBotPayload struct {
	Quantity int     `json:"quantity" payload:"required"`
	Source   *string `json:"source"`
}

func (gc *GameCore) execInstallLogisticsBot(ws *model.WorldState, playerID string, cmd model.Command, p installLogisticsBotPayload) (model.CommandResult, []*model.GameEvent) {
	b, failure := ownedDistributor(ws, playerID, cmd.Target.EntityID)
	if failure != nil {
		return *failure, nil
	}
	fail := func(s string) (model.CommandResult, []*model.GameEvent) {
		return mechaJobFailed(model.CodeValidationFailed, s)
	}
	host := model.DistributorHost(ws, b)
	if host == nil {
		return fail("配送器宿主仓库不可用")
	}
	n := p.Quantity
	if n <= 0 || n > b.Distributor.BotCapacity-model.DistributorBotCount(ws, b.ID) {
		return fail("quantity 超出可用机器人槽位")
	}
	source := "player"
	if p.Source != nil {
		source = *p.Source
		if source != "player" && source != "storage" {
			return fail("source 必须为 player 或 storage")
		}
	}
	player := ws.Players[playerID]
	if player == nil {
		return fail("玩家不可用")
	}
	if !CanBuildTech(player, model.TechUnlockRecipe, model.ItemLogisticsBot) {
		return fail("需先研究解锁 logistics_bot 配方（distribution_logistics）")
	}
	count := player.Inventory[model.ItemLogisticsBot]
	if source == "storage" {
		count = host.Storage.OutputQuantity(model.ItemLogisticsBot)
	}
	if count < n {
		return mechaJobFailed(model.CodeInsufficientResource, "已制造的 logistics_bot 不足，来源："+source)
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
	events := []*model.GameEvent{{
		EventType: model.EvtEntityUpdated, VisibilityScope: playerID,
		Payload: map[string]any{"building_id": b.ID, "host_building_id": host.ID, "installed": n, "source": source, "bot_count": model.DistributorBotCount(ws, b.ID)},
	}}
	if source == "player" {
		events = append(events, &model.GameEvent{
			EventType: model.EvtResourceChanged, VisibilityScope: playerID,
			Payload: map[string]any{"building_id": b.ID, "item_id": model.ItemLogisticsBot, "inventory_qty": player.Inventory[model.ItemLogisticsBot]},
		})
	}
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: fmt.Sprintf("已安装 %d 个物流机器人", n)}, events
}

type uninstallLogisticsBotPayload struct {
	Quantity int `json:"quantity" payload:"required"`
}

func (gc *GameCore) execUninstallLogisticsBot(ws *model.WorldState, playerID string, cmd model.Command, p uninstallLogisticsBotPayload) (model.CommandResult, []*model.GameEvent) {
	b, failure := ownedDistributor(ws, playerID, cmd.Target.EntityID)
	if failure != nil {
		return *failure, nil
	}
	n := p.Quantity
	if n <= 0 {
		return mechaJobFailed(model.CodeValidationFailed, "quantity 必须为正数")
	}
	ids := []string{}
	for id, bot := range ws.LogisticsBots {
		if bot != nil && bot.DistributorID == b.ID && bot.OwnerID == playerID && bot.Status == model.LogisticsDroneIdle && bot.CargoQty() == 0 {
			ids = append(ids, id)
		}
	}
	if n > len(ids) || ws.Players[playerID] == nil {
		return mechaJobFailed(model.CodeValidationFailed, "空闲且空载的机器人不足")
	}
	sort.Strings(ids)
	for _, id := range ids[:n] {
		model.UnregisterLogisticsBot(ws, id)
	}
	ws.Players[playerID].AddItems([]model.ItemAmount{{ItemID: model.ItemLogisticsBot, Quantity: n}})
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "机器人已退回玩家背包"}, []*model.GameEvent{{
		EventType: model.EvtEntityUpdated, VisibilityScope: playerID,
		Payload: map[string]any{"building_id": b.ID, "uninstalled": n, "bot_count": model.DistributorBotCount(ws, b.ID)},
	}, {
		EventType: model.EvtResourceChanged, VisibilityScope: playerID,
		Payload: map[string]any{"building_id": b.ID, "item_id": model.ItemLogisticsBot, "inventory_qty": ws.Players[playerID].Inventory[model.ItemLogisticsBot]},
	}}
}

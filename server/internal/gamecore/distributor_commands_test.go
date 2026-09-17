package gamecore

import (
	"siliconworld/internal/model"
	"testing"
)

func TestDistributorConfigurationEventsSnapshotAuthoritativeState(t *testing.T) {
	ws, home, sink := distributorTestWorld(t)
	core := &GameCore{}
	cmd := model.Command{Target: model.CommandTarget{EntityID: home.ID}, Payload: map[string]any{"item_id": model.ItemIronOre, "mode": "demand", "local_storage": 20, "player_delivery_enabled": true}}
	result, events := core.execConfigureDistributor(ws, "p1", cmd)
	if result.Code != model.CodeOK || len(events) != 1 || events[0].EventType != model.EvtEntityUpdated || events[0].VisibilityScope != "p1" || events[0].Payload["building_id"] != home.ID {
		t.Fatalf("missing distributor refresh event: %+v %+v", result, events)
	}
	state, ok := events[0].Payload["distributor"].(*model.DistributorState)
	if !ok || state.LocalStorage != 20 || state.Mode != model.LogisticsStationModeDemand || !state.PlayerDeliveryEnabled {
		t.Fatalf("incorrect configuration event payload: %+v", events[0].Payload)
	}
	home.Distributor.LocalStorage = 30
	if state.LocalStorage != 20 {
		t.Fatal("event aliases mutable distributor state")
	}
	cmd.Payload["local_storage"] = -1
	if result, events = core.execConfigureDistributor(ws, "p1", cmd); result.Status != model.StatusFailed || len(events) != 0 || home.Distributor.LocalStorage != 30 {
		t.Fatal("failed command changed state or emitted refresh")
	}

	unit := distributorTestMecha(ws, sink.Position)
	cmd = model.Command{Target: model.CommandTarget{EntityID: unit.ID}, Payload: map[string]any{"requests": map[string]any{model.ItemIronOre: map[string]any{"min": 3, "max": 18}}}}
	result, events = core.execConfigureMechaLogistics(ws, "p1", cmd)
	if result.Code != model.CodeOK || len(events) != 1 || events[0].EventType != model.EvtMechaStateChanged || events[0].VisibilityScope != "p1" || events[0].Payload["entity_id"] != unit.ID {
		t.Fatalf("missing mecha refresh event: %+v %+v", result, events)
	}
	mecha, ok := events[0].Payload["mecha"].(model.MechaState)
	if !ok || mecha.LogisticsRequests[model.ItemIronOre] != (model.MechaLogisticsRequest{Min: 3, Max: 18}) {
		t.Fatalf("incorrect mecha request event: %+v", events[0].Payload)
	}
	unit.Mecha.LogisticsRequests[model.ItemIronOre] = model.MechaLogisticsRequest{Min: 5, Max: 10}
	if mecha.LogisticsRequests[model.ItemIronOre].Max != 18 {
		t.Fatal("event aliases mutable requests")
	}
	cmd.Payload["requests"] = map[string]any{model.ItemIronOre: map[string]any{"min": 30, "max": 18}}
	if result, events = core.execConfigureMechaLogistics(ws, "p1", cmd); result.Status != model.StatusFailed || len(events) != 0 || unit.Mecha.LogisticsRequests[model.ItemIronOre].Max != 10 {
		t.Fatal("invalid request changed state or emitted refresh")
	}
}

func TestDistributorBotInstallationEventsReflectActualInventory(t *testing.T) {
	for _, source := range []string{"player", "storage"} {
		t.Run(source, func(t *testing.T) {
			ws, home, _ := distributorTestWorld(t)
			player := ws.Players["p1"]
			if source == "player" {
				player.Inventory[model.ItemLogisticsBot] = 2
			} else {
				distributorTestLoad(t, ws, home, model.ItemLogisticsBot, 2)
			}
			core := &GameCore{}
			cmd := model.Command{Target: model.CommandTarget{EntityID: home.ID}, Payload: map[string]any{"quantity": 2, "source": source}}
			result, events := core.execInstallLogisticsBot(ws, "p1", cmd)
			want := 1
			if source == "player" {
				want = 2
			}
			if result.Code != model.CodeOK || len(events) != want || events[0].EventType != model.EvtEntityUpdated || events[0].Payload["bot_count"] != 2 {
				t.Fatalf("missing installation refresh: %+v %+v", result, events)
			}
			if source == "player" && (events[1].EventType != model.EvtResourceChanged || events[1].Payload["inventory_qty"] != 0) {
				t.Fatal("installation inventory not refreshed")
			}
			for _, event := range events {
				if event.VisibilityScope != "p1" {
					t.Fatal("private installation event leaked")
				}
			}
			result, events = core.execUninstallLogisticsBot(ws, "p1", cmd)
			if result.Code != model.CodeOK || len(events) != 2 || events[0].EventType != model.EvtEntityUpdated || events[0].Payload["bot_count"] != 0 || events[1].EventType != model.EvtResourceChanged || events[1].Payload["inventory_qty"] != 2 {
				t.Fatalf("missing uninstall refresh: %+v %+v", result, events)
			}
			for _, event := range events {
				if event.VisibilityScope != "p1" {
					t.Fatal("private uninstall event leaked")
				}
			}
		})
	}
}

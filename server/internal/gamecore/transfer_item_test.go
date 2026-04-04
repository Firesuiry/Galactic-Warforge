package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestTransferItemLoadsOwnedBuildingAndEmitsUpdate(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	player := ws.Players["p1"]
	player.Inventory = model.ItemInventory{
		model.ItemSolarSail: 5,
	}

	ejector := newEMRailEjectorBuilding("ejector-transfer", model.Position{X: 6, Y: 6}, "p1")
	ejector.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, ejector)

	res, events := core.execTransferItem(ws, "p1", model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": ejector.ID,
			"item_id":     model.ItemSolarSail,
			"quantity":    float64(3),
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("transfer item failed: %s (%s)", res.Code, res.Message)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 entity update event, got %d", len(events))
	}
	if events[0].EventType != model.EvtEntityUpdated {
		t.Fatalf("expected entity_updated event, got %s", events[0].EventType)
	}
	if got := player.Inventory[model.ItemSolarSail]; got != 2 {
		t.Fatalf("expected player solar sail inventory 2, got %d", got)
	}
	if got := ejector.Storage.OutputQuantity(model.ItemSolarSail); got != 3 {
		t.Fatalf("expected ejector loaded solar sails 3, got %d", got)
	}
}

func TestTransferItemAllowsImmediateRocketLaunch(t *testing.T) {
	ClearDysonSphereStates()
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "vertical_launching", "lightweight_structure")

	player := ws.Players["p1"]
	player.Inventory = model.ItemInventory{
		model.ItemSmallCarrierRocket: 2,
	}

	silo := newVerticalLaunchingSiloBuilding("silo-transfer", model.Position{X: 8, Y: 8}, "p1")
	silo.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, silo)

	AddDysonLayer("p1", "sys-1", 0, 1.2)
	if _, err := AddDysonNode("p1", "sys-1", 0, 10, 20); err != nil {
		t.Fatalf("add dyson node: %v", err)
	}

	transferRes, _ := core.execTransferItem(ws, "p1", model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": silo.ID,
			"item_id":     model.ItemSmallCarrierRocket,
			"quantity":    float64(2),
		},
	})
	if transferRes.Code != model.CodeOK {
		t.Fatalf("transfer rocket failed: %s (%s)", transferRes.Code, transferRes.Message)
	}

	launchRes, _ := core.execLaunchRocket(ws, "p1", model.Command{
		Type: model.CmdLaunchRocket,
		Payload: map[string]any{
			"building_id": silo.ID,
			"system_id":   "sys-1",
			"layer_index": float64(0),
			"count":       float64(1),
		},
	})
	if launchRes.Code != model.CodeOK {
		t.Fatalf("expected launch to succeed after transfer, got %s (%s)", launchRes.Code, launchRes.Message)
	}
}

func TestTransferItemRejectsInvalidTargetsAndInventory(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	player := ws.Players["p1"]
	player.Inventory = model.ItemInventory{
		model.ItemSolarSail: 1,
	}

	ejector := newEMRailEjectorBuilding("ejector-p1", model.Position{X: 4, Y: 4}, "p1")
	ejector.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, ejector)

	foreignEjector := newEMRailEjectorBuilding("ejector-p2", model.Position{X: 5, Y: 5}, "p2")
	foreignEjector.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, foreignEjector)

	profile := model.BuildingProfileFor(model.BuildingTypeBattlefieldAnalysisBase, 1)
	noStorage := &model.Building{
		ID:          "base-1",
		Type:        model.BuildingTypeBattlefieldAnalysisBase,
		OwnerID:     "p1",
		Position:    model.Position{X: 7, Y: 7},
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	attachBuilding(ws, noStorage)

	tests := []struct {
		name       string
		buildingID string
		itemID     string
		quantity   any
		wantCode   model.ResultCode
	}{
		{
			name:       "not owner",
			buildingID: foreignEjector.ID,
			itemID:     model.ItemSolarSail,
			quantity:   float64(1),
			wantCode:   model.CodeNotOwner,
		},
		{
			name:       "no storage",
			buildingID: noStorage.ID,
			itemID:     model.ItemSolarSail,
			quantity:   float64(1),
			wantCode:   model.CodeValidationFailed,
		},
		{
			name:       "insufficient inventory",
			buildingID: ejector.ID,
			itemID:     model.ItemSolarSail,
			quantity:   float64(3),
			wantCode:   model.CodeInsufficientResource,
		},
		{
			name:       "invalid quantity",
			buildingID: ejector.ID,
			itemID:     model.ItemSolarSail,
			quantity:   float64(0),
			wantCode:   model.CodeValidationFailed,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res, _ := core.execTransferItem(ws, "p1", model.Command{
				Type: model.CmdTransferItem,
				Payload: map[string]any{
					"building_id": tc.buildingID,
					"item_id":     tc.itemID,
					"quantity":    tc.quantity,
				},
			})
			if res.Code != tc.wantCode {
				t.Fatalf("expected %s, got %s (%s)", tc.wantCode, res.Code, res.Message)
			}
		})
	}
}

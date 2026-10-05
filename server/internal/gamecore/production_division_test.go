package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
)

func newPoweredProducer(ws *model.WorldState, id string, typ model.BuildingType, pos model.Position) *model.Building {
	b := surfaceTestBuilding(ws, id, typ, pos)
	b.OwnerID = "p1"
	model.InitBuildingStorage(b)
	b.Runtime.State = model.BuildingWorkRunning
	b.Runtime.Params.EnergyConsume = 0
	if b.Runtime.Functions.Energy != nil {
		b.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	return b
}

func stockProducerFor(b *model.Building, entry model.WorldUnitCatalogEntry) {
	inv := b.Storage.EnsureInventory()
	for _, c := range entry.Cost {
		inv[c.ItemID] += c.Quantity
	}
}

// 3.3：兵营出步兵/侦察，战车工厂出机甲/火炮/导弹车/维修车/补给车，机场出无人机。
func TestProducerDivisionOfLabour(t *testing.T) {
	plan := map[model.BuildingType][]string{
		"barracks":        {"worker", "soldier", "scout"},
		"vehicle_factory": {"mecha", "artillery", "missile_vehicle", "repair_vehicle", "supply_truck"},
		"airfield":        {"attack_drone"},
	}
	ws := newRTTWorld(false)
	grantAllTechs(ws, "p1")
	gc := &GameCore{}
	producers := map[model.BuildingType]*model.Building{}
	x := 2
	for typ := range plan {
		producers[typ] = newPoweredProducer(ws, string(typ), typ, model.Position{X: x, Y: 2})
		x += 3
	}
	for typ, units := range plan {
		for _, id := range units {
			entry, ok := model.PublicWorldProduceUnitByID(id)
			if !ok {
				t.Fatalf("%s not producible", id)
			}
			if entry.Producer != typ {
				t.Fatalf("%s producer = %s want %s", id, entry.Producer, typ)
			}
			if len(entry.Cost) == 0 {
				t.Fatalf("%s has no physical cost", id)
			}
			for other, b := range producers {
				stockProducerFor(b, entry)
				cmd := model.Command{Target: model.CommandTarget{EntityID: b.ID}, Payload: map[string]any{"unit_type": id}}
				res, _ := execCommand(gc, model.CmdProduce, ws, "p1", cmd)
				if other == typ {
					if res.Code != model.CodeOK {
						t.Fatalf("%s must produce %s: %+v", other, id, res)
					}
				} else if res.Code != model.CodeInvalidTarget {
					t.Fatalf("%s must refuse %s, got %+v", other, id, res)
				}
			}
		}
	}
}

func TestProduceRejectsMissingItemsAndForeignOrFullQueue(t *testing.T) {
	ws := newRTTWorld(true)
	grantAllTechs(ws, "p1")
	gc := &GameCore{}
	b := newPoweredProducer(ws, "b", "barracks", model.Position{X: 3, Y: 3})
	cmd := model.Command{Target: model.CommandTarget{EntityID: b.ID}, Payload: map[string]any{"unit_type": "soldier"}}
	if res, _ := execCommand(gc, model.CmdProduce, ws, "p2", cmd); res.Code != model.CodeNotOwner {
		t.Fatalf("foreign producer: %+v", res)
	}
	entry, _ := model.PublicWorldProduceUnitByID("soldier")
	for i := 0; i < 20; i++ {
		stockProducerFor(b, entry)
		if res, _ := execCommand(gc, model.CmdProduce, ws, "p1", cmd); res.Code != model.CodeOK {
			t.Fatalf("order %d: %+v", i, res)
		}
	}
	stockProducerFor(b, entry)
	if res, _ := execCommand(gc, model.CmdProduce, ws, "p1", cmd); res.Code != model.CodeInvalidTarget {
		t.Fatalf("queue must cap at 20: %+v", res)
	}
	if len(b.UnitQueue) != 20 {
		t.Fatalf("queue len %d", len(b.UnitQueue))
	}
}

func TestRallyPointSendsNewUnitsToRally(t *testing.T) {
	ws := newRTTWorld(false)
	grantAllTechs(ws, "p1")
	gc := &GameCore{}
	b := newPoweredProducer(ws, "b", "barracks", model.Position{X: 3, Y: 3})
	rally := model.Position{X: 12, Y: 3}

	res, events := execCommand(gc, model.CmdSetRallyPoint, ws, "p1", model.Command{Target: model.CommandTarget{EntityID: b.ID, Position: &rally}})
	if res.Code != model.CodeOK || b.RallyPoint == nil || *b.RallyPoint != rally {
		t.Fatalf("set_rally_point: %+v", res)
	}
	if len(events) == 0 || events[0].Payload["rally_point"] == nil {
		t.Fatal("rally point must be published in the producer state event")
	}

	entry, _ := model.PublicWorldProduceUnitByID("soldier")
	stockProducerFor(b, entry)
	if res, _ := execCommand(gc, model.CmdProduce, ws, "p1", model.Command{Target: model.CommandTarget{EntityID: b.ID}, Payload: map[string]any{"unit_type": "soldier"}}); res.Code != model.CodeOK {
		t.Fatalf("produce: %+v", res)
	}
	var unit *model.Unit
	for i := 0; i < entry.ProductionTicks+2 && unit == nil; i++ {
		ws.Tick++
		settleUnitProduction(ws)
		for _, u := range ws.Units {
			unit = u
		}
	}
	if unit == nil {
		t.Fatal("unit not produced")
	}
	if !unit.HasPath() || unit.Stance != model.UnitStanceMoving {
		t.Fatalf("new unit must head for rally: stance=%s path=%d", unit.Stance, len(unit.Path))
	}
	advanceRTT(ws, 400)
	if unit.Position != rally {
		t.Fatalf("unit ended at %+v, want rally %+v", unit.Position, rally)
	}
	if unit.HasPath() {
		t.Fatal("unit must stop at rally")
	}
}

func TestProducedUnitStaysPutWithoutRallyPoint(t *testing.T) {
	ws := newRTTWorld(false)
	grantAllTechs(ws, "p1")
	gc := &GameCore{}
	b := newPoweredProducer(ws, "b", "barracks", model.Position{X: 3, Y: 3})
	entry, _ := model.PublicWorldProduceUnitByID("soldier")
	stockProducerFor(b, entry)
	execCommand(gc, model.CmdProduce, ws, "p1", model.Command{Target: model.CommandTarget{EntityID: b.ID}, Payload: map[string]any{"unit_type": "soldier"}})
	for i := 0; i < entry.ProductionTicks+2; i++ {
		ws.Tick++
		settleUnitProduction(ws)
	}
	if len(ws.Units) != 1 {
		t.Fatalf("units=%d", len(ws.Units))
	}
	for _, u := range ws.Units {
		if u.HasPath() {
			t.Fatal("no rally point means no path")
		}
	}
}

func TestSetRallyPointValidation(t *testing.T) {
	ws := newRTTWorld(true)
	gc := &GameCore{}
	b := newPoweredProducer(ws, "b", "barracks", model.Position{X: 3, Y: 3})
	station := surfaceTestBuilding(ws, "sup", btSupply, model.Position{X: 6, Y: 6})
	station.OwnerID = "p1"
	ws.Grid[9][9].Terrain = terrain.TileBlocked
	ok := model.Position{X: 8, Y: 3}
	blocked := model.Position{X: 9, Y: 9}
	off := model.Position{X: -1, Y: 3}
	cases := []struct {
		name   string
		player string
		target model.CommandTarget
		want   model.ResultCode
	}{
		{"missing producer", "p1", model.CommandTarget{EntityID: "nope", Position: &ok}, model.CodeEntityNotFound},
		{"foreign producer", "p2", model.CommandTarget{EntityID: b.ID, Position: &ok}, model.CodeNotOwner},
		{"not a producer", "p1", model.CommandTarget{EntityID: station.ID, Position: &ok}, model.CodeInvalidTarget},
		{"blocked tile", "p1", model.CommandTarget{EntityID: b.ID, Position: &blocked}, model.CodeInvalidTarget},
		{"out of bounds", "p1", model.CommandTarget{EntityID: b.ID, Position: &off}, model.CodeInvalidTarget},
		{"no position", "p1", model.CommandTarget{EntityID: b.ID}, model.CodeInvalidTarget},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if res, _ := execCommand(gc, model.CmdSetRallyPoint, ws, tc.player, model.Command{Target: tc.target}); res.Code != tc.want {
				t.Fatalf("got %+v want %s", res, tc.want)
			}
			if b.RallyPoint != nil {
				t.Fatal("rejected command must not change the rally point")
			}
		})
	}
}

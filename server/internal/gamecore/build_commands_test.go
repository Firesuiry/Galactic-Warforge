package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)


// 试玩反馈：缺料回执一次列出全部缺口，而不是只报第一项。
func TestMissingItemMessageListsEveryGap(t *testing.T) {
	inv := model.ItemInventory{model.ItemIronIngot: 7, model.ItemGear: 1}
	msg, short := missingItemMessage(inv, []model.ItemAmount{
		{ItemID: model.ItemIronIngot, Quantity: 10},
		{ItemID: model.ItemGear, Quantity: 3},
		{ItemID: model.ItemCircuitBoard, Quantity: 2},
	})
	if !short {
		t.Fatal("expected shortage")
	}
	want := "背包缺：铁块 3、齿轮 2、电路板 2"
	if msg != want {
		t.Fatalf("shortage message = %q, want %q", msg, want)
	}
	if _, short := missingItemMessage(inv, []model.ItemAmount{{ItemID: model.ItemIronIngot, Quantity: 7}}); short {
		t.Fatal("sufficient inventory must not report a shortage")
	}
}

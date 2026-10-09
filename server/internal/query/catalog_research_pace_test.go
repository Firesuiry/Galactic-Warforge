package query

import (
	"testing"

	"siliconworld/internal/model"
)

// GET /catalog 的 techs[].cost 必须与结算同源：按 pace_research 缩放后的实际成本，
// 顶层 research_pace 原样下发（取整规则 = 四舍五入、下限 1）。
func TestCatalogScalesTechCostByResearchPace(t *testing.T) {
	ql, _, _ := newQueryTestContext(t)

	base := ql.Catalog(1)
	if base.ResearchPace != 1 {
		t.Fatalf("research_pace = %v, want 1", base.ResearchPace)
	}
	baseCost := techCostByID(t, base, "electromagnetism")

	scaled := ql.Catalog(2.5)
	if scaled.ResearchPace != 2.5 {
		t.Fatalf("research_pace = %v, want 2.5", scaled.ResearchPace)
	}
	scaledCost := techCostByID(t, scaled, "electromagnetism")

	if len(scaledCost) != len(baseCost) {
		t.Fatalf("cost entries changed: %+v vs %+v", scaledCost, baseCost)
	}
	want := model.ScaledResearchCost(baseCost, 2.5)
	for i := range want {
		if scaledCost[i].ItemID != want[i].ItemID || scaledCost[i].Quantity != want[i].Quantity {
			t.Fatalf("scaled cost = %+v, want %+v", scaledCost, want)
		}
	}
	if scaledCost[0].Quantity == baseCost[0].Quantity {
		t.Fatalf("scaled cost must differ from base cost: %+v", scaledCost)
	}

	// 未指定倍率（0）按 1 处理，且不修改目录基准值。
	again := ql.Catalog(0)
	if again.ResearchPace != 1 {
		t.Fatalf("zero pace must normalize to 1, got %v", again.ResearchPace)
	}
	if got := techCostByID(t, again, "electromagnetism"); got[0].Quantity != baseCost[0].Quantity {
		t.Fatalf("catalog base cost mutated: %+v vs %+v", got, baseCost)
	}
}

func techCostByID(t *testing.T, view *CatalogView, techID string) []model.ItemAmount {
	t.Helper()
	for _, entry := range view.Techs {
		if entry.ID == techID {
			if len(entry.Cost) == 0 {
				t.Fatalf("tech %s has no cost", techID)
			}
			return entry.Cost
		}
	}
	t.Fatalf("tech %s not found in catalog", techID)
	return nil
}

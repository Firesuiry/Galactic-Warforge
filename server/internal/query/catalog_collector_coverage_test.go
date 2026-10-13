package query

import (
	"encoding/json"
	"testing"
)

// 客户端本地预检要和服务端 ValidateCollectorSite / CollectorCoverageCells 同口径：
// 采集建筑（采矿机等）占地外还能再覆盖 coverage_radius 圈矿脉，锚点落在矿脉外圈
// 时也应当可建。试玩 1015 实测：锚点在矿脉外圈时客户端本地误拦，因此目录必须
// 暴露这一数值。
func TestCatalogExposesCollectorCoverageRadius(t *testing.T) {
	catalog := (&Layer{}).Catalog(1)
	byID := make(map[string]int, len(catalog.Buildings))
	requiresNode := make(map[string]bool, len(catalog.Buildings))
	for _, entry := range catalog.Buildings {
		byID[string(entry.ID)] = entry.CoverageRadius
		requiresNode[string(entry.ID)] = entry.RequiresResourceNode
	}
	if got := byID["mining_machine"]; got != 1 {
		t.Fatalf("mining_machine coverage_radius = %d, want 1（data/buildings.yaml 未配置时至少 1 圈）", got)
	}
	if !requiresNode["mining_machine"] {
		t.Fatal("mining_machine must advertise requires_resource_node")
	}
	if got := byID["advanced_mining_machine"]; got != 2 {
		t.Fatalf("advanced_mining_machine coverage_radius = %d, want 2（大型采矿机占地外再覆盖 2 圈）", got)
	}
	for _, id := range []string{"water_pump", "oil_extractor"} {
		if byID[id] != 1 {
			t.Fatalf("collector %s coverage_radius = %d, want 1（无显式配置时至少 1 圈）", id, byID[id])
		}
	}
	// 非采集建筑不暴露该字段（omitempty：0 不写进 JSON）。
	for _, id := range []string{"wind_turbine", "arc_smelter", "assembling_machine_mk1", "conveyor_belt_mk1"} {
		if byID[id] != 0 {
			t.Fatalf("non-collector %s coverage_radius = %d, want 0", id, byID[id])
		}
	}

	data, err := json.Marshal(catalog)
	if err != nil {
		t.Fatal(err)
	}
	var exposed struct {
		Buildings []map[string]any `json:"buildings"`
	}
	if err := json.Unmarshal(data, &exposed); err != nil {
		t.Fatal(err)
	}
	collectors := map[string]bool{"mining_machine": true, "advanced_mining_machine": true, "water_pump": true, "oil_extractor": true}
	seen := false
	for _, entry := range exposed.Buildings {
		if id, _ := entry["id"].(string); !collectors[id] {
			if _, ok := entry["coverage_radius"]; ok {
				t.Fatalf("non-collector %v leaked coverage_radius", entry["id"])
			}
			continue
		}
		if entry["id"] != "mining_machine" {
			continue
		}
		seen = true
		if radius, ok := entry["coverage_radius"].(float64); !ok || radius != 1 {
			t.Fatalf("serialized mining_machine coverage_radius = %v, want 1", entry["coverage_radius"])
		}
	}
	if !seen {
		t.Fatal("catalog omitted mining_machine")
	}
}

package gateway_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"siliconworld/internal/model"
)

func TestCommandCatalogEndpoint(t *testing.T) {
	srv, _ := newTestServer(t)

	// Unauthorized is rejected
	req := httptest.NewRequest("GET", "/catalog/commands", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without auth, got %d", rec.Code)
	}

	body := getAuthorizedJSON(t, srv, "/catalog/commands")

	version, ok := body["version"].(float64)
	if !ok || int(version) != 1 {
		t.Fatalf("expected version 1, got %#v", body["version"])
	}

	commands, ok := body["commands"].([]any)
	if !ok || len(commands) == 0 {
		t.Fatalf("expected non-empty commands, got %#v", body["commands"])
	}

	all := model.AllCommandTypes()
	if len(commands) != len(all) {
		t.Fatalf("expected %d commands, got %d", len(all), len(commands))
	}

	byType := map[string]map[string]any{}
	for _, raw := range commands {
		entry, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("expected command entry object, got %T", raw)
		}
		typeName, _ := entry["type"].(string)
		if typeName == "" {
			t.Fatalf("command entry missing type: %#v", entry)
		}
		byType[typeName] = entry
	}

	if _, ok := byType["not_a_real_command"]; ok {
		t.Fatal("unknown command type should not be present")
	}

	build, ok := byType["build"]
	if !ok {
		t.Fatal("expected build in catalog")
	}
	if !catalogContains(catalogStringList(build["required_payload_fields"]), "building_type") {
		t.Fatalf("build required_payload_fields missing building_type: %#v", build["required_payload_fields"])
	}
	if !catalogContains(catalogStringList(build["required_target_fields"]), "position") {
		t.Fatalf("build required_target_fields missing position: %#v", build["required_target_fields"])
	}

	// Spot-check a few more high-value commands against structural expectations.
	transfer := byType["transfer_item"]
	if !sameCatalogFields(catalogStringList(transfer["required_payload_fields"]), []string{"building_id", "item_id", "quantity"}) {
		t.Fatalf("transfer_item payload fields mismatch: %#v", transfer["required_payload_fields"])
	}
	fleetMove := byType["fleet_move"]
	if !sameCatalogFields(catalogStringList(fleetMove["required_payload_fields"]), []string{"fleet_id", "target_system_id"}) {
		t.Fatalf("fleet_move payload fields mismatch: %#v", fleetMove["required_payload_fields"])
	}
	queue := byType["queue_military_production"]
	if !sameCatalogFields(catalogStringList(queue["required_payload_fields"]), []string{"building_id", "deployment_hub_id", "blueprint_id", "count"}) {
		t.Fatalf("queue_military_production payload fields mismatch: %#v", queue["required_payload_fields"])
	}
	blueprint := byType["blueprint_create"]
	if !catalogContains(catalogStringList(blueprint["constraints"]), "exactly one of base_frame_id or base_hull_id") {
		t.Fatalf("blueprint_create constraints missing XOR rule: %#v", blueprint["constraints"])
	}
	if _, ok := body["command_schema"].(map[string]any); !ok {
		t.Fatalf("expected command_schema object, got %#v", body["command_schema"])
	}
}

func sameCatalogFields(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	counts := map[string]int{}
	for _, v := range got {
		counts[v]++
	}
	for _, v := range want {
		counts[v]--
		if counts[v] < 0 {
			return false
		}
	}
	for _, n := range counts {
		if n != 0 {
			return false
		}
	}
	return true
}

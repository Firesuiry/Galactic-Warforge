package gateway_test

import "testing"

func catalogObjectByID(t *testing.T, entries []any, id string) map[string]any {
	t.Helper()
	for _, raw := range entries {
		entry, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("expected catalog object, got %T", raw)
		}
		if entry["id"] == id {
			return entry
		}
	}
	t.Fatalf("catalog entry %s not found", id)
	return nil
}

func catalogStringList(raw any) []string {
	if raw == nil {
		return nil
	}
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok {
			out = append(out, text)
		}
	}
	return out
}

func catalogContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func catalogLen(raw any) int {
	items, ok := raw.([]any)
	if !ok {
		return 0
	}
	return len(items)
}

func catalogInt(raw any) int {
	value, ok := raw.(float64)
	if !ok {
		return 0
	}
	return int(value)
}

func TestT103CatalogReflectsPublicTechAndBuildingClosure(t *testing.T) {
	srv, _ := newTestServer(t)
	body := getAuthorizedJSON(t, srv, "/catalog")

	buildings, ok := body["buildings"].([]any)
	if !ok {
		t.Fatalf("expected buildings array, got %T", body["buildings"])
	}

	automaticPiler := catalogObjectByID(t, buildings, "automatic_piler")
	if automaticPiler["buildable"] != false {
		t.Fatalf("expected automatic_piler to be non-buildable in public catalog, got %+v", automaticPiler)
	}

	satelliteSubstation := catalogObjectByID(t, buildings, "satellite_substation")
	if unlockTech := catalogStringList(satelliteSubstation["unlock_tech"]); len(unlockTech) != 1 || unlockTech[0] != "satellite_power" {
		t.Fatalf("expected satellite_substation unlock_tech to be [satellite_power], got %+v", satelliteSubstation["unlock_tech"])
	}

	techEntries, ok := body["techs"].([]any)
	if !ok {
		t.Fatalf("expected techs array, got %T", body["techs"])
	}

	techsByID := make(map[string]map[string]any, len(techEntries))
	for _, raw := range techEntries {
		entry, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("expected tech object, got %T", raw)
		}
		id, _ := entry["id"].(string)
		techsByID[id] = entry

		if hidden, ok := entry["hidden"].(bool); ok && hidden {
			t.Fatalf("expected public tech catalog to exclude hidden techs, leaked %+v", entry)
		}

		if catalogInt(entry["max_level"]) == 0 &&
			catalogLen(entry["unlocks"]) == 0 &&
			catalogLen(entry["effects"]) == 0 &&
			len(catalogStringList(entry["leads_to"])) == 0 {
			t.Fatalf("expected public tech catalog to exclude dead-end techs, leaked %+v", entry)
		}
	}

	for _, hiddenTech := range []string{
		"casimir_crystal",
		"crystal_explosive",
		"crystal_shell",
		"proliferator_mk2",
		"proliferator_mk3",
		"reformed_refinement",
		"super_magnetic",
		"supersonic_missile",
		"titanium_ammo",
		"wave_interference",
		"xray_cracking",
	} {
		if _, exists := techsByID[hiddenTech]; exists {
			t.Fatalf("expected hidden dead-end tech %s to be absent from /catalog.techs", hiddenTech)
		}
	}

	particleControl := techsByID["particle_control"]
	if particleControl == nil {
		t.Fatal("expected particle_control to stay visible as a bridge tech")
	}
	particleLeadsTo := catalogStringList(particleControl["leads_to"])
	if !catalogContains(particleLeadsTo, "information_matrix") {
		t.Fatalf("expected particle_control.leads_to to include information_matrix, got %+v", particleLeadsTo)
	}
	if catalogContains(particleLeadsTo, "casimir_crystal") {
		t.Fatalf("expected particle_control.leads_to to exclude hidden dead-end casimir_crystal, got %+v", particleLeadsTo)
	}

	highStrengthGlass := techsByID["high_strength_glass"]
	if highStrengthGlass == nil {
		t.Fatal("expected high_strength_glass to stay visible as a bridge tech")
	}
	glassLeadsTo := catalogStringList(highStrengthGlass["leads_to"])
	if !catalogContains(glassLeadsTo, "high_energy_laser") {
		t.Fatalf("expected high_strength_glass.leads_to to include high_energy_laser, got %+v", glassLeadsTo)
	}
	if catalogContains(glassLeadsTo, "crystal_explosive") {
		t.Fatalf("expected high_strength_glass.leads_to to exclude hidden dead-end crystal_explosive, got %+v", glassLeadsTo)
	}
}

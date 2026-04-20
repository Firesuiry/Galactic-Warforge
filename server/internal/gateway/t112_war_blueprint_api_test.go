package gateway_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"siliconworld/internal/model"
)

func TestWarBlueprintEndpoints(t *testing.T) {
	srv, core := newTestServer(t)
	ws := core.World()
	ws.Players["p1"].SetPermissions([]string{"*"})

	preset, ok := model.PublicWarBlueprintDefinitionByID(model.ItemPrototype)
	if !ok {
		t.Fatalf("expected preset blueprint %s", model.ItemPrototype)
	}
	blueprint, err := model.NewPlayerWarBlueprintDraft("p1", "bp-api-1", "API Prototype", preset.BaseFrameID)
	if err != nil {
		t.Fatalf("create blueprint: %v", err)
	}
	for slotID, componentID := range preset.SlotAssignments {
		if err := blueprint.ApplyComponent(slotID, componentID); err != nil {
			t.Fatalf("apply component %s=%s: %v", slotID, componentID, err)
		}
	}
	validation := model.ValidateWarBlueprint(*blueprint)
	blueprint.Status = model.WarBlueprintStatusValidated
	blueprint.LastValidation = &validation
	ws.Players["p1"].EnsureWarBlueprints()[blueprint.ID] = blueprint

	req := httptest.NewRequest("GET", "/war/blueprints", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var listBody map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &listBody); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	blueprints, ok := listBody["blueprints"].([]any)
	if !ok || len(blueprints) != 1 {
		t.Fatalf("expected one blueprint in list, got %+v", listBody)
	}

	req = httptest.NewRequest("GET", "/war/blueprints/bp-api-1", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var detailBody map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &detailBody); err != nil {
		t.Fatalf("decode detail response: %v", err)
	}
	if detailBody["id"] != "bp-api-1" {
		t.Fatalf("unexpected blueprint detail: %+v", detailBody)
	}
	lastValidation, ok := detailBody["last_validation"].(map[string]any)
	if !ok {
		t.Fatalf("expected last_validation in detail body, got %+v", detailBody)
	}
	if valid, ok := lastValidation["valid"].(bool); !ok || !valid {
		t.Fatalf("expected valid last_validation, got %+v", lastValidation)
	}
}

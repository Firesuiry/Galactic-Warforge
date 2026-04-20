package gateway_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"siliconworld/internal/gateway"
	"siliconworld/internal/model"
	"siliconworld/internal/startup"
)

type warAuthT122 struct {
	playerID string
	playerKey string
}

func TestT122OfficialWarScenarioSupportsAuthoritativeRegressionFlow(t *testing.T) {
	srv, app := newOfficialWarServerT122(t)

	p1 := warAuthT122{playerID: "p1", playerKey: "key_player_1"}
	planetID := app.Core.World().PlanetID
	systemID := app.Maps.PrimaryPlanet().SystemID

	p1FactoryID := findOwnedBuildingIDT122(t, srv, p1, planetID, "p1", "recomposing_assembler")
	p1HubID := findOwnedBuildingIDT122(t, srv, p1, planetID, "p1", "battlefield_analysis_base")

	postCommandsT122(t, srv, p1, []model.Command{
		{
			Type: model.CmdBlueprintVariant,
			Payload: map[string]any{
				"parent_blueprint_id": "corvette",
				"blueprint_id":        "corvette_gateway_t122",
				"allowed_slot_ids":    []string{"utility"},
			},
		},
		{
			Type:    model.CmdBlueprintValidate,
			Payload: map[string]any{"blueprint_id": "corvette_gateway_t122"},
		},
		{
			Type: model.CmdBlueprintFinalize,
			Payload: map[string]any{
				"blueprint_id":  "corvette_gateway_t122",
				"target_state":  string(model.WarBlueprintStatePrototype),
			},
		},
	})

	waitForCondition(t, 8*time.Second, func() bool {
		body, status := getAuthorizedJSONStatusT122(t, srv, p1, "/world/warfare/blueprints/corvette_gateway_t122")
		return status == 200 && body["state"] == string(model.WarBlueprintStatePrototype)
	}, "official war blueprint did not reach prototype state")

	industryBody := getAuthorizedJSONT122(t, srv, p1, "/world/warfare/industry")
	assertSupplyNodeLabelT122(t, industryBody, "Orbital Supply Port")
	assertSupplyNodeLabelT122(t, industryBody, "Planetary Logistics Station")
	assertSupplyNodeLabelT122(t, industryBody, "Interstellar Logistics Station")

	postCommandsT122(t, srv, p1, []model.Command{{
		Type: model.CmdQueueMilitaryProduction,
		Payload: map[string]any{
			"building_id":       p1FactoryID,
			"deployment_hub_id": p1HubID,
			"blueprint_id":      "corvette_gateway_t122",
			"count":             1,
		},
	}})

	waitForCondition(t, productionReadyTimeoutT122(t, app, p1.playerID, p1FactoryID, "corvette_gateway_t122"), func() bool {
		body := getAuthorizedJSONT122(t, srv, p1, "/world/warfare/industry")
		return readyPayloadCountT122(body, p1HubID, "corvette_gateway_t122") >= 1
	}, "official war production did not yield a ready payload")

	postCommandsT122(t, srv, p1, []model.Command{{
		Type: model.CmdCommissionFleet,
		Payload: map[string]any{
			"building_id":  p1HubID,
			"blueprint_id": "corvette_gateway_t122",
			"count":        1,
			"system_id":    systemID,
			"fleet_id":     "fleet-gateway-t122",
		},
	}})

	waitForCondition(t, 8*time.Second, func() bool {
		body, status := getAuthorizedJSONStatusT122(t, srv, p1, "/world/fleets/fleet-gateway-t122")
		return status == 200 && body["fleet_id"] == "fleet-gateway-t122"
	}, "official war fleet commission did not materialize")

	fleetBody := getAuthorizedJSONT122(t, srv, p1, "/world/fleets/fleet-gateway-t122")
	assertFleetHasSupplyT122(t, fleetBody)

	ws := app.Core.World()
	ws.Lock()
	ws.EnemyForces = &model.EnemyForceState{
		SystemID: systemID,
		Forces: []model.EnemyForce{{
			ID:           "enemy-gateway-t122",
			Type:         model.EnemyForceTypeBeacon,
			Position:     model.Position{X: ws.MapWidth / 2, Y: ws.MapHeight / 2},
			Strength:     1,
			TargetPlayer: "p1",
			SpawnTick:    ws.Tick,
		}},
	}
	ws.Unlock()

	postCommandsT122(t, srv, p1, []model.Command{{
		Type: model.CmdFleetAttack,
		Payload: map[string]any{
			"fleet_id":  "fleet-gateway-t122",
			"planet_id": planetID,
			"target_id": "enemy-gateway-t122",
		},
	}})

	waitForCondition(t, 8*time.Second, func() bool {
		body := getAuthorizedJSONT122(t, srv, p1, "/world/fleets/fleet-gateway-t122")
		lastReport, ok := body["last_battle_report"].(map[string]any)
		if !ok {
			return false
		}
		return lastReport["battle_id"] != nil && body["state"] == "idle"
	}, "official war battle report did not appear on fleet detail")

	systemRuntimeBody := getAuthorizedJSONT122(t, srv, p1, "/world/systems/"+systemID+"/runtime")
	assertBattleReportsPresentT122(t, systemRuntimeBody)

	postCommandsT122(t, srv, p1, []model.Command{
		{
			Type:    model.CmdTaskForceCreate,
			Payload: map[string]any{"task_force_id": "tf-gateway-t122", "stance": string(model.WarTaskForceStanceEscort)},
		},
		{
			Type: model.CmdTaskForceAssign,
			Payload: map[string]any{
				"task_force_id": "tf-gateway-t122",
				"member_kind":   string(model.WarTaskForceMemberKindFleet),
				"member_ids":    []string{"fleet-gateway-t122"},
			},
		},
		{
			Type: model.CmdTaskForceDeploy,
			Payload: map[string]any{
				"task_force_id": "tf-gateway-t122",
				"system_id":     systemID,
				"planet_id":     planetID,
			},
		},
	})

	postCommandsT122(t, srv, p1, []model.Command{{
		Type: model.CmdBlockadePlanet,
		Payload: map[string]any{
			"task_force_id": "tf-gateway-t122",
			"planet_id":     planetID,
		},
	}})

	waitForCondition(t, 8*time.Second, func() bool {
		body := getAuthorizedJSONT122(t, srv, p1, "/world/systems/"+systemID+"/runtime")
		superiority, ok := body["orbital_superiority"].(map[string]any)
		if !ok || superiority["advantage_player_id"] != "p1" {
			return false
		}
		blockades, ok := body["planet_blockades"].([]any)
		if !ok || len(blockades) == 0 {
			return false
		}
		blockade, ok := blockades[0].(map[string]any)
		return ok && blockade["status"] == string(model.PlanetBlockadeStatusActive)
	}, "official war blockade did not reach active orbital superiority state")

	postCommandsT122(t, srv, p1, []model.Command{{
		Type: model.CmdLandingStart,
		Payload: map[string]any{
			"operation_id":  "landing-gateway-t122",
			"task_force_id": "tf-gateway-t122",
			"planet_id":     planetID,
		},
	}})

	waitForCondition(t, 8*time.Second, func() bool {
		body := getAuthorizedJSONT122(t, srv, p1, "/world/systems/"+systemID+"/runtime")
		operation, ok := findOperationByIDT122(body, "landing_operations", "landing-gateway-t122")
		if !ok {
			return false
		}
		return operation["result"] == string(model.LandingOperationResultSuccess) &&
			operation["stage"] == string(model.LandingOperationStageBeachheadEstablished) &&
			operation["bridgehead_id"] != ""
	}, "official war landing operation did not establish a bridgehead")
}

func newOfficialWarServerT122(t *testing.T) (*gateway.Server, *startup.App) {
	t.Helper()

	cfgPath := filepath.Join("..", "..", "config-war.yaml")
	mapCfgPath := filepath.Join("..", "..", "map-war.yaml")
	rawCfg, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("read official war config: %v", err)
	}

	root := t.TempDir()
	tempCfgPath := filepath.Join(root, "config-war.yaml")
	dataDir := filepath.Join(root, "data-war")
	rewritten := strings.Replace(string(rawCfg), `data_dir: "data-war"`, `data_dir: "`+dataDir+`"`, 1)
	if err := os.WriteFile(tempCfgPath, []byte(rewritten), 0o644); err != nil {
		t.Fatalf("write temp official war config: %v", err)
	}

	app, err := startup.LoadRuntime(tempCfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load official war runtime: %v", err)
	}
	go app.Core.Run()
	t.Cleanup(app.Stop)

	return gateway.New(app.Config, app.Core, app.Bus, app.Queue), app
}

func postCommandsT122(t *testing.T, srv *gateway.Server, auth warAuthT122, commands []model.Command) model.CommandResponse {
	t.Helper()

	payload := model.CommandRequest{
		RequestID:  auth.playerID + "-" + time.Now().Format("150405.000000000"),
		IssuerType: "player",
		IssuerID:   auth.playerID,
		Commands:   commands,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal command request: %v", err)
	}
	req := authorizedRequestT122(t, auth, "POST", "/commands", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptestResponseT122(t, srv, req)
	if rec.Code != 202 {
		t.Fatalf("expected 202 for %+v, got %d: %s", commands, rec.Code, rec.Body.String())
	}

	var response model.CommandResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode command response: %v", err)
	}
	if !response.Accepted {
		t.Fatalf("expected accepted command response, got %+v", response)
	}
	return response
}

func getAuthorizedJSONT122(t *testing.T, srv *gateway.Server, auth warAuthT122, path string) map[string]any {
	t.Helper()
	req := authorizedRequestT122(t, auth, "GET", path, nil)
	rec := httptestResponseT122(t, srv, req)
	if rec.Code != 200 {
		t.Fatalf("expected 200 for %s, got %d: %s", path, rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %s response: %v", path, err)
	}
	return body
}

func getAuthorizedJSONStatusT122(t *testing.T, srv *gateway.Server, auth warAuthT122, path string) (map[string]any, int) {
	t.Helper()
	req := authorizedRequestT122(t, auth, "GET", path, nil)
	rec := httptestResponseT122(t, srv, req)
	if rec.Code != 200 {
		return nil, rec.Code
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %s response: %v", path, err)
	}
	return body, rec.Code
}

func findOwnedBuildingIDT122(t *testing.T, srv *gateway.Server, auth warAuthT122, planetID, ownerID, buildingType string) string {
	t.Helper()
	body := getAuthorizedJSONT122(t, srv, auth, "/world/planets/"+planetID+"/scene?x=0&y=0&width=48&height=48")
	buildings, ok := body["buildings"].(map[string]any)
	if !ok {
		t.Fatalf("expected buildings map in scene response, got %+v", body)
	}
	for _, raw := range buildings {
		building, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if building["owner_id"] == ownerID && building["type"] == buildingType {
			id, _ := building["id"].(string)
			if id != "" {
				return id
			}
		}
	}
	t.Fatalf("missing building %s for %s in authoritative war scene", buildingType, ownerID)
	return ""
}

func readyPayloadCountT122(industryBody map[string]any, hubID, blueprintID string) int {
	hubs, ok := industryBody["deployment_hubs"].([]any)
	if !ok {
		return 0
	}
	for _, raw := range hubs {
		hub, ok := raw.(map[string]any)
		if !ok || hub["building_id"] != hubID {
			continue
		}
		readyPayloads, ok := hub["ready_payloads"].(map[string]any)
		if !ok {
			return 0
		}
		if count, ok := readyPayloads[blueprintID].(float64); ok {
			return int(count)
		}
	}
	return 0
}

func findOperationByIDT122(body map[string]any, key, operationID string) (map[string]any, bool) {
	value, ok := body[key]
	if !ok || value == nil {
		return nil, false
	}
	list, ok := value.([]any)
	if !ok {
		return nil, false
	}
	for _, raw := range list {
		operation, ok := raw.(map[string]any)
		if !ok || operation["id"] != operationID {
			continue
		}
		return operation, true
	}
	return nil, false
}

func productionReadyTimeoutT122(t *testing.T, app *startup.App, playerID, factoryID, blueprintID string) time.Duration {
	t.Helper()

	ws := app.Core.World()
	if ws == nil {
		t.Fatal("expected active world for authoritative war runtime")
	}
	player := ws.Players[playerID]
	if player == nil {
		t.Fatalf("expected player %s in authoritative war runtime", playerID)
	}
	blueprint, ok := model.ResolveWarBlueprintForPlayer(player, blueprintID)
	if !ok {
		t.Fatalf("expected blueprint %s to be resolvable for %s", blueprintID, playerID)
	}
	factory := ws.Buildings[factoryID]
	throughput := 1
	if factory != nil && factory.Runtime.Functions.Production != nil && factory.Runtime.Functions.Production.Throughput > 0 {
		throughput = factory.Runtime.Functions.Production.Throughput
	}

	componentTicks := int64(30 + len(blueprint.Components)*10)
	assemblyTicks := int64(40 + len(blueprint.Components)*12)
	if blueprint.BaseHullID != "" {
		componentTicks += 20
		assemblyTicks += 30
	}
	componentTicks /= int64(throughput)
	assemblyTicks /= int64(throughput)
	if componentTicks < 8 {
		componentTicks = 8
	}
	if assemblyTicks < 12 {
		assemblyTicks = 12
	}

	tickRate := app.Config.Battlefield.MaxTickRate
	if tickRate <= 0 {
		tickRate = 1
	}
	totalTicks := componentTicks + assemblyTicks + int64(tickRate*2)
	return time.Duration(totalTicks) * time.Second / time.Duration(tickRate)
}

func assertSupplyNodeLabelT122(t *testing.T, industryBody map[string]any, label string) {
	t.Helper()
	for _, raw := range listFieldT122(t, industryBody, "supply_nodes") {
		node, ok := raw.(map[string]any)
		if ok && node["label"] == label {
			return
		}
	}
	t.Fatalf("expected supply node %q in %+v", label, industryBody["supply_nodes"])
}

func assertFleetHasSupplyT122(t *testing.T, fleetBody map[string]any) {
	t.Helper()
	sustainment, ok := fleetBody["sustainment"].(map[string]any)
	if !ok {
		t.Fatalf("expected sustainment on fleet detail, got %+v", fleetBody)
	}
	current, ok := sustainment["current"].(map[string]any)
	if !ok {
		t.Fatalf("expected sustainment.current on fleet detail, got %+v", sustainment)
	}
	ammo, ammoOK := current["ammo"].(float64)
	fuel, fuelOK := current["fuel"].(float64)
	if !ammoOK || !fuelOK || ammo <= 0 || fuel <= 0 {
		t.Fatalf("expected commissioned fleet to carry war supply, got %+v", current)
	}
}

func assertBattleReportsPresentT122(t *testing.T, systemRuntimeBody map[string]any) {
	t.Helper()
	reports := listFieldT122(t, systemRuntimeBody, "battle_reports")
	if len(reports) == 0 {
		t.Fatalf("expected battle reports in %+v", systemRuntimeBody)
	}
	report, ok := reports[0].(map[string]any)
	if !ok || report["battle_id"] == nil {
		t.Fatalf("expected battle report payload, got %+v", reports[0])
	}
}

func listFieldT122(t *testing.T, body map[string]any, key string) []any {
	t.Helper()
	raw, ok := body[key]
	if !ok {
		t.Fatalf("expected field %q in %+v", key, body)
	}
	list, ok := raw.([]any)
	if !ok {
		t.Fatalf("expected list field %q, got %T", key, raw)
	}
	return list
}

func authorizedRequestT122(t *testing.T, auth warAuthT122, method, path string, body *bytes.Reader) *http.Request {
	t.Helper()
	var req *http.Request
	var err error
	if body == nil {
		req, err = http.NewRequest(method, path, nil)
	} else {
		req, err = http.NewRequest(method, path, body)
	}
	if err != nil {
		t.Fatalf("new request %s %s: %v", method, path, err)
	}
	req.Header.Set("Authorization", "Bearer "+auth.playerKey)
	return req
}

func httptestResponseT122(t *testing.T, srv *gateway.Server, req *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	return rec
}

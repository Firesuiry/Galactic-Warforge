package model

import "testing"

func TestTrafficMonitorPublicCommandCatalogAndEvent(t *testing.T) {
	command := Command{Type: CmdConfigureTrafficMonitor, Target: CommandTarget{EntityID: "m"}, Payload: map[string]any{"target_belt_id": "", "window_ticks": 30, "minimum_items_per_tick": 0.5, "alerts_enabled": false}}
	if issues := ValidateCommandStructure(command); len(issues) > 0 {
		t.Fatalf("valid command rejected: %+v", issues)
	}
	delete(command.Payload, "alerts_enabled")
	if len(ValidateCommandStructure(command)) == 0 {
		t.Fatal("missing configuration field accepted")
	}
	found := false
	for _, entry := range BuildCommandCatalog().Commands {
		if entry.Type == string(CmdConfigureTrafficMonitor) {
			found = true
			if len(entry.RequiredPayloadFields) != 4 {
				t.Fatal("catalog missing required fields")
			}
		}
	}
	if !found {
		t.Fatal("monitor command omitted from catalog")
	}
	if got := schemaForPayloadField("window_ticks"); got["type"] != "integer" || got["maximum"] != 600 {
		t.Fatal("invalid sampling window schema")
	}
	if got := schemaForPayloadField("alerts_enabled"); got["type"] != "boolean" {
		t.Fatal("invalid alerts schema")
	}
	found = false
	for _, event := range allEventTypes {
		if event == EvtTrafficMonitorAlert {
			found = true
		}
	}
	if !found {
		t.Fatal("monitor alert omitted from event types")
	}
}

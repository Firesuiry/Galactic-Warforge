package model

import (
	"fmt"
	"strings"
)

// CommandCatalogView is the machine-readable public command catalog.
// GUI forms, CLI, agent prompts and skills should share this as the single source of truth.
type CommandCatalogView struct {
	Version       int                    `json:"version"`
	Commands      []CommandCatalogEntry  `json:"commands"`
	CommandSchema map[string]any         `json:"command_schema,omitempty"`
}

// CommandCatalogEntry describes structural requirements for one public command type.
type CommandCatalogEntry struct {
	Type                  string         `json:"type"`
	RequiredTargetFields  []string       `json:"required_target_fields"`
	RequiredPayloadFields []string       `json:"required_payload_fields"`
	OptionalPayloadFields []string       `json:"optional_payload_fields,omitempty"`
	RequiredLayer         string         `json:"required_layer,omitempty"`
	Constraints           []string       `json:"constraints,omitempty"`
	Schema                map[string]any `json:"schema"`
}

// CommandStructureSpec is the shared structural registry entry used by both
// catalog export and gateway precheck validation.
type CommandStructureSpec struct {
	Type                  CommandType
	RequiredTargetFields  []string
	RequiredPayloadFields []string
	OptionalPayloadFields []string
	RequiredLayer         string
	Constraints           []string
	// ExtraValidation runs after required-field checks (e.g. XOR constraints).
	ExtraValidation func(cmd Command) []CommandIssue
}

// commandStructureRegistry returns one complete structural spec per public command.
// Order matches AllCommandTypes().
func commandStructureRegistry() []CommandStructureSpec {
	return []CommandStructureSpec{
		{
			Type:                 CmdBuild,
			RequiredTargetFields: []string{"position"},
			RequiredPayloadFields: []string{"building_type"},
			OptionalPayloadFields: []string{"recipe_id", "direction"},
			ExtraValidation: func(cmd Command) []CommandIssue {
				if recipeID, ok := cmd.Payload["recipe_id"]; ok {
					if strings.TrimSpace(fmt.Sprintf("%v", recipeID)) == "" {
						return []CommandIssue{InvalidValueIssue(
							"payload.recipe_id",
							"payload.recipe_id must be a non-empty string when provided",
							"non-empty string",
							recipeID,
						)}
					}
				}
				return nil
			},
		},
		{
			Type:                 CmdMove,
			RequiredTargetFields: []string{"entity_id", "position"},
		},
		{
			Type:                  CmdAttack,
			RequiredTargetFields:  []string{"entity_id"},
			RequiredPayloadFields: []string{"target_entity_id"},
		},
		{
			Type:                  CmdProduce,
			RequiredTargetFields:  []string{"entity_id"},
			RequiredPayloadFields: []string{"unit_type"},
		},
		{
			Type:                 CmdUpgrade,
			RequiredTargetFields: []string{"entity_id"},
		},
		{
			Type:                 CmdDemolish,
			RequiredTargetFields: []string{"entity_id"},
		},
		{
			Type:                 CmdConfigureLogisticsStation,
			RequiredTargetFields: []string{"entity_id"},
			OptionalPayloadFields: []string{
				"input_priority",
				"output_priority",
				"drone_capacity",
				"interstellar",
			},
		},
		{
			Type:                  CmdConfigureLogisticsSlot,
			RequiredTargetFields:  []string{"entity_id"},
			RequiredPayloadFields: []string{"scope", "item_id", "mode", "local_storage"},
		},
		{
			Type:                 CmdScanGalaxy,
			RequiredTargetFields: []string{"galaxy_id"},
			RequiredLayer:        "galaxy",
		},
		{
			Type:                 CmdScanSystem,
			RequiredTargetFields: []string{"system_id"},
			RequiredLayer:        "system",
		},
		{
			Type:                 CmdScanPlanet,
			RequiredTargetFields: []string{"planet_id"},
			RequiredLayer:        "planet",
		},
		{
			Type:                  CmdCancelConstruction,
			RequiredPayloadFields: []string{"task_id"},
		},
		{
			Type:                  CmdRestoreConstruction,
			RequiredPayloadFields: []string{"task_id"},
		},
		{
			Type:                  CmdStartResearch,
			RequiredPayloadFields: []string{"tech_id"},
		},
		{
			Type:                  CmdCancelResearch,
			RequiredPayloadFields: []string{"tech_id"},
		},
		{
			Type:                  CmdSwitchActivePlanet,
			RequiredPayloadFields: []string{"planet_id"},
		},
		{
			Type:                  CmdTransferItem,
			RequiredPayloadFields: []string{"building_id", "item_id", "quantity"},
		},
		{
			Type:                  CmdLaunchSolarSail,
			RequiredPayloadFields: []string{"building_id"},
			OptionalPayloadFields: []string{"count", "orbit_radius", "inclination"},
		},
		{
			Type:                  CmdLaunchRocket,
			RequiredPayloadFields: []string{"building_id", "system_id"},
			OptionalPayloadFields: []string{"layer_index", "count"},
		},
		{
			Type:                  CmdSetRayReceiverMode,
			RequiredPayloadFields: []string{"building_id", "mode"},
		},
		{
			Type:                  CmdDeploySquad,
			RequiredPayloadFields: []string{"building_id", "blueprint_id", "count"},
			OptionalPayloadFields: []string{"planet_id"},
		},
		{
			Type:                  CmdCommissionFleet,
			RequiredPayloadFields: []string{"building_id", "blueprint_id", "count", "system_id"},
			OptionalPayloadFields: []string{"fleet_id"},
		},
		{
			Type:                  CmdFleetAssign,
			RequiredPayloadFields: []string{"fleet_id", "formation"},
		},
		{
			Type:                  CmdFleetAttack,
			RequiredPayloadFields: []string{"fleet_id", "planet_id", "target_id"},
		},
		{
			Type:                  CmdFleetMove,
			RequiredPayloadFields: []string{"fleet_id", "target_system_id"},
		},
		{
			Type:                  CmdFleetDisband,
			RequiredPayloadFields: []string{"fleet_id"},
		},
		{
			Type:                  CmdTaskForceCreate,
			RequiredPayloadFields: []string{"task_force_id"},
			OptionalPayloadFields: []string{"name", "stance"},
		},
		{
			Type:                  CmdTaskForceAssign,
			RequiredPayloadFields: []string{"task_force_id", "member_kind", "member_ids"},
		},
		{
			Type:                  CmdTaskForceSetStance,
			RequiredPayloadFields: []string{"task_force_id", "stance"},
		},
		{
			Type:                  CmdTaskForceDeploy,
			RequiredPayloadFields: []string{"task_force_id"},
			OptionalPayloadFields: []string{
				"theater_id",
				"system_id",
				"planet_id",
				"position",
				"frontline_id",
				"ground_order",
				"support_mode",
			},
			Constraints: []string{
				"at least one of system_id, planet_id, position, frontline_id, ground_order is expected at runtime",
			},
		},
		{
			Type:                  CmdTheaterCreate,
			RequiredPayloadFields: []string{"theater_id"},
			OptionalPayloadFields: []string{"name"},
		},
		{
			Type:                  CmdTheaterDefineZone,
			RequiredPayloadFields: []string{"theater_id", "zone_type"},
			OptionalPayloadFields: []string{"system_id", "planet_id", "position", "radius"},
		},
		{
			Type:                  CmdTheaterSetObjective,
			RequiredPayloadFields: []string{"theater_id", "objective_type"},
			OptionalPayloadFields: []string{"system_id", "planet_id", "entity_id", "description"},
		},
		{
			Type:                  CmdBlockadePlanet,
			RequiredPayloadFields: []string{"task_force_id", "planet_id"},
		},
		{
			Type:                  CmdLandingStart,
			RequiredPayloadFields: []string{"task_force_id", "planet_id"},
			OptionalPayloadFields: []string{"operation_id"},
		},
		{
			Type:                  CmdBlueprintCreate,
			RequiredPayloadFields: []string{"blueprint_id", "domain"},
			OptionalPayloadFields: []string{"name", "base_frame_id", "base_hull_id"},
			Constraints: []string{
				"exactly one of base_frame_id or base_hull_id",
			},
			ExtraValidation: func(cmd Command) []CommandIssue {
				_, hasFrame := cmd.Payload["base_frame_id"]
				_, hasHull := cmd.Payload["base_hull_id"]
				if hasFrame == hasHull {
					var actual any
					if hasFrame && hasHull {
						actual = []string{"base_frame_id", "base_hull_id"}
					}
					return []CommandIssue{InvalidValueIssue(
						"payload.base_frame_id|payload.base_hull_id",
						"blueprint_create requires exactly one of payload.base_frame_id or payload.base_hull_id",
						"exactly one of base_frame_id or base_hull_id",
						actual,
					)}
				}
				return nil
			},
		},
		{
			Type:                  CmdBlueprintSetComponent,
			RequiredPayloadFields: []string{"blueprint_id", "slot_id", "component_id"},
		},
		{
			Type:                  CmdBlueprintValidate,
			RequiredPayloadFields: []string{"blueprint_id"},
		},
		{
			Type:                  CmdBlueprintFinalize,
			RequiredPayloadFields: []string{"blueprint_id"},
			OptionalPayloadFields: []string{"target_state"},
		},
		{
			Type:                  CmdBlueprintVariant,
			RequiredPayloadFields: []string{"parent_blueprint_id", "blueprint_id", "allowed_slot_ids"},
			OptionalPayloadFields: []string{"name"},
		},
		{
			Type:                  CmdQueueMilitaryProduction,
			RequiredPayloadFields: []string{"building_id", "deployment_hub_id", "blueprint_id", "count"},
		},
		{
			Type:                  CmdRefitUnit,
			RequiredPayloadFields: []string{"building_id", "unit_id", "target_blueprint_id"},
		},
		{
			Type:                  CmdBuildDysonNode,
			RequiredPayloadFields: []string{"system_id", "layer_index", "latitude", "longitude"},
			OptionalPayloadFields: []string{"orbit_radius"},
		},
		{
			Type:                  CmdBuildDysonFrame,
			RequiredPayloadFields: []string{"system_id", "layer_index", "node_a_id", "node_b_id"},
		},
		{
			Type:                  CmdBuildDysonShell,
			RequiredPayloadFields: []string{"system_id", "layer_index", "latitude_min", "latitude_max", "coverage"},
		},
		{
			Type:                  CmdDemolishDyson,
			RequiredPayloadFields: []string{"system_id", "component_type", "component_id"},
		},
	}
}

// CommandStructureByType returns the structural registry keyed by command type.
func CommandStructureByType() map[CommandType]CommandStructureSpec {
	specs := commandStructureRegistry()
	out := make(map[CommandType]CommandStructureSpec, len(specs))
	for _, spec := range specs {
		out[spec.Type] = spec
	}
	return out
}

// BuildCommandCatalog builds the full public command catalog for GET /catalog/commands.
func BuildCommandCatalog() CommandCatalogView {
	specs := commandStructureRegistry()
	entries := make([]CommandCatalogEntry, 0, len(specs))
	oneOf := make([]any, 0, len(specs))
	for _, spec := range specs {
		entry := CommandCatalogEntry{
			Type:                  string(spec.Type),
			RequiredTargetFields:  cloneStringsOrEmpty(spec.RequiredTargetFields),
			RequiredPayloadFields: cloneStringsOrEmpty(spec.RequiredPayloadFields),
			OptionalPayloadFields: cloneStrings(spec.OptionalPayloadFields),
			RequiredLayer:         spec.RequiredLayer,
			Constraints:           cloneStrings(spec.Constraints),
			Schema:                buildCommandSchema(spec),
		}
		entries = append(entries, entry)
		oneOf = append(oneOf, entry.Schema)
	}
	return CommandCatalogView{
		Version:  1,
		Commands: entries,
		CommandSchema: map[string]any{
			"$schema":     "https://json-schema.org/draft/2020-12/schema",
			"title":       "SiliconWorld Command",
			"description": "One public game command object (type + target + payload)",
			"oneOf":       oneOf,
		},
	}
}

// ValidateCommandStructure performs fast structural validation without world access.
// It is the authoritative structural check shared by gateway precheck and catalog consumers.
func ValidateCommandStructure(cmd Command) []CommandIssue {
	spec, ok := CommandStructureByType()[cmd.Type]
	if !ok {
		return []CommandIssue{UnknownCommandIssue(string(cmd.Type))}
	}

	var issues []CommandIssue
	for _, field := range spec.RequiredTargetFields {
		issues = append(issues, requireTargetField(cmd, field)...)
	}
	if spec.RequiredLayer != "" {
		issues = append(issues, requireTargetLayer(cmd, spec.RequiredLayer)...)
	}
	issues = append(issues, requirePayloadFields(cmd.Payload, spec.RequiredPayloadFields...)...)
	if spec.ExtraValidation != nil {
		issues = append(issues, spec.ExtraValidation(cmd)...)
	}
	return issues
}

func requirePayloadFields(payload map[string]any, fields ...string) []CommandIssue {
	if len(fields) == 0 {
		return nil
	}
	if payload == nil {
		payload = map[string]any{}
	}
	var issues []CommandIssue
	for _, field := range fields {
		if _, ok := payload[field]; !ok {
			issues = append(issues, MissingFieldIssue("payload."+field))
		}
	}
	return issues
}

func requireTargetField(cmd Command, field string) []CommandIssue {
	switch field {
	case "entity_id":
		if cmd.Target.EntityID == "" {
			return []CommandIssue{MissingFieldIssue("target.entity_id")}
		}
	case "position":
		if cmd.Target.Position == nil {
			return []CommandIssue{MissingFieldIssue("target.position")}
		}
	case "galaxy_id":
		if cmd.Target.GalaxyID == "" {
			return []CommandIssue{MissingFieldIssue("target.galaxy_id")}
		}
	case "system_id":
		if cmd.Target.SystemID == "" {
			return []CommandIssue{MissingFieldIssue("target.system_id")}
		}
	case "planet_id":
		if cmd.Target.PlanetID == "" {
			return []CommandIssue{MissingFieldIssue("target.planet_id")}
		}
	case "layer":
		if cmd.Target.Layer == "" {
			return []CommandIssue{MissingFieldIssue("target.layer")}
		}
	default:
		return []CommandIssue{MissingFieldIssue("target." + field)}
	}
	return nil
}

func requireTargetLayer(cmd Command, expected string) []CommandIssue {
	if cmd.Target.Layer != "" && cmd.Target.Layer != expected {
		return []CommandIssue{InvalidValueIssue(
			"target.layer",
			fmt.Sprintf("target.layer must be %s", expected),
			expected,
			cmd.Target.Layer,
		)}
	}
	return nil
}

func buildCommandSchema(spec CommandStructureSpec) map[string]any {
	targetProps := map[string]any{
		"layer":     map[string]any{"type": "string"},
		"galaxy_id": map[string]any{"type": "string"},
		"system_id": map[string]any{"type": "string"},
		"planet_id": map[string]any{"type": "string"},
		"entity_id": map[string]any{"type": "string"},
		"position": map[string]any{
			"type":     "object",
			"required": []string{"x", "y"},
			"properties": map[string]any{
				"x": map[string]any{"type": "number"},
				"y": map[string]any{"type": "number"},
				"z": map[string]any{"type": "number"},
			},
		},
	}
	if spec.RequiredLayer != "" {
		targetProps["layer"] = map[string]any{
			"type":  "string",
			"const": spec.RequiredLayer,
		}
	}

	targetRequired := append([]string(nil), spec.RequiredTargetFields...)
	targetSchema := map[string]any{
		"type":       "object",
		"properties": targetProps,
	}
	if len(targetRequired) > 0 {
		targetSchema["required"] = targetRequired
	}

	payloadProps := map[string]any{}
	for _, field := range spec.RequiredPayloadFields {
		payloadProps[field] = schemaForPayloadField(field)
	}
	for _, field := range spec.OptionalPayloadFields {
		if _, exists := payloadProps[field]; !exists {
			payloadProps[field] = schemaForPayloadField(field)
		}
	}

	payloadSchema := map[string]any{
		"type":       "object",
		"properties": payloadProps,
	}
	if len(spec.RequiredPayloadFields) > 0 {
		payloadSchema["required"] = append([]string(nil), spec.RequiredPayloadFields...)
	}

	schema := map[string]any{
		"type":     "object",
		"required": []string{"type", "target"},
		"properties": map[string]any{
			"type": map[string]any{
				"type":  "string",
				"const": string(spec.Type),
			},
			"target":  targetSchema,
			"payload": payloadSchema,
		},
	}
	if len(spec.RequiredPayloadFields) > 0 {
		schema["required"] = []string{"type", "target", "payload"}
	}
	if len(spec.Constraints) > 0 {
		schema["x-constraints"] = append([]string(nil), spec.Constraints...)
	}
	return schema
}

func schemaForPayloadField(field string) map[string]any {
	switch field {
	case "count", "quantity", "layer_index", "local_storage", "drone_capacity",
		"input_priority", "output_priority", "radius":
		return map[string]any{"type": "number"}
	case "latitude", "longitude", "latitude_min", "latitude_max", "coverage",
		"orbit_radius", "inclination":
		return map[string]any{"type": "number"}
	case "member_ids", "allowed_slot_ids":
		return map[string]any{
			"type":  "array",
			"items": map[string]any{"type": "string"},
		}
	case "position":
		return map[string]any{
			"type":     "object",
			"required": []string{"x", "y"},
			"properties": map[string]any{
				"x": map[string]any{"type": "number"},
				"y": map[string]any{"type": "number"},
				"z": map[string]any{"type": "number"},
			},
		}
	case "interstellar":
		return map[string]any{
			"type": "object",
			"properties": map[string]any{
				"enabled":      map[string]any{"type": "boolean"},
				"warp_enabled": map[string]any{"type": "boolean"},
				"ship_slots":   map[string]any{"type": "number"},
			},
		}
	default:
		return map[string]any{"type": "string"}
	}
}

func cloneStrings(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	out := make([]string, len(in))
	copy(out, in)
	return out
}

func cloneStringsOrEmpty(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	return cloneStrings(in)
}

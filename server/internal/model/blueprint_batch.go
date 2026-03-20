package model

import "fmt"

// BlueprintBatchFailureMode controls how batch issues are handled.
type BlueprintBatchFailureMode string

const (
	BatchSkipInvalid BlueprintBatchFailureMode = "skip_invalid"
	BatchRollbackAll BlueprintBatchFailureMode = "rollback_all"
)

// BlueprintBatchPolicy configures batch validation behavior.
type BlueprintBatchPolicy struct {
	FailureMode  BlueprintBatchFailureMode `json:"failure_mode,omitempty"`
	ConflictMode PlanBatchMode             `json:"conflict_mode,omitempty"`
}

// BlueprintBatchIssueCode describes why a batch item failed.
type BlueprintBatchIssueCode string

const (
	BatchInvalidWorld         BlueprintBatchIssueCode = "INVALID_WORLD"
	BatchInvalidSelection     BlueprintBatchIssueCode = "INVALID_SELECTION"
	BatchEmptySelection       BlueprintBatchIssueCode = "EMPTY_SELECTION"
	BatchInvalidPlacement     BlueprintBatchIssueCode = "INVALID_PLACEMENT"
	BatchUnknownBuilding      BlueprintBatchIssueCode = "UNKNOWN_BUILDING"
	BatchNotBuildable         BlueprintBatchIssueCode = "NOT_BUILDABLE"
	BatchInvalidFootprint     BlueprintBatchIssueCode = "INVALID_FOOTPRINT"
	BatchOutOfBounds          BlueprintBatchIssueCode = "OUT_OF_BOUNDS"
	BatchTerrainBlocked       BlueprintBatchIssueCode = "TERRAIN_BLOCKED"
	BatchNoBuildZone          BlueprintBatchIssueCode = "NO_BUILD_ZONE"
	BatchOccupiedBuilding     BlueprintBatchIssueCode = "OCCUPIED_BUILDING"
	BatchOccupiedConveyor     BlueprintBatchIssueCode = "OCCUPIED_CONVEYOR"
	BatchOccupiedPipeline     BlueprintBatchIssueCode = "OCCUPIED_PIPELINE"
	BatchReservedTile         BlueprintBatchIssueCode = "RESERVED_TILE"
	BatchConflict             BlueprintBatchIssueCode = "BATCH_CONFLICT"
	BatchRequiresResourceNode BlueprintBatchIssueCode = "REQUIRES_RESOURCE_NODE"
	BatchPermissionDenied     BlueprintBatchIssueCode = "PERMISSION_DENIED"
	BatchDemolishNotAllowed   BlueprintBatchIssueCode = "DEMOLISH_NOT_ALLOWED"
	BatchDemolishBusy         BlueprintBatchIssueCode = "DEMOLISH_BUSY"
	BatchDemolishProtected    BlueprintBatchIssueCode = "DEMOLISH_PROTECTED"
	BatchDemolishNotIdle      BlueprintBatchIssueCode = "DEMOLISH_NOT_IDLE"
)

// BlueprintBatchIssue captures a non-fatal issue for a batch item.
type BlueprintBatchIssue struct {
	Code       BlueprintBatchIssueCode `json:"code"`
	ItemIndex  int                     `json:"item_index,omitempty"`
	BuildingID string                  `json:"building_id,omitempty"`
	Position   *Position               `json:"position,omitempty"`
	Message    string                  `json:"message,omitempty"`
}

// BlueprintBatchResult aggregates commands and issues from a batch operation.
type BlueprintBatchResult struct {
	Commands     []Command             `json:"commands,omitempty"`
	Issues       []BlueprintBatchIssue `json:"issues,omitempty"`
	SuccessCount int                   `json:"success_count"`
	FailureCount int                   `json:"failure_count"`
	RolledBack   bool                  `json:"rolled_back,omitempty"`
}

// BuildBlueprintBatchBuildCommands generates build commands from a placement result.
func BuildBlueprintBatchBuildCommands(ws *WorldState, placement BlueprintPlacementResult, policy BlueprintBatchPolicy) BlueprintBatchResult {
	result := BlueprintBatchResult{}
	policy = normalizeBlueprintBatchPolicy(policy)

	if ws == nil {
		result.Issues = append(result.Issues, BlueprintBatchIssue{Code: BatchInvalidWorld, Message: "world state is nil"})
		result.FailureCount = len(result.Issues)
		return result
	}

	if len(placement.Items) == 0 {
		result.Issues = append(result.Issues, BlueprintBatchIssue{Code: BatchInvalidPlacement, Message: "placement contains no items"})
		result.FailureCount = len(result.Issues)
		return result
	}

	planItems := make([]PlanItem, len(placement.Items))
	for i, item := range placement.Items {
		planItems[i] = PlanItem{
			ID:           fmt.Sprintf("bp-%d", i),
			Kind:         PlanKindBuilding,
			BuildingType: item.BuildingType,
			Position:     item.Position,
			Rotation:     item.Rotation,
		}
	}

	planRes := EvaluatePlanBatch(ws, PlanBatchRequest{
		BatchID: "blueprint-build",
		Items:   planItems,
		Policy:  PlanBatchPolicy{Mode: policy.ConflictMode},
	})

	planByID := make(map[string]PlanItemResult, len(planRes.Results))
	for _, entry := range planRes.Results {
		planByID[entry.ItemID] = entry
	}

	invalid := make([]bool, len(placement.Items))
	for i, item := range placement.Items {
		planRes, ok := planByID[planItems[i].ID]
		if !ok {
			invalid[i] = true
			result.Issues = append(result.Issues, BlueprintBatchIssue{
				Code:      BatchInvalidPlacement,
				ItemIndex: i,
				Position:  &item.Position,
				Message:   "planning result missing",
			})
			continue
		}
		if !planRes.Allowed {
			invalid[i] = true
			result.Issues = append(result.Issues, BlueprintBatchIssue{
				Code:      batchIssueFromPlan(planRes.Code),
				ItemIndex: i,
				Position:  &item.Position,
				Message:   planRes.Message,
			})
			continue
		}

		if def, ok := BuildingDefinitionByID(item.BuildingType); ok && def.RequiresResourceNode {
			if !ws.InBounds(item.Position.X, item.Position.Y) || ws.Grid[item.Position.Y][item.Position.X].ResourceNodeID == "" {
				invalid[i] = true
				result.Issues = append(result.Issues, BlueprintBatchIssue{
					Code:      BatchRequiresResourceNode,
					ItemIndex: i,
					Position:  &item.Position,
					Message:   "requires resource node",
				})
			}
		}
	}

	if policy.FailureMode == BatchRollbackAll && len(result.Issues) > 0 {
		result.RolledBack = true
		result.FailureCount = len(result.Issues)
		return result
	}

	for i, item := range placement.Items {
		if invalid[i] {
			continue
		}
		payload := map[string]any{
			"building_type": item.BuildingType,
		}
		if dir, ok := extractConveyorDirection(item.Params); ok {
			payload["direction"] = dir
		}
		if item.Rotation != "" {
			payload["rotation"] = item.Rotation
		}
		if len(item.Params) > 0 {
			payload["blueprint_params"] = item.Params
		}
		cmd := Command{
			Type:    CmdBuild,
			Target:  CommandTarget{Position: &item.Position},
			Payload: payload,
		}
		result.Commands = append(result.Commands, cmd)
	}

	result.SuccessCount = len(result.Commands)
	result.FailureCount = len(result.Issues)
	return result
}

// BuildBlueprintBatchDemolishCommands generates demolish commands for buildings inside bounds.
func BuildBlueprintBatchDemolishCommands(ws *WorldState, bounds BlueprintBounds, playerID string, policy BlueprintBatchPolicy) BlueprintBatchResult {
	result := BlueprintBatchResult{}
	policy = normalizeBlueprintBatchPolicy(policy)

	if ws == nil {
		result.Issues = append(result.Issues, BlueprintBatchIssue{Code: BatchInvalidWorld, Message: "world state is nil"})
		result.FailureCount = len(result.Issues)
		return result
	}
	if err := bounds.Validate(); err != nil {
		result.Issues = append(result.Issues, BlueprintBatchIssue{Code: BatchInvalidSelection, Message: err.Error()})
		result.FailureCount = len(result.Issues)
		return result
	}

	ids := sortedBuildingIDsByPosition(ws)
	invalid := false
	matched := 0
	for _, id := range ids {
		building := ws.Buildings[id]
		if building == nil {
			continue
		}
		if !buildingIntersectsBounds(building, bounds) {
			continue
		}
		matched++
		if playerID != "" && building.OwnerID != playerID {
			invalid = true
			result.Issues = append(result.Issues, BlueprintBatchIssue{
				Code:       BatchPermissionDenied,
				BuildingID: building.ID,
				Position:   &building.Position,
				Message:    "cannot demolish building owned by another player",
			})
			continue
		}
		if building.Type == BuildingTypeBattlefieldAnalysisBase {
			invalid = true
			result.Issues = append(result.Issues, BlueprintBatchIssue{
				Code:       BatchDemolishProtected,
				BuildingID: building.ID,
				Position:   &building.Position,
				Message:    "cannot demolish protected building",
			})
			continue
		}
		if building.Job != nil {
			invalid = true
			result.Issues = append(result.Issues, BlueprintBatchIssue{
				Code:       BatchDemolishBusy,
				BuildingID: building.ID,
				Position:   &building.Position,
				Message:    "building already has a job",
			})
			continue
		}
		rule := BuildingDemolishRuleFor(building.Type)
		if !rule.Allow {
			invalid = true
			result.Issues = append(result.Issues, BlueprintBatchIssue{
				Code:       BatchDemolishNotAllowed,
				BuildingID: building.ID,
				Position:   &building.Position,
				Message:    "building demolish not allowed",
			})
			continue
		}
		if rule.RequireIdle && building.Runtime.State != BuildingWorkIdle {
			invalid = true
			result.Issues = append(result.Issues, BlueprintBatchIssue{
				Code:       BatchDemolishNotIdle,
				BuildingID: building.ID,
				Position:   &building.Position,
				Message:    "building must be idle to demolish",
			})
			continue
		}

		cmd := Command{
			Type:   CmdDemolish,
			Target: CommandTarget{EntityID: building.ID},
		}
		result.Commands = append(result.Commands, cmd)
	}

	if matched == 0 {
		result.Issues = append(result.Issues, BlueprintBatchIssue{Code: BatchEmptySelection, Message: "no buildings in selection"})
	}

	if policy.FailureMode == BatchRollbackAll && (invalid || len(result.Issues) > 0) {
		result.Commands = nil
		result.RolledBack = true
	}

	result.SuccessCount = len(result.Commands)
	result.FailureCount = len(result.Issues)
	return result
}

// BuildBlueprintBatchDemolishCommandsFromPlacement demolishes within a blueprint placement bounds.
func BuildBlueprintBatchDemolishCommandsFromPlacement(ws *WorldState, placement BlueprintPlacementResult, playerID string, policy BlueprintBatchPolicy) BlueprintBatchResult {
	return BuildBlueprintBatchDemolishCommands(ws, placement.Bounds, playerID, policy)
}

func normalizeBlueprintBatchPolicy(policy BlueprintBatchPolicy) BlueprintBatchPolicy {
	if policy.FailureMode == "" {
		policy.FailureMode = BatchSkipInvalid
	}
	if policy.ConflictMode == "" {
		policy.ConflictMode = PlanBatchFirstWins
	}
	return policy
}

func batchIssueFromPlan(code PlanResultCode) BlueprintBatchIssueCode {
	switch code {
	case PlanInvalidWorld:
		return BatchInvalidWorld
	case PlanUnknownBuilding:
		return BatchUnknownBuilding
	case PlanNotBuildable:
		return BatchNotBuildable
	case PlanInvalidFootprint:
		return BatchInvalidFootprint
	case PlanOutOfBounds:
		return BatchOutOfBounds
	case PlanTerrainBlocked:
		return BatchTerrainBlocked
	case PlanNoBuildZone:
		return BatchNoBuildZone
	case PlanOccupiedBuilding:
		return BatchOccupiedBuilding
	case PlanOccupiedConveyor:
		return BatchOccupiedConveyor
	case PlanOccupiedPipeline:
		return BatchOccupiedPipeline
	case PlanReservedTile:
		return BatchReservedTile
	case PlanBatchConflict:
		return BatchConflict
	case PlanInvalidItem:
		return BatchInvalidPlacement
	default:
		return BatchInvalidPlacement
	}
}

func extractConveyorDirection(params BlueprintParams) (ConveyorDirection, bool) {
	if len(params) == 0 {
		return "", false
	}
	raw, ok := params["conveyor"]
	if !ok {
		return "", false
	}
	switch val := raw.(type) {
	case map[string]any:
		if dir, ok := coerceConveyorDirection(val["output"]); ok {
			return dir, true
		}
		return "", false
	case ConveyorBlueprintParams:
		if val.Output.Valid() {
			return val.Output, true
		}
		return "", false
	case *ConveyorBlueprintParams:
		if val != nil && val.Output.Valid() {
			return val.Output, true
		}
		return "", false
	default:
		return "", false
	}
}

func buildingIntersectsBounds(building *Building, bounds BlueprintBounds) bool {
	if building == nil {
		return false
	}
	offsets, _, err := blueprintFootprintOffsets(building)
	if err != nil {
		return positionInBounds(building.Position, bounds)
	}
	for _, offset := range offsets {
		pos := Position{X: building.Position.X + offset.X, Y: building.Position.Y + offset.Y, Z: building.Position.Z}
		if positionInBounds(pos, bounds) {
			return true
		}
	}
	return false
}

func positionInBounds(pos Position, bounds BlueprintBounds) bool {
	return pos.X >= bounds.MinX && pos.X <= bounds.MaxX && pos.Y >= bounds.MinY && pos.Y <= bounds.MaxY
}

package model

import (
	"fmt"
	"time"
)

// BlueprintIssueCode describes why a blueprint capture or placement failed.
type BlueprintIssueCode string

const (
	BlueprintIssueInvalidSelection  BlueprintIssueCode = "INVALID_SELECTION"
	BlueprintIssueUnknownBuilding   BlueprintIssueCode = "UNKNOWN_BUILDING"
	BlueprintIssueInvalidFootprint  BlueprintIssueCode = "INVALID_FOOTPRINT"
	BlueprintIssuePartialFootprint  BlueprintIssueCode = "PARTIAL_FOOTPRINT"
	BlueprintIssueOffsetOutOfBounds BlueprintIssueCode = "OFFSET_OUT_OF_BOUNDS"
	BlueprintIssuePlacementOOB      BlueprintIssueCode = "PLACEMENT_OUT_OF_BOUNDS"
)

// BlueprintIssue captures a non-fatal issue encountered during blueprint operations.
type BlueprintIssue struct {
	Code       BlueprintIssueCode `json:"code"`
	ItemIndex  int                `json:"item_index,omitempty"`
	BuildingID string             `json:"building_id,omitempty"`
	Offset     *GridOffset        `json:"offset,omitempty"`
	Position   *Position          `json:"position,omitempty"`
	Message    string             `json:"message,omitempty"`
}

// BlueprintCaptureResult reports the blueprint plus any capture issues.
type BlueprintCaptureResult struct {
	Blueprint Blueprint        `json:"blueprint"`
	Issues    []BlueprintIssue `json:"issues,omitempty"`
}

// BlueprintPlacementRequest defines how to place a blueprint in the world.
type BlueprintPlacementRequest struct {
	Blueprint Blueprint    `json:"blueprint"`
	Origin    Position     `json:"origin"`
	Rotation  PlanRotation `json:"rotation,omitempty"`
	MapWidth  int          `json:"map_width,omitempty"`
	MapHeight int          `json:"map_height,omitempty"`
}

// BlueprintPlacementItem is a transformed placement output.
type BlueprintPlacementItem struct {
	ItemIndex    int             `json:"item_index"`
	BuildingType BuildingType    `json:"building_type"`
	Params       BlueprintParams `json:"params"`
	Position     Position        `json:"position"`
	Rotation     PlanRotation    `json:"rotation,omitempty"`
}

// BlueprintPlacementResult aggregates transformed placement outputs.
type BlueprintPlacementResult struct {
	Items  []BlueprintPlacementItem `json:"items"`
	Issues []BlueprintIssue         `json:"issues,omitempty"`
	Bounds BlueprintBounds          `json:"bounds"`
	Size   Footprint                `json:"size"`
}

// CaptureBlueprint builds a blueprint from buildings fully contained within the selection.
func CaptureBlueprint(ws *WorldState, selection BlueprintBounds, createdBy string, createdAt time.Time) (BlueprintCaptureResult, error) {
	result := BlueprintCaptureResult{}
	if ws == nil {
		return result, fmt.Errorf("world state required")
	}
	if err := selection.Validate(); err != nil {
		return result, fmt.Errorf("selection invalid: %w", err)
	}
	if selection.MinX < 0 || selection.MinY < 0 || selection.MaxX >= ws.MapWidth || selection.MaxY >= ws.MapHeight {
		return result, fmt.Errorf("selection out of world bounds")
	}
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}

	buildingIDs := sortedBuildingIDsByPosition(ws)

	items := make([]BlueprintItem, 0)
	for _, id := range buildingIDs {
		building := ws.Buildings[id]
		if building == nil {
			result.Issues = append(result.Issues, BlueprintIssue{
				Code:       BlueprintIssueUnknownBuilding,
				BuildingID: id,
				Message:    "building missing",
			})
			continue
		}
		if _, ok := BuildingDefinitionByID(building.Type); !ok {
			result.Issues = append(result.Issues, BlueprintIssue{
				Code:       BlueprintIssueUnknownBuilding,
				BuildingID: building.ID,
				Position:   &Position{X: building.Position.X, Y: building.Position.Y},
				Message:    "unknown building type",
			})
			continue
		}

		offsets, footprint, fpErr := blueprintFootprintOffsets(building)
		if fpErr != nil {
			result.Issues = append(result.Issues, BlueprintIssue{
				Code:       BlueprintIssueInvalidFootprint,
				BuildingID: building.ID,
				Position:   &Position{X: building.Position.X, Y: building.Position.Y},
				Message:    fpErr.Error(),
			})
		}

		inside := 0
		insideAll := true
		for _, offset := range offsets {
			pos := Position{X: building.Position.X + offset.X, Y: building.Position.Y + offset.Y}
			if pos.X >= selection.MinX && pos.X <= selection.MaxX && pos.Y >= selection.MinY && pos.Y <= selection.MaxY {
				inside++
				continue
			}
			insideAll = false
		}
		if inside == 0 {
			continue
		}
		if !insideAll {
			result.Issues = append(result.Issues, BlueprintIssue{
				Code:       BlueprintIssuePartialFootprint,
				BuildingID: building.ID,
				Position:   &Position{X: building.Position.X, Y: building.Position.Y},
				Message:    fmt.Sprintf("footprint %dx%d crosses selection", footprint.Width, footprint.Height),
			})
			continue
		}

		item := BlueprintItem{
			BuildingType: building.Type,
			Params:       blueprintParamsFromBuilding(building),
			Offset: GridOffset{
				X: building.Position.X - selection.MinX,
				Y: building.Position.Y - selection.MinY,
			},
			Rotation: PlanRotation0,
		}
		items = append(items, item)
	}

	if len(items) == 0 {
		return result, fmt.Errorf("no buildings in selection")
	}

	minX, minY, maxX, maxY := items[0].Offset.X, items[0].Offset.Y, items[0].Offset.X, items[0].Offset.Y
	for _, item := range items[1:] {
		if item.Offset.X < minX {
			minX = item.Offset.X
		}
		if item.Offset.Y < minY {
			minY = item.Offset.Y
		}
		if item.Offset.X > maxX {
			maxX = item.Offset.X
		}
		if item.Offset.Y > maxY {
			maxY = item.Offset.Y
		}
	}
	if minX != 0 || minY != 0 {
		for idx := range items {
			items[idx].Offset.X -= minX
			items[idx].Offset.Y -= minY
		}
		maxX -= minX
		maxY -= minY
		minX = 0
		minY = 0
	}

	bounds := BlueprintBounds{MinX: minX, MinY: minY, MaxX: maxX, MaxY: maxY}
	size := Footprint{Width: bounds.MaxX - bounds.MinX + 1, Height: bounds.MaxY - bounds.MinY + 1}
	blueprint := Blueprint{
		Metadata: BlueprintMetadata{
			Version:   1,
			CreatedAt: createdAt,
			CreatedBy: createdBy,
			Size:      size,
			Bounds:    bounds,
		},
		Items: items,
	}
	if err := blueprint.Validate(); err != nil {
		return result, err
	}

	result.Blueprint = blueprint
	return result, nil
}

// PlaceBlueprint transforms blueprint offsets to world positions with rotation applied.
func PlaceBlueprint(req BlueprintPlacementRequest) (BlueprintPlacementResult, error) {
	result := BlueprintPlacementResult{}
	if err := req.Blueprint.Validate(); err != nil {
		return result, err
	}

	width, height, err := boundsDimensions(req.Blueprint.Metadata.Bounds)
	if err != nil {
		return result, err
	}
	rot := normalizePlanRotation(req.Rotation)
	rotated := Footprint{Width: width, Height: height}
	if rot == PlanRotation90 || rot == PlanRotation270 {
		rotated = Footprint{Width: height, Height: width}
	}
	result.Size = rotated
	result.Bounds = BlueprintBounds{
		MinX: req.Origin.X,
		MinY: req.Origin.Y,
		MaxX: req.Origin.X + rotated.Width - 1,
		MaxY: req.Origin.Y + rotated.Height - 1,
	}

	items := make([]BlueprintPlacementItem, 0, len(req.Blueprint.Items))
	for idx, item := range req.Blueprint.Items {
		offset := item.Offset
		if offset.X < req.Blueprint.Metadata.Bounds.MinX || offset.X > req.Blueprint.Metadata.Bounds.MaxX ||
			offset.Y < req.Blueprint.Metadata.Bounds.MinY || offset.Y > req.Blueprint.Metadata.Bounds.MaxY {
			result.Issues = append(result.Issues, BlueprintIssue{
				Code:      BlueprintIssueOffsetOutOfBounds,
				ItemIndex: idx,
				Offset:    &GridOffset{X: offset.X, Y: offset.Y},
				Message:   "offset outside blueprint bounds",
			})
			continue
		}

		relX := offset.X - req.Blueprint.Metadata.Bounds.MinX
		relY := offset.Y - req.Blueprint.Metadata.Bounds.MinY
		rx, ry := rotateOffset(relX, relY, width, height, rot)
		pos := Position{X: req.Origin.X + rx, Y: req.Origin.Y + ry, Z: req.Origin.Z}
		if req.MapWidth > 0 && req.MapHeight > 0 {
			if pos.X < 0 || pos.Y < 0 || pos.X >= req.MapWidth || pos.Y >= req.MapHeight {
				result.Issues = append(result.Issues, BlueprintIssue{
					Code:      BlueprintIssuePlacementOOB,
					ItemIndex: idx,
					Position:  &Position{X: pos.X, Y: pos.Y, Z: pos.Z},
					Message:   "placement outside map bounds",
				})
				continue
			}
		}

		params := rotateBlueprintParams(cloneBlueprintParams(item.Params), rot)
		items = append(items, BlueprintPlacementItem{
			ItemIndex:    idx,
			BuildingType: item.BuildingType,
			Params:       params,
			Position:     pos,
			Rotation:     combinePlanRotations(item.Rotation, rot),
		})
	}

	result.Items = items
	return result, nil
}

func blueprintFootprintOffsets(building *Building) ([]GridOffset, Footprint, error) {
	fp := Footprint{}
	if building != nil {
		fp = building.Runtime.Params.Footprint
		if fp.Width == 0 && fp.Height == 0 {
			if def, ok := BuildingDefinitionByID(building.Type); ok {
				fp = def.Footprint
			}
		}
	}
	if fp.Width <= 0 || fp.Height <= 0 {
		fp = Footprint{Width: 1, Height: 1}
		return []GridOffset{{X: 0, Y: 0}}, fp, fmt.Errorf("invalid footprint")
	}
	offsets, _, err := footprintOffsets(fp, PlanRotation0)
	if err != nil {
		fp = Footprint{Width: 1, Height: 1}
		return []GridOffset{{X: 0, Y: 0}}, fp, err
	}
	return offsets, fp, nil
}

func boundsDimensions(bounds BlueprintBounds) (int, int, error) {
	if err := bounds.Validate(); err != nil {
		return 0, 0, err
	}
	width := bounds.MaxX - bounds.MinX + 1
	height := bounds.MaxY - bounds.MinY + 1
	if width <= 0 || height <= 0 {
		return 0, 0, fmt.Errorf("invalid bounds size")
	}
	return width, height, nil
}

func combinePlanRotations(a, b PlanRotation) PlanRotation {
	ra := rotationToDegrees(a)
	rb := rotationToDegrees(b)
	return rotationFromDegrees((ra + rb) % 360)
}

func rotationToDegrees(rot PlanRotation) int {
	switch normalizePlanRotation(rot) {
	case PlanRotation90:
		return 90
	case PlanRotation180:
		return 180
	case PlanRotation270:
		return 270
	default:
		return 0
	}
}

func rotationFromDegrees(deg int) PlanRotation {
	switch ((deg % 360) + 360) % 360 {
	case 90:
		return PlanRotation90
	case 180:
		return PlanRotation180
	case 270:
		return PlanRotation270
	default:
		return PlanRotation0
	}
}

func rotateConveyorDirection(dir ConveyorDirection, rot PlanRotation) ConveyorDirection {
	if !dir.Valid() {
		return dir
	}
	switch normalizePlanRotation(rot) {
	case PlanRotation90:
		return dir.Right()
	case PlanRotation180:
		return dir.Opposite()
	case PlanRotation270:
		return dir.Left()
	default:
		return dir
	}
}

func rotateBlueprintParams(params BlueprintParams, rot PlanRotation) BlueprintParams {
	if len(params) == 0 || normalizePlanRotation(rot) == PlanRotation0 {
		return params
	}
	out := params
	if raw, ok := out["conveyor"]; ok {
		if rotated, ok := rotateConveyorParam(raw, rot); ok {
			out["conveyor"] = rotated
		}
	}
	if raw, ok := out["sorter"]; ok {
		if rotated, ok := rotateSorterParam(raw, rot); ok {
			out["sorter"] = rotated
		}
	}
	return out
}

func rotateConveyorParam(raw any, rot PlanRotation) (any, bool) {
	switch val := raw.(type) {
	case map[string]any:
		input, okIn := coerceConveyorDirection(val["input"])
		output, okOut := coerceConveyorDirection(val["output"])
		if !okIn && !okOut {
			return raw, false
		}
		cloned := cloneMapStringAny(val)
		if okIn {
			cloned["input"] = rotateConveyorDirection(input, rot)
		}
		if okOut {
			cloned["output"] = rotateConveyorDirection(output, rot)
		}
		return cloned, true
	case ConveyorBlueprintParams:
		return ConveyorBlueprintParams{
			Input:  rotateConveyorDirection(val.Input, rot),
			Output: rotateConveyorDirection(val.Output, rot),
		}, true
	case *ConveyorBlueprintParams:
		if val == nil {
			return raw, false
		}
		clone := *val
		clone.Input = rotateConveyorDirection(clone.Input, rot)
		clone.Output = rotateConveyorDirection(clone.Output, rot)
		return clone, true
	default:
		return raw, false
	}
}

func rotateSorterParam(raw any, rot PlanRotation) (any, bool) {
	switch val := raw.(type) {
	case map[string]any:
		inDirs, okIn := coerceDirectionSlice(val["input_directions"])
		outDirs, okOut := coerceDirectionSlice(val["output_directions"])
		if !okIn && !okOut {
			return raw, false
		}
		cloned := cloneMapStringAny(val)
		if okIn {
			cloned["input_directions"] = rotateDirectionSlice(inDirs, rot)
		}
		if okOut {
			cloned["output_directions"] = rotateDirectionSlice(outDirs, rot)
		}
		return cloned, true
	case SorterBlueprintParams:
		clone := val
		clone.InputDirections = rotateDirectionSlice(val.InputDirections, rot)
		clone.OutputDirections = rotateDirectionSlice(val.OutputDirections, rot)
		return clone, true
	case *SorterBlueprintParams:
		if val == nil {
			return raw, false
		}
		clone := *val
		clone.InputDirections = rotateDirectionSlice(val.InputDirections, rot)
		clone.OutputDirections = rotateDirectionSlice(val.OutputDirections, rot)
		return clone, true
	default:
		return raw, false
	}
}

func rotateDirectionSlice(dirs []ConveyorDirection, rot PlanRotation) []ConveyorDirection {
	if len(dirs) == 0 {
		return nil
	}
	rotated := make([]ConveyorDirection, 0, len(dirs))
	for _, dir := range dirs {
		rotated = append(rotated, rotateConveyorDirection(dir, rot))
	}
	return normalizeSorterDirections(rotated)
}

func coerceConveyorDirection(v any) (ConveyorDirection, bool) {
	switch dir := v.(type) {
	case ConveyorDirection:
		if dir.Valid() {
			return dir, true
		}
		return "", false
	case string:
		typed := ConveyorDirection(dir)
		if typed.Valid() {
			return typed, true
		}
		return "", false
	default:
		return "", false
	}
}

func coerceDirectionSlice(v any) ([]ConveyorDirection, bool) {
	switch dirs := v.(type) {
	case []ConveyorDirection:
		if len(dirs) == 0 {
			return nil, true
		}
		return append([]ConveyorDirection(nil), dirs...), true
	case []string:
		out := make([]ConveyorDirection, 0, len(dirs))
		for _, item := range dirs {
			dir := ConveyorDirection(item)
			if dir.Valid() {
				out = append(out, dir)
			}
		}
		return out, true
	case []any:
		out := make([]ConveyorDirection, 0, len(dirs))
		for _, item := range dirs {
			dir, ok := coerceConveyorDirection(item)
			if ok {
				out = append(out, dir)
			}
		}
		return out, true
	default:
		return nil, false
	}
}

func cloneBlueprintParams(params BlueprintParams) BlueprintParams {
	if params == nil {
		return BlueprintParams{}
	}
	out := make(BlueprintParams, len(params))
	for key, value := range params {
		out[key] = cloneParamValue(value)
	}
	return out
}

func cloneParamValue(value any) any {
	switch v := value.(type) {
	case map[string]any:
		return cloneMapStringAny(v)
	case []any:
		clone := make([]any, len(v))
		for i, item := range v {
			clone[i] = cloneParamValue(item)
		}
		return clone
	case []ConveyorDirection:
		return append([]ConveyorDirection(nil), v...)
	case []string:
		return append([]string(nil), v...)
	case []int:
		return append([]int(nil), v...)
	default:
		return v
	}
}

func cloneMapStringAny(src map[string]any) map[string]any {
	if src == nil {
		return nil
	}
	out := make(map[string]any, len(src))
	for key, value := range src {
		out[key] = cloneParamValue(value)
	}
	return out
}

// Blueprint param helper structs for typed callers.
type ConveyorBlueprintParams struct {
	Input  ConveyorDirection `json:"input"`
	Output ConveyorDirection `json:"output"`
}

type SorterBlueprintParams struct {
	InputDirections  []ConveyorDirection `json:"input_directions,omitempty"`
	OutputDirections []ConveyorDirection `json:"output_directions,omitempty"`
	Filter           SorterFilter        `json:"filter,omitempty"`
}

type StorageBlueprintParams struct {
	Priority StoragePriority `json:"priority"`
}

type LogisticsStationBlueprintParams struct {
	Priority             LogisticsStationPriority               `json:"priority"`
	DroneCapacity        int                                    `json:"drone_capacity"`
	Interstellar         LogisticsStationInterstellarConfig     `json:"interstellar"`
	Settings             map[string]LogisticsStationItemSetting `json:"settings,omitempty"`
	InterstellarSettings map[string]LogisticsStationItemSetting `json:"interstellar_settings,omitempty"`
}

func blueprintParamsFromBuilding(building *Building) BlueprintParams {
	params := BlueprintParams{}
	if building == nil {
		return params
	}
	if IsConveyorBuilding(building.Type) {
		state := building.Conveyor
		if state == nil {
			state = defaultConveyorState(building.Runtime)
		}
		params["conveyor"] = map[string]any{
			"input":  state.Input,
			"output": state.Output,
		}
	}
	if IsSorterBuilding(building.Type) {
		state := building.Sorter
		if state == nil {
			state = defaultSorterState(building.Runtime)
		}
		params["sorter"] = map[string]any{
			"input_directions":  append([]ConveyorDirection(nil), state.InputDirections...),
			"output_directions": append([]ConveyorDirection(nil), state.OutputDirections...),
			"filter": SorterFilter{
				Mode:  state.Filter.Mode,
				Items: append([]string(nil), state.Filter.Items...),
				Tags:  append([]string(nil), state.Filter.Tags...),
			},
		}
	}
	if building.Storage != nil {
		params["storage"] = map[string]any{
			"priority": StoragePriority{
				Input:  building.Storage.Priority.Input,
				Output: building.Storage.Priority.Output,
			},
		}
	}
	if building.LogisticsStation != nil {
		params["logistics_station"] = LogisticsStationBlueprintParams{
			Priority:             building.LogisticsStation.Priority,
			DroneCapacity:        building.LogisticsStation.DroneCapacity,
			Interstellar:         building.LogisticsStation.Interstellar,
			Settings:             cloneStationSettings(building.LogisticsStation.Settings),
			InterstellarSettings: cloneStationSettings(building.LogisticsStation.InterstellarSettings),
		}
	}
	return params
}

func cloneStationSettings(src map[string]LogisticsStationItemSetting) map[string]LogisticsStationItemSetting {
	if len(src) == 0 {
		return nil
	}
	out := make(map[string]LogisticsStationItemSetting, len(src))
	for key, setting := range src {
		out[key] = setting
	}
	return out
}

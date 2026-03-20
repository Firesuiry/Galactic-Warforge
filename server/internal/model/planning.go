package model

import "fmt"

// PlanItemKind identifies what kind of entity is being planned.
type PlanItemKind string

const (
	PlanKindBuilding PlanItemKind = "building"
	PlanKindPipeline PlanItemKind = "pipeline"
	PlanKindCustom   PlanItemKind = "custom"
)

// PlanRotation describes footprint rotation in degrees.
type PlanRotation string

const (
	PlanRotation0   PlanRotation = "0"
	PlanRotation90  PlanRotation = "90"
	PlanRotation180 PlanRotation = "180"
	PlanRotation270 PlanRotation = "270"
)

func normalizePlanRotation(rot PlanRotation) PlanRotation {
	switch rot {
	case PlanRotation90, PlanRotation180, PlanRotation270:
		return rot
	default:
		return PlanRotation0
	}
}

// PlanResultCode is the reason code for a planning result.
type PlanResultCode string

const (
	PlanOK               PlanResultCode = "OK"
	PlanInvalidWorld     PlanResultCode = "INVALID_WORLD"
	PlanInvalidItem      PlanResultCode = "INVALID_ITEM"
	PlanUnknownBuilding  PlanResultCode = "UNKNOWN_BUILDING"
	PlanNotBuildable     PlanResultCode = "NOT_BUILDABLE"
	PlanInvalidFootprint PlanResultCode = "INVALID_FOOTPRINT"
	PlanOutOfBounds      PlanResultCode = "OUT_OF_BOUNDS"
	PlanTerrainBlocked   PlanResultCode = "TERRAIN_BLOCKED"
	PlanNoBuildZone      PlanResultCode = "NO_BUILD_ZONE"
	PlanOccupiedBuilding PlanResultCode = "OCCUPIED_BUILDING"
	PlanOccupiedConveyor PlanResultCode = "OCCUPIED_CONVEYOR"
	PlanOccupiedPipeline PlanResultCode = "OCCUPIED_PIPELINE"
	PlanReservedTile     PlanResultCode = "RESERVED_TILE"
	PlanBatchConflict    PlanResultCode = "BATCH_CONFLICT"
)

// PlanItem describes one planned placement.
type PlanItem struct {
	ID           string       `json:"id,omitempty"`
	Kind         PlanItemKind `json:"kind"`
	BuildingType BuildingType `json:"building_type,omitempty"`
	Position     Position     `json:"position"`
	Rotation     PlanRotation `json:"rotation,omitempty"`
	Footprint    Footprint    `json:"footprint,omitempty"`
	Tiles        []Position   `json:"tiles,omitempty"`
}

// PlanItemResult reports the planning outcome for a single item.
type PlanItemResult struct {
	ItemID   string         `json:"item_id,omitempty"`
	Allowed  bool           `json:"allowed"`
	Code     PlanResultCode `json:"code"`
	Message  string         `json:"message,omitempty"`
	Occupied []Position     `json:"occupied,omitempty"`
	Cached   bool           `json:"cached,omitempty"`
}

// PlanBatchMode controls how conflicts inside a batch are handled.
type PlanBatchMode string

const (
	PlanBatchFirstWins  PlanBatchMode = "first_wins"
	PlanBatchMutualFail PlanBatchMode = "mutual_fail"
)

// PlanBatchPolicy defines intra-batch conflict handling.
type PlanBatchPolicy struct {
	Mode PlanBatchMode `json:"mode,omitempty"`
}

// PlanBatchRequest bundles items for a planning evaluation.
type PlanBatchRequest struct {
	BatchID      string              `json:"batch_id,omitempty"`
	Items        []PlanItem          `json:"items"`
	Policy       PlanBatchPolicy     `json:"policy,omitempty"`
	State        *PlanState          `json:"-"`
	BlockedTiles map[string]struct{} `json:"-"`
	UseCache     bool                `json:"-"`
}

// PlanBatchResult aggregates results for a batch of planned items.
type PlanBatchResult struct {
	BatchID  string           `json:"batch_id,omitempty"`
	Results  []PlanItemResult `json:"results"`
	Allowed  []PlanItemResult `json:"allowed"`
	Rejected []PlanItemResult `json:"rejected"`
}

// PlanReservation records a pre-reserved tile.
type PlanReservation struct {
	ItemID  string
	BatchID string
}

// PlanState caches planning results and reserved tiles.
type PlanState struct {
	ReservedTiles map[string]PlanReservation
	ResultCache   map[string]PlanItemResult
}

// NewPlanState creates an empty planning state.
func NewPlanState() *PlanState {
	return &PlanState{
		ReservedTiles: make(map[string]PlanReservation),
		ResultCache:   make(map[string]PlanItemResult),
	}
}

// CacheResult stores a planning result for reuse.
func (ps *PlanState) CacheResult(res PlanItemResult) {
	if ps == nil || res.ItemID == "" {
		return
	}
	ps.ResultCache[res.ItemID] = res
}

// Result returns a cached planning result if present.
func (ps *PlanState) Result(itemID string) (PlanItemResult, bool) {
	if ps == nil || itemID == "" {
		return PlanItemResult{}, false
	}
	res, ok := ps.ResultCache[itemID]
	return res, ok
}

// ReserveTiles pre-occupies tiles for an item.
func (ps *PlanState) ReserveTiles(itemID, batchID string, tiles []Position) {
	if ps == nil || itemID == "" || len(tiles) == 0 {
		return
	}
	for _, pos := range tiles {
		key := TileKey(pos.X, pos.Y)
		ps.ReservedTiles[key] = PlanReservation{ItemID: itemID, BatchID: batchID}
	}
}

// ReleaseBatch clears reserved tiles for a batch.
func (ps *PlanState) ReleaseBatch(batchID string) {
	if ps == nil || batchID == "" {
		return
	}
	for key, res := range ps.ReservedTiles {
		if res.BatchID == batchID {
			delete(ps.ReservedTiles, key)
		}
	}
}

// EvaluatePlanBatch evaluates a batch of planned items against the world state.
func EvaluatePlanBatch(ws *WorldState, req PlanBatchRequest) PlanBatchResult {
	result := PlanBatchResult{BatchID: req.BatchID}
	if ws == nil {
		for _, item := range req.Items {
			res := PlanItemResult{ItemID: item.ID, Allowed: false, Code: PlanInvalidWorld, Message: "world state is nil"}
			result.Results = append(result.Results, res)
			result.Rejected = append(result.Rejected, res)
		}
		return result
	}

	state := req.State
	if state == nil {
		state = NewPlanState()
	}
	useCache := req.UseCache
	mode := req.Policy.Mode
	if mode == "" {
		mode = PlanBatchFirstWins
	}

	buildingTiles := occupiedBuildingTiles(ws)
	pipelineTiles := occupiedPipelineTiles(ws.Pipelines)

	switch mode {
	case PlanBatchMutualFail:
		result = evaluateBatchMutual(ws, req, state, useCache, buildingTiles, pipelineTiles)
	default:
		result = evaluateBatchFirstWins(ws, req, state, useCache, buildingTiles, pipelineTiles)
	}

	return result
}

func evaluateBatchFirstWins(ws *WorldState, req PlanBatchRequest, state *PlanState, useCache bool, buildingTiles map[string]buildingOccupancy, pipelineTiles map[string]struct{}) PlanBatchResult {
	result := PlanBatchResult{BatchID: req.BatchID}
	batchReserved := make(map[string]string)
	for _, item := range req.Items {
		res := PlanItemResult{ItemID: item.ID}
		var tiles []Position
		if useCache {
			if cached, ok := state.Result(item.ID); ok {
				cached.Cached = true
				result.Results = append(result.Results, cached)
				if cached.Allowed {
					for _, pos := range cached.Occupied {
						batchReserved[TileKey(pos.X, pos.Y)] = item.ID
					}
					result.Allowed = append(result.Allowed, cached)
				} else {
					result.Rejected = append(result.Rejected, cached)
				}
				continue
			}
		}

		occupied, err := itemOccupiedTiles(item)
		if err != nil {
			res.Allowed = false
			res.Code = codeForPlanError(err)
			res.Message = err.Error()
			result.Results = append(result.Results, res)
			result.Rejected = append(result.Rejected, res)
			state.CacheResult(res)
			continue
		}
		tiles = occupied
		res.Occupied = tiles

		conflictCode, conflictMsg := detectTileConflicts(ws, item.ID, tiles, req.BlockedTiles, buildingTiles, pipelineTiles, state.ReservedTiles, batchReserved, req.BatchID)
		if conflictCode != PlanOK {
			res.Allowed = false
			res.Code = conflictCode
			res.Message = conflictMsg
			result.Results = append(result.Results, res)
			result.Rejected = append(result.Rejected, res)
			state.CacheResult(res)
			continue
		}

		res.Allowed = true
		res.Code = PlanOK
		result.Results = append(result.Results, res)
		result.Allowed = append(result.Allowed, res)
		state.CacheResult(res)
		if item.ID != "" {
			state.ReserveTiles(item.ID, req.BatchID, tiles)
		}
		for _, pos := range tiles {
			batchReserved[TileKey(pos.X, pos.Y)] = item.ID
		}
	}
	return result
}

func evaluateBatchMutual(ws *WorldState, req PlanBatchRequest, state *PlanState, useCache bool, buildingTiles map[string]buildingOccupancy, pipelineTiles map[string]struct{}) PlanBatchResult {
	result := PlanBatchResult{BatchID: req.BatchID}
	tileOwners := make(map[string][]int)
	entries := make([]PlanItemResult, len(req.Items))
	allTiles := make([][]Position, len(req.Items))

	for i, item := range req.Items {
		res := PlanItemResult{ItemID: item.ID}
		if useCache {
			if cached, ok := state.Result(item.ID); ok {
				cached.Cached = true
				entries[i] = cached
				allTiles[i] = cached.Occupied
				if cached.Allowed {
					for _, pos := range cached.Occupied {
						key := TileKey(pos.X, pos.Y)
						tileOwners[key] = append(tileOwners[key], i)
					}
				}
				continue
			}
		}

		occupied, err := itemOccupiedTiles(item)
		if err != nil {
			res.Allowed = false
			res.Code = codeForPlanError(err)
			res.Message = err.Error()
			entries[i] = res
			state.CacheResult(res)
			continue
		}
		allTiles[i] = occupied
		res.Occupied = occupied
		conflictCode, conflictMsg := detectTileConflicts(ws, item.ID, occupied, req.BlockedTiles, buildingTiles, pipelineTiles, state.ReservedTiles, nil, req.BatchID)
		if conflictCode != PlanOK {
			res.Allowed = false
			res.Code = conflictCode
			res.Message = conflictMsg
			entries[i] = res
			state.CacheResult(res)
			continue
		}
		res.Allowed = true
		res.Code = PlanOK
		entries[i] = res
		for _, pos := range occupied {
			key := TileKey(pos.X, pos.Y)
			tileOwners[key] = append(tileOwners[key], i)
		}
	}

	conflicted := make(map[int]struct{})
	for _, owners := range tileOwners {
		if len(owners) > 1 {
			for _, idx := range owners {
				conflicted[idx] = struct{}{}
			}
		}
	}

	for i, res := range entries {
		if _, ok := conflicted[i]; ok {
			res.Allowed = false
			res.Code = PlanBatchConflict
			res.Message = "batch items overlap"
			entries[i] = res
		}
	}

	for i, res := range entries {
		result.Results = append(result.Results, res)
		if res.Allowed {
			result.Allowed = append(result.Allowed, res)
			state.CacheResult(res)
			if res.ItemID != "" {
				state.ReserveTiles(res.ItemID, req.BatchID, allTiles[i])
			}
		} else {
			result.Rejected = append(result.Rejected, res)
			state.CacheResult(res)
		}
	}

	return result
}

func detectTileConflicts(ws *WorldState, itemID string, tiles []Position, blockedTiles map[string]struct{}, buildingTiles map[string]buildingOccupancy, pipelineTiles map[string]struct{}, reservedTiles map[string]PlanReservation, batchReserved map[string]string, currentBatchID string) (PlanResultCode, string) {
	for _, pos := range tiles {
		if !ws.InBounds(pos.X, pos.Y) {
			return PlanOutOfBounds, fmt.Sprintf("tile (%d,%d) out of bounds", pos.X, pos.Y)
		}
		if !ws.Grid[pos.Y][pos.X].Terrain.Buildable() {
			return PlanTerrainBlocked, fmt.Sprintf("tile (%d,%d) not buildable", pos.X, pos.Y)
		}
		if blockedTiles != nil {
			if _, blocked := blockedTiles[TileKey(pos.X, pos.Y)]; blocked {
				return PlanNoBuildZone, fmt.Sprintf("tile (%d,%d) in no-build zone", pos.X, pos.Y)
			}
		}
		if occ, ok := buildingTiles[TileKey(pos.X, pos.Y)]; ok {
			if IsConveyorBuilding(occ.BuildingType) {
				return PlanOccupiedConveyor, fmt.Sprintf("tile (%d,%d) occupied by conveyor", pos.X, pos.Y)
			}
			return PlanOccupiedBuilding, fmt.Sprintf("tile (%d,%d) occupied by building", pos.X, pos.Y)
		}
		if _, ok := pipelineTiles[TileKey(pos.X, pos.Y)]; ok {
			return PlanOccupiedPipeline, fmt.Sprintf("tile (%d,%d) occupied by pipeline", pos.X, pos.Y)
		}
		if reservedTiles != nil {
			if res, ok := reservedTiles[TileKey(pos.X, pos.Y)]; ok && res.ItemID != "" && res.ItemID != itemID {
				if res.BatchID == currentBatchID && currentBatchID != "" {
					return PlanBatchConflict, fmt.Sprintf("tile (%d,%d) overlaps batch item", pos.X, pos.Y)
				}
				return PlanReservedTile, fmt.Sprintf("tile (%d,%d) reserved by plan", pos.X, pos.Y)
			}
		}
		if batchReserved != nil {
			if owner, ok := batchReserved[TileKey(pos.X, pos.Y)]; ok && owner != itemID {
				return PlanBatchConflict, fmt.Sprintf("tile (%d,%d) overlaps batch item", pos.X, pos.Y)
			}
		}
	}
	return PlanOK, ""
}

func itemOccupiedTiles(item PlanItem) ([]Position, error) {
	if len(item.Tiles) > 0 {
		return dedupePositions(item.Tiles), nil
	}

	switch item.Kind {
	case PlanKindBuilding:
		if item.BuildingType == "" {
			return nil, fmt.Errorf("building type required")
		}
		def, ok := BuildingDefinitionByID(item.BuildingType)
		if !ok {
			return nil, fmt.Errorf("unknown building type: %s", item.BuildingType)
		}
		if !def.Buildable {
			return nil, fmt.Errorf("building type not buildable: %s", item.BuildingType)
		}
		footprint := item.Footprint
		if footprint.Width == 0 && footprint.Height == 0 {
			footprint = def.Footprint
		}
		offsets, rotated, err := footprintOffsets(footprint, item.Rotation)
		if err != nil {
			return nil, err
		}
		_ = rotated
		positions := make([]Position, len(offsets))
		for i, offset := range offsets {
			positions[i] = Position{X: item.Position.X + offset.X, Y: item.Position.Y + offset.Y, Z: item.Position.Z}
		}
		return positions, nil
	case PlanKindPipeline, PlanKindCustom:
		return nil, fmt.Errorf("tiles required for plan kind %s", item.Kind)
	default:
		return nil, fmt.Errorf("invalid plan kind: %s", item.Kind)
	}
}

func codeForPlanError(err error) PlanResultCode {
	if err == nil {
		return PlanOK
	}
	errMsg := err.Error()
	switch {
	case hasPrefix(errMsg, "unknown building type"):
		return PlanUnknownBuilding
	case hasPrefix(errMsg, "building type not buildable"):
		return PlanNotBuildable
	case hasPrefix(errMsg, "invalid footprint"):
		return PlanInvalidFootprint
	case hasPrefix(errMsg, "tiles required"):
		return PlanInvalidItem
	case hasPrefix(errMsg, "building type required"):
		return PlanInvalidItem
	default:
		return PlanInvalidItem
	}
}

func footprintOffsets(fp Footprint, rot PlanRotation) ([]GridOffset, Footprint, error) {
	if fp.Width <= 0 || fp.Height <= 0 {
		return nil, Footprint{}, fmt.Errorf("invalid footprint %dx%d", fp.Width, fp.Height)
	}
	rot = normalizePlanRotation(rot)
	width := fp.Width
	height := fp.Height
	rotated := fp
	if rot == PlanRotation90 || rot == PlanRotation270 {
		rotated = Footprint{Width: height, Height: width}
	}
	offsets := make([]GridOffset, 0, width*height)
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			rx, ry := rotateOffset(x, y, width, height, rot)
			offsets = append(offsets, GridOffset{X: rx, Y: ry})
		}
	}
	return offsets, rotated, nil
}

func rotateOffset(x, y, width, height int, rot PlanRotation) (int, int) {
	switch rot {
	case PlanRotation90:
		return height - 1 - y, x
	case PlanRotation180:
		return width - 1 - x, height - 1 - y
	case PlanRotation270:
		return y, width - 1 - x
	default:
		return x, y
	}
}

type buildingOccupancy struct {
	BuildingID   string
	BuildingType BuildingType
}

func occupiedBuildingTiles(ws *WorldState) map[string]buildingOccupancy {
	occupied := make(map[string]buildingOccupancy)
	if ws == nil {
		return occupied
	}
	for _, building := range ws.Buildings {
		if building == nil {
			continue
		}
		fp := building.Runtime.Params.Footprint
		if fp.Width == 0 && fp.Height == 0 {
			def, ok := BuildingDefinitionByID(building.Type)
			if ok {
				fp = def.Footprint
			}
		}
		if fp.Width <= 0 || fp.Height <= 0 {
			fp = Footprint{Width: 1, Height: 1}
		}
		offsets, _, err := footprintOffsets(fp, PlanRotation0)
		if err != nil {
			offsets = []GridOffset{{X: 0, Y: 0}}
		}
		for _, offset := range offsets {
			pos := Position{X: building.Position.X + offset.X, Y: building.Position.Y + offset.Y}
			key := TileKey(pos.X, pos.Y)
			occupied[key] = buildingOccupancy{BuildingID: building.ID, BuildingType: building.Type}
		}
	}
	return occupied
}

func occupiedPipelineTiles(state *PipelineNetworkState) map[string]struct{} {
	occupied := make(map[string]struct{})
	if state == nil {
		return occupied
	}
	for _, node := range state.Nodes {
		if node == nil {
			continue
		}
		occupied[TileKey(node.Position.X, node.Position.Y)] = struct{}{}
	}
	for _, seg := range state.Segments {
		if seg == nil {
			continue
		}
		from := state.Nodes[seg.From]
		to := state.Nodes[seg.To]
		if from == nil || to == nil {
			continue
		}
		addPipelineLine(occupied, from.Position, to.Position)
	}
	return occupied
}

func addPipelineLine(occupied map[string]struct{}, from, to Position) {
	if occupied == nil {
		return
	}
	if from.X == to.X {
		step := 1
		if to.Y < from.Y {
			step = -1
		}
		for y := from.Y; ; y += step {
			occupied[TileKey(from.X, y)] = struct{}{}
			if y == to.Y {
				break
			}
		}
		return
	}
	if from.Y == to.Y {
		step := 1
		if to.X < from.X {
			step = -1
		}
		for x := from.X; ; x += step {
			occupied[TileKey(x, from.Y)] = struct{}{}
			if x == to.X {
				break
			}
		}
		return
	}
	occupied[TileKey(from.X, from.Y)] = struct{}{}
	occupied[TileKey(to.X, to.Y)] = struct{}{}
}

func dedupePositions(tiles []Position) []Position {
	if len(tiles) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(tiles))
	out := make([]Position, 0, len(tiles))
	for _, pos := range tiles {
		key := TileKey(pos.X, pos.Y)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, pos)
	}
	return out
}

func hasPrefix(value, prefix string) bool {
	if len(value) < len(prefix) {
		return false
	}
	return value[:len(prefix)] == prefix
}

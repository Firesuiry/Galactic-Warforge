package model

import (
	"fmt"
	"sort"
)

// FootprintTiles maps a local rectangular footprint to the surface. A shape
// larger than a face, or folding onto itself at a cube corner, is invalid.
func (ws *WorldState) FootprintTiles(origin Position, fp Footprint) ([]Position, error) {
	n := ws.Surface().Size
	if !ws.InBounds(origin.X, origin.Y) {
		return nil, fmt.Errorf("占地原点超出地图范围")
	}
	if fp.Width <= 0 || fp.Height <= 0 || fp.Width > n || fp.Height > n {
		return nil, fmt.Errorf("占地无效：尺寸不能超过面大小 %d", n)
	}
	out := make([]Position, 0, fp.Width*fp.Height)
	seen := map[Position]bool{}
	for y := 0; y < fp.Height; y++ {
		for x := 0; x < fp.Width; x++ {
			p := ws.SurfaceOffset(origin, x, y)
			if seen[p] {
				return nil, fmt.Errorf("占地无效：在立方体角处自身重叠")
			}
			seen[p] = true
			out = append(out, p)
		}
	}
	return out, nil
}
// FindFootprintOrigin 从 start 出发（含自身）按图距由近及远寻找一个「整个占地
// 都能合法落位」的原点：footprintTiles 不报错、每格都在界内、地形可建（foundation
// 例外，它自己铺地形）、且没有被其它建筑占用（exceptID 可用于重新索引自己）。
// 5×5 的 HQ 这类大占地贴近立方体角时会折角自重叠，必须换原点；新基地选址、
// 场景预设落位、脚本化开局都走这里，避免"建筑锚点落在占地边上"。
func (ws *WorldState) FindFootprintOrigin(start Position, fp Footprint, btype BuildingType, exceptID string) (Position, bool) {
	if ws == nil || fp.Width <= 0 || fp.Height <= 0 {
		return start, false
	}
	queue := []Position{start}
	seen := map[Position]bool{start: true}
	for head := 0; head < len(queue); head++ {
		p := queue[head]
		if ws.InBounds(p.X, p.Y) && ws.FootprintFits(p, fp, btype, exceptID) {
			return p, true
		}
		for _, n := range ws.SurfaceNeighbors(p) {
			if !seen[n] {
				seen[n] = true
				queue = append(queue, n)
			}
		}
	}
	return start, false
}

// FootprintFits reports whether btype's whole footprint at origin can be
// placed: valid shape, every tile in bounds, buildable terrain (foundation
// writes its own terrain) and free of other buildings. exceptID skips one
// building (used when re-indexing a building that is already registered).
func (ws *WorldState) FootprintFits(origin Position, fp Footprint, btype BuildingType, exceptID string) bool {
	if ws == nil {
		return false
	}
	tiles, err := ws.FootprintTiles(origin, fp)
	if err != nil {
		return false
	}
	for _, tile := range tiles {
		if !ws.InBounds(tile.X, tile.Y) {
			return false
		}
		if !ws.Grid[tile.Y][tile.X].Terrain.Buildable() && btype != BuildingTypeFoundation {
			return false
		}
		if id := ws.TileBuilding[TileKey(tile.X, tile.Y)]; id != "" && id != exceptID {
			return false
		}
	}
	return true
}

func (ws *WorldState) BuildingTiles(b *Building) ([]Position, error) {
	fp := b.Runtime.Params.Footprint
	if fp.Width == 0 && fp.Height == 0 {
		def, ok := BuildingDefinitionByID(b.Type)
		if !ok {
			return nil, fmt.Errorf("未知建筑类型 %s", b.Type)
		}
		fp = def.Footprint
	}
	return ws.FootprintTiles(b.Position, fp)
}

// FoundationAt returns the terrain layer independently from occupying factories.
func (ws *WorldState) FoundationAt(pos Position) *Building {
	for _, b := range ws.Buildings {
		if b == nil || b.Type != BuildingTypeFoundation {
			continue
		}
		tiles, err := ws.BuildingTiles(b)
		if err != nil {
			continue
		}
		for _, p := range tiles {
			if p.X == pos.X && p.Y == pos.Y {
				return b
			}
		}
	}
	return nil
}

// IndexBuilding atomically validates and indexes every occupied surface tile.
func (ws *WorldState) IndexBuilding(b *Building) error {
	tiles, err := ws.BuildingTiles(b)
	if err != nil {
		return err
	}
	if b.Type == BuildingTypeLogisticsDistributor {
		if b.Distributor == nil || b.Position.Z != 1 {
			return fmt.Errorf("distributor requires warehouse-top attachment state")
		}
		if err := b.Distributor.Validate(); err != nil {
			return err
		}
		for _, other := range ws.Buildings {
			if other != nil && other.ID != b.ID && other.Type == BuildingTypeLogisticsDistributor && other.Position.X == b.Position.X && other.Position.Y == b.Position.Y {
				return fmt.Errorf("duplicate distributor mount")
			}
		}
		// A destroyed host remains a valid saved attachment; it cannot operate or occupy the ground.
		if host := ws.Buildings[b.Distributor.HostBuildingID]; host != nil && DistributorHost(ws, b) == nil && !(host.Job != nil && host.Job.Type == BuildingJobDemolish) {
			return fmt.Errorf("invalid distributor host")
		}
		return nil
	}
	// Stacked layers (Z>0) share the ground building's tile registration;
	// only the base layer (Z=0) occupies TileBuilding. Reject duplicate
	// layers at the same height.
	if b.Position.Z > 0 {
		for _, other := range ws.Buildings {
			if other != nil && other.ID != b.ID &&
				other.Position.X == b.Position.X && other.Position.Y == b.Position.Y && other.Position.Z == b.Position.Z {
				return fmt.Errorf("stack layer already occupied by %s", other.ID)
			}
		}
		return nil
	}
	// Foundation is a terrain modifier rather than an occupying factory.
	// Keeping it out of TileBuilding lets factories be placed on the filled
	// ground while the foundation entity remains available for demolition and
	// terrain provenance.
	if b.Type == BuildingTypeFoundation {
		for _, existing := range ws.Buildings {
			if existing == nil || existing.ID == b.ID || existing.Type != BuildingTypeFoundation {
				continue
			}
			otherTiles, err := ws.BuildingTiles(existing)
			if err != nil {
				return err
			}
			for _, p := range tiles {
				for _, other := range otherTiles {
					if p.X == other.X && p.Y == other.Y {
						return fmt.Errorf("foundation footprint overlaps %s", existing.ID)
					}
				}
			}
		}
		return nil
	}
	for _, p := range tiles {
		if id := ws.TileBuilding[TileKey(p.X, p.Y)]; id != "" && id != b.ID {
			return fmt.Errorf("building footprint overlaps %s", id)
		}
	}
	for _, p := range tiles {
		ws.TileBuilding[TileKey(p.X, p.Y)] = b.ID
		ws.Grid[p.Y][p.X].BuildingID = b.ID
	}
	return nil
}

// UnindexBuilding removes the entire footprint, including tiles on other faces.
func (ws *WorldState) UnindexBuilding(b *Building) {
	if b.Type == BuildingTypeFoundation || b.Type == BuildingTypeLogisticsDistributor || b.Position.Z > 0 {
		return
	}
	tiles, err := ws.BuildingTiles(b)
	if err != nil {
		panic(err)
	}
	for _, p := range tiles {
		key := TileKey(p.X, p.Y)
		if ws.TileBuilding[key] == b.ID {
			delete(ws.TileBuilding, key)
			ws.Grid[p.Y][p.X].BuildingID = ""
		}
	}
}
func (ws *WorldState) ConstructionTiles(task *ConstructionTask) ([]Position, error) {
	def, ok := BuildingDefinitionByID(task.BuildingType)
	if !ok {
		return nil, fmt.Errorf("未知建筑类型 %s", task.BuildingType)
	}
	return ws.FootprintTiles(task.Position, RotatedFootprint(def.Footprint, task.Rotation))
}

// FootprintOf resolves the footprint a building type occupies after rotation.
func FootprintOf(btype BuildingType, rotation PlanRotation) (Footprint, bool) {
	def, ok := BuildingDefinitionByID(btype)
	if !ok {
		return Footprint{}, false
	}
	return RotatedFootprint(def.Footprint, rotation), true
}

// BuildingRingCells returns every surface cell adjacent to the building's
// footprint but not inside it (the "outer ring"). IO no longer binds to the
// anchor cell alone: a belt anywhere on the ring is a port candidate.
// Cells are deduplicated (a cube corner can fold two local offsets onto one
// cell) and returned in a stable order for deterministic settlement.
func (ws *WorldState) BuildingRingCells(b *Building) ([]Position, error) {
	if b == nil {
		return nil, fmt.Errorf("建筑不存在")
	}
	fp := b.Runtime.Params.Footprint
	if fp.Width == 0 && fp.Height == 0 {
		def, ok := BuildingDefinitionByID(b.Type)
		if !ok {
			return nil, fmt.Errorf("未知建筑类型 %s", b.Type)
		}
		fp = def.Footprint
	}
	if fp.Width <= 0 || fp.Height <= 0 {
		return nil, fmt.Errorf("占地无效")
	}
	inside := make(map[Position]bool, fp.Width*fp.Height)
	for y := 0; y < fp.Height; y++ {
		for x := 0; x < fp.Width; x++ {
			inside[ws.SurfaceOffset(b.Position, x, y)] = true
		}
	}
	ring := make([]Position, 0, 2*fp.Width+2*fp.Height+4)
	seen := make(map[Position]bool, 2*fp.Width+2*fp.Height+4)
	for y := -1; y <= fp.Height; y++ {
		for x := -1; x <= fp.Width; x++ {
			if x >= 0 && x < fp.Width && y >= 0 && y < fp.Height {
				continue
			}
			p := ws.SurfaceOffset(b.Position, x, y)
			p.Z = b.Position.Z
			if inside[p] || seen[p] {
				continue
			}
			seen[p] = true
			ring = append(ring, p)
		}
	}
	sort.Slice(ring, func(i, j int) bool {
		if ring[i].Y != ring[j].Y {
			return ring[i].Y < ring[j].Y
		}
		return ring[i].X < ring[j].X
	})
	return ring, nil
}

// BuildingOccupies reports whether pos is one of the building's footprint cells.
func (ws *WorldState) BuildingOccupies(b *Building, pos Position) bool {
	if ws == nil || b == nil {
		return false
	}
	tiles, err := ws.BuildingTiles(b)
	if err != nil {
		return false
	}
	for _, p := range tiles {
		if p.X == pos.X && p.Y == pos.Y {
			return true
		}
	}
	return false
}

// BuildingFootprintAt returns the building whose footprint covers pos, or nil.
func (ws *WorldState) BuildingFootprintAt(pos Position) *Building {
	if ws == nil {
		return nil
	}
	id := ws.TileBuilding[TileKey(pos.X, pos.Y)]
	if id == "" {
		return nil
	}
	return ws.Buildings[id]
}

// RingFacingDirections lists the local offsets of the footprint ring together
// with the world direction that points from the ring cell into the footprint
// at that offset. The direction is derived by stepping from the ring cell to
// its footprint neighbour, so it is correct across face seams.
func (ws *WorldState) RingFacingDirections(b *Building) map[Position]ConveyorDirection {
	out := make(map[Position]ConveyorDirection)
	ring, err := ws.BuildingRingCells(b)
	if err != nil {
		return out
	}
	tiles, err := ws.BuildingTiles(b)
	if err != nil {
		return out
	}
	inside := make(map[Position]bool, len(tiles))
	for _, p := range tiles {
		inside[p] = true
	}
	for _, cell := range ring {
		for _, dir := range []ConveyorDirection{ConveyorNorth, ConveyorEast, ConveyorSouth, ConveyorWest} {
			next, _ := ws.SurfaceStep(cell, dir)
			if inside[next] {
				out[cell] = dir
				break
			}
		}
	}
	return out
}

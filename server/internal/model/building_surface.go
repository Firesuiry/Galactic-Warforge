package model

import "fmt"

// FootprintTiles maps a local rectangular footprint to the surface. A shape
// larger than a face, or folding onto itself at a cube corner, is invalid.
func (ws *WorldState) FootprintTiles(origin Position, fp Footprint) ([]Position, error) {
	n := ws.Surface().Size
	if !ws.InBounds(origin.X, origin.Y) {
		return nil, fmt.Errorf("footprint origin out of bounds")
	}
	if fp.Width <= 0 || fp.Height <= 0 || fp.Width > n || fp.Height > n {
		return nil, fmt.Errorf("invalid footprint: dimensions must be within face size %d", n)
	}
	out := make([]Position, 0, fp.Width*fp.Height)
	seen := map[Position]bool{}
	for y := 0; y < fp.Height; y++ {
		for x := 0; x < fp.Width; x++ {
			p := ws.SurfaceOffset(origin, x, y)
			if seen[p] {
				return nil, fmt.Errorf("invalid footprint: overlaps itself at cube corner")
			}
			seen[p] = true
			out = append(out, p)
		}
	}
	return out, nil
}
func (ws *WorldState) BuildingTiles(b *Building) ([]Position, error) {
	fp := b.Runtime.Params.Footprint
	if fp.Width == 0 && fp.Height == 0 {
		def, ok := BuildingDefinitionByID(b.Type)
		if !ok {
			return nil, fmt.Errorf("unknown building type %s", b.Type)
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
  if b.Distributor == nil || b.Position.Z != 1 { return fmt.Errorf("distributor requires warehouse-top attachment state") }
  if err := b.Distributor.Validate(); err != nil { return err }
  for _, other := range ws.Buildings { if other != nil && other.ID != b.ID && other.Type == BuildingTypeLogisticsDistributor && other.Position.X == b.Position.X && other.Position.Y == b.Position.Y { return fmt.Errorf("duplicate distributor mount") } }
  // A destroyed host remains a valid saved attachment; it cannot operate or occupy the ground.
  if host := ws.Buildings[b.Distributor.HostBuildingID]; host != nil && DistributorHost(ws,b) == nil && !(host.Job != nil && host.Job.Type == BuildingJobDemolish) { return fmt.Errorf("invalid distributor host") }
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
	if b.Type == BuildingTypeFoundation || b.Type == BuildingTypeLogisticsDistributor {
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
		return nil, fmt.Errorf("unknown building type %s", task.BuildingType)
	}
	return ws.FootprintTiles(task.Position, def.Footprint)
}

// Regenerate shared-client/src/surface-fixtures.json from the authoritative grid:
// go run ./internal/surface/cmd/fixtures > ../shared-client/src/surface-fixtures.json
package main

import (
	"encoding/json"
	"os"
	"siliconworld/internal/surface"
)

type tile struct {
	X int `json:"x"`
	Y int `json:"y"`
}
type step struct {
	Tile      tile              `json:"tile"`
	Direction surface.Direction `json:"direction"`
}
type sample struct {
	Tile   tile       `json:"tile"`
	Normal [3]float64 `json:"normal"`
	Steps  []step     `json:"steps"`
}

func main() {
	g := surface.Grid{Size: 8}
	data := struct {
		FaceSize int      `json:"face_size"`
		Samples  []sample `json:"samples"`
	}{FaceSize: g.Size}
	for face := 0; face < 6; face++ {
		for _, local := range []surface.Tile{{0, 0}, {7, 0}, {0, 7}, {7, 7}, {3, 3}} {
			t := surface.Tile{X: face%3*g.Size + local.X, Y: face/3*g.Size + local.Y}
			s := sample{Tile: tile{t.X, t.Y}, Normal: g.Normal(t)}
			for d := surface.North; d <= surface.West; d++ {
				next, forward := g.Step(t, d)
				s.Steps = append(s.Steps, step{tile{next.X, next.Y}, forward})
			}
			data.Samples = append(data.Samples, s)
		}
	}
	e := json.NewEncoder(os.Stdout)
	e.SetIndent("", "  ")
	if err := e.Encode(data); err != nil {
		panic(err)
	}
}

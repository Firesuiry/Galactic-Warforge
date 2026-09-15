// Package surface defines the authoritative six-face planetary tile graph.
// The 3 by 2 atlas is storage, not adjacency: every face edge is joined to
// another cube face, with its local direction transported across the seam.
package surface

import (
	"container/heap"
	"math"
	"sort"
)

const Topology = "cube_sphere"

type Metadata struct {
	Topology string `json:"topology"`
	FaceSize int    `json:"face_size"`
}

type Tile struct{ X, Y int }
type Direction int

const (
	North Direction = iota
	East
	South
	West
)

type Grid struct{ Size int }

func (g Grid) Width() int         { return 3 * g.Size }
func (g Grid) Height() int        { return 2 * g.Size }
func (g Grid) Metadata() Metadata { return Metadata{Topology: Topology, FaceSize: g.Size} }
func (g Grid) Valid(t Tile) bool {
	return g.Size > 0 && t.X >= 0 && t.Y >= 0 && t.X < g.Width() && t.Y < g.Height()
}
func (g Grid) Face(t Tile) int { return t.Y/g.Size*3 + t.X/g.Size }

// SingleFace reports whether an ordered atlas rectangle stays in one chart.
func (g Grid) SingleFace(min, max Tile) bool {
	return g.Valid(min) && g.Valid(max) && min.X <= max.X && min.Y <= max.Y && g.Face(min) == g.Face(max)
}

type vector struct{ x, y, z int }

func (a vector) dot(b vector) int    { return a.x*b.x + a.y*b.y + a.z*b.z }
func (a vector) mul(s int) vector    { return vector{a.x * s, a.y * s, a.z * s} }
func (a vector) add(b vector) vector { return vector{a.x + b.x, a.y + b.y, a.z + b.z} }

type frame struct{ n, u, v vector }

// Face order and bases are also specified in shared-client's surface module.
var frames = [6]frame{
	{vector{0, 0, 1}, vector{1, 0, 0}, vector{0, -1, 0}},
	{vector{1, 0, 0}, vector{0, 0, -1}, vector{0, -1, 0}},
	{vector{0, 0, -1}, vector{-1, 0, 0}, vector{0, -1, 0}},
	{vector{-1, 0, 0}, vector{0, 0, 1}, vector{0, -1, 0}},
	{vector{0, 1, 0}, vector{1, 0, 0}, vector{0, 0, 1}},
	{vector{0, -1, 0}, vector{1, 0, 0}, vector{0, 0, -1}},
}
var offsets = [4]Tile{{0, -1}, {1, 0}, {0, 1}, {-1, 0}}

// Step returns the neighboring tile and the forward direction in its frame.
// It is a graph operation: no floating-point projection or rounding is used.
func (g Grid) Step(t Tile, d Direction) (Tile, Direction) {
	if !g.Valid(t) || d < North || d > West {
		panic("invalid cube-sphere step")
	}
	f := g.Face(t)
	x, y := t.X%g.Size, t.Y%g.Size
	o := offsets[d]
	nx, ny := x+o.X, y+o.Y
	if nx >= 0 && ny >= 0 && nx < g.Size && ny < g.Size {
		return Tile{t.X + o.X, t.Y + o.Y}, d
	}
	a := frames[f]
	n := a.u.mul(o.X).add(a.v.mul(o.Y))
	nf := 0
	for frames[nf].n != n {
		nf++
	}
	b := frames[nf]
	p := n.mul(g.Size).add(a.n.mul(g.Size - 1))
	if o.X == 0 {
		p = p.add(a.u.mul(2*x + 1 - g.Size))
	} else {
		p = p.add(a.v.mul(2*y + 1 - g.Size))
	}
	nx = (p.dot(b.u) + g.Size - 1) / 2
	ny = (p.dot(b.v) + g.Size - 1) / 2
	forward := a.n.mul(-1)
	nd := North
	for b.u.mul(offsets[nd].X).add(b.v.mul(offsets[nd].Y)) != forward {
		nd++
	}
	return Tile{nf%3*g.Size + nx, nf/3*g.Size + ny}, nd
}

func (g Grid) Neighbors(t Tile) []Tile {
	result := make([]Tile, 4)
	for d := North; d <= West; d++ {
		result[d], _ = g.Step(t, d)
	}
	return result
}

// Offset transports a local offset: columns first, then rows in the rotated
// frame. This order is explicit because a cube corner has angular deficit.
func (g Grid) Offset(t Tile, dx, dy int) Tile {
	xdir, ydir := East, South
	if dx < 0 {
		xdir = West
		dx = -dx
	}
	if dy < 0 {
		ydir = North
		dy = -dy
	}
	for ; dx > 0; dx-- {
		next, forward := g.Step(t, xdir)
		ydir = (ydir + forward - xdir + 4) % 4
		t, xdir = next, forward
	}
	for ; dy > 0; dy-- {
		t, ydir = g.Step(t, ydir)
	}
	return t
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
func (g Grid) cube(t Tile) vector {
	f := frames[g.Face(t)]
	return f.n.mul(g.Size).add(f.u.mul(2*(t.X%g.Size) + 1 - g.Size)).add(f.v.mul(2*(t.Y%g.Size) + 1 - g.Size))
}
func (g Grid) lowerBound(a, b Tile) int {
	p, q := g.cube(a), g.cube(b)
	return (abs(p.x-q.x) + abs(p.y-q.y) + abs(p.z-q.z) + 1) / 2
}

// Distance is the exact shortest four-neighbor distance, not atlas Manhattan
// distance or a visual great-circle approximation.
func (g Grid) Distance(a, b Tile) int { return g.distance(a, b, math.MaxInt/4) }
func (g Grid) Within(a, b Tile, radius int) bool {
	return radius >= 0 && g.Valid(a) && g.Valid(b) && g.distance(a, b, radius) <= radius
}

type candidate struct {
	tile           Tile
	cost, estimate int
}
type candidates []candidate

func (h candidates) Len() int { return len(h) }
func (h candidates) Less(i, j int) bool {
	if h[i].estimate == h[j].estimate {
		return h[i].cost > h[j].cost
	}
	return h[i].estimate < h[j].estimate
}
func (h candidates) Swap(i, j int) { h[i], h[j] = h[j], h[i] }
func (h *candidates) Push(x any)   { *h = append(*h, x.(candidate)) }
func (h *candidates) Pop() any     { a := *h; x := a[len(a)-1]; *h = a[:len(a)-1]; return x }
func (g Grid) distance(a, b Tile, limit int) int {
	if !g.Valid(a) || !g.Valid(b) {
		return math.MaxInt / 4
	}
	if g.Face(a) == g.Face(b) {
		return abs(a.X-b.X) + abs(a.Y-b.Y)
	}
	lower := g.lowerBound(a, b)
	if lower > limit {
		return math.MaxInt / 4
	}
	// On an obstacle-free face a rectilinear shortest path can move its turns
	// onto endpoint or boundary coordinate lines without increasing length.
	// Face transitions only exchange/reflect these coordinates. Keep their
	// reflection closure, and search a weighted grid of at most 10x10 nodes per
	// face instead of visiting O(Size²) cells on a large planet.
	coordinates := []int{0, g.Size - 1}
	for _, v := range []int{a.X % g.Size, a.Y % g.Size, b.X % g.Size, b.Y % g.Size} {
		coordinates = append(coordinates, v, g.Size-1-v)
	}
	sort.Ints(coordinates)
	unique := coordinates[:0]
	for _, v := range coordinates {
		if len(unique) == 0 || unique[len(unique)-1] != v {
			unique = append(unique, v)
		}
	}
	coordinates = unique
	queue := candidates{{a, 0, lower}}
	seen := map[Tile]int{a: 0}
	for len(queue) > 0 {
		current := heap.Pop(&queue).(candidate)
		if current.cost != seen[current.tile] {
			continue
		}
		if current.tile == b {
			return current.cost
		}
		for d := North; d <= West; d++ {
			next, stepCost := current.tile, 1
			coordinate := next.X % g.Size
			if d == North || d == South {
				coordinate = next.Y % g.Size
			}
			i := sort.SearchInts(coordinates, coordinate)
			if d == North || d == West {
				i--
			} else {
				i++
			}
			if i < 0 || i >= len(coordinates) {
				next, _ = g.Step(next, d)
			} else {
				stepCost = abs(coordinates[i] - coordinate)
				next.X += offsets[d].X * stepCost
				next.Y += offsets[d].Y * stepCost
			}
			cost := current.cost + stepCost
			if old, ok := seen[next]; ok && old <= cost {
				continue
			}
			estimate := cost + g.lowerBound(next, b)
			if estimate > limit {
				continue
			}
			seen[next] = cost
			heap.Push(&queue, candidate{next, cost, estimate})
		}
	}
	return math.MaxInt / 4
}

// Disc enumerates the closed graph-radius neighborhood once per tile.
func (g Grid) Disc(center Tile, radius int) []Tile {
	if !g.Valid(center) || radius < 0 {
		return nil
	}
	result := []Tile{center}
	seen := map[Tile]bool{center: true}
	start := 0
	for r := 0; r < radius && start < len(result); r++ {
		end := len(result)
		for _, t := range result[start:end] {
			for d := North; d <= West; d++ {
				next, _ := g.Step(t, d)
				if !seen[next] {
					seen[next] = true
					result = append(result, next)
				}
			}
		}
		start = end
	}
	return result
}

// Normal maps tile centers onto an equiangular cubed sphere. Unlike latitude
// strips, every pole is inside a regular face and no row collapses to a point.
func (g Grid) Normal(t Tile) [3]float64 {
	if !g.Valid(t) {
		panic("invalid cube-sphere tile")
	}
	f := frames[g.Face(t)]
	u := math.Tan(math.Pi / 4 * (2*(float64(t.X%g.Size)+.5)/float64(g.Size) - 1))
	v := math.Tan(math.Pi / 4 * (2*(float64(t.Y%g.Size)+.5)/float64(g.Size) - 1))
	x := float64(f.n.x) + u*float64(f.u.x) + v*float64(f.v.x)
	y := float64(f.n.y) + u*float64(f.u.y) + v*float64(f.v.y)
	z := float64(f.n.z) + u*float64(f.u.z) + v*float64(f.v.z)
	l := math.Sqrt(x*x + y*y + z*z)
	return [3]float64{x / l, y / l, z / l}
}

// FromVector returns the cell under a planet-local direction. Dominant-axis
// ties use Z, then X, then Y consistently with the browser and terrain shader.
func (g Grid) FromVector(x, y, z float64) Tile {
	if g.Size <= 0 || math.IsNaN(x+y+z) || math.IsInf(x+y+z, 0) || x == 0 && y == 0 && z == 0 {
		panic("invalid cube-sphere direction")
	}
	f := 0
	if math.Abs(z) >= math.Abs(x) && math.Abs(z) >= math.Abs(y) {
		if z < 0 {
			f = 2
		}
	} else if math.Abs(x) >= math.Abs(y) {
		f = 1
		if x < 0 {
			f = 3
		}
	} else {
		f = 4
		if y < 0 {
			f = 5
		}
	}
	b := frames[f]
	dot := func(v vector) float64 { return x*float64(v.x) + y*float64(v.y) + z*float64(v.z) }
	scale := dot(b.n)
	index := func(value float64) int {
		i := int(math.Floor((math.Atan(value)/(math.Pi/4) + 1) * .5 * float64(g.Size)))
		if i < 0 {
			return 0
		}
		if i >= g.Size {
			return g.Size - 1
		}
		return i
	}
	return Tile{f%3*g.Size + index(dot(b.u)/scale), f/3*g.Size + index(dot(b.v)/scale)}
}

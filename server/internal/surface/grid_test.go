package surface

import (
	"math"
	"testing"
)

func TestClosedReciprocalCubeGraph(t *testing.T) {
	for _, n := range []int{1, 2, 3, 8, 32} {
		g := Grid{n}
		seams := 0
		for y := 0; y < g.Height(); y++ {
			for x := 0; x < g.Width(); x++ {
				a := Tile{x, y}
				neighbors := map[Tile]bool{}
				for d := North; d <= West; d++ {
					b, forward := g.Step(a, d)
					if !g.Valid(b) || a == b || neighbors[b] {
						t.Fatalf("N=%d invalid neighbor %v -> %v", n, a, b)
					}
					neighbors[b] = true
					back, reverse := g.Step(b, (forward+2)%4)
					if back != a || reverse != (d+2)%4 {
						t.Fatalf("N=%d nonreciprocal %v/%d -> %v/%d -> %v/%d", n, a, d, b, forward, back, reverse)
					}
					if g.Face(a) != g.Face(b) {
						seams++
					}
				}
				v := g.Normal(a)
				if got := g.FromVector(v[0], v[1], v[2]); got != a {
					t.Fatalf("roundtrip %v -> %v", a, got)
				}
			}
		}
		if seams != 24*n {
			t.Fatalf("N=%d expected %d directed seam cells, got %d", n, 24*n, seams)
		}
		if count := len(g.Disc(Tile{0, 0}, 6*n)); count != 6*n*n {
			t.Fatalf("N=%d disconnected graph: %d", n, count)
		}
	}
}

func bfs(g Grid, source Tile) map[Tile]int {
	dist := map[Tile]int{source: 0}
	queue := []Tile{source}
	for i := 0; i < len(queue); i++ {
		for _, next := range g.Neighbors(queue[i]) {
			if _, ok := dist[next]; !ok {
				dist[next] = dist[queue[i]] + 1
				queue = append(queue, next)
			}
		}
	}
	return dist
}

func TestDistancesAgainstExhaustiveGraphSearch(t *testing.T) {
	for _, n := range []int{1, 2, 3, 4} {
		g := Grid{n}
		for y := 0; y < g.Height(); y++ {
			for x := 0; x < g.Width(); x++ {
				a := Tile{x, y}
				for b, want := range bfs(g, a) {
					if got := g.Distance(a, b); got != want {
						t.Fatalf("N=%d %v->%v got %d want %d", n, a, b, got, want)
					}
					if !g.Within(a, b, want) || g.Within(a, b, want-1) {
						t.Fatalf("N=%d wrong range boundary %v->%v", n, a, b)
					}
				}
			}
		}
	}
}

func TestAtlasEdgesAreNotSurfaceAdjacency(t *testing.T) {
	g := Grid{8}
	// Face 2 right edge joins face 3 LEFT, not the left side of atlas row 0.
	a := Tile{23, 3}
	b, d := g.Step(a, East)
	if b != (Tile{0, 11}) || d != East {
		t.Fatalf("unexpected seam %v %v", b, d)
	}
	// A row boundary in the atlas is not the neighboring cube face.
	a = Tile{11, 7}
	b, d = g.Step(a, South)
	if b == (Tile{11, 8}) || g.Distance(a, b) != 1 {
		t.Fatalf("atlas seam treated as flat: %v", b)
	}
	if g.Distance(a, Tile{11, 8}) == 1 {
		t.Fatal("false atlas adjacency")
	}
}

func TestCompressedDistanceMatchesUncompressedBFS(t *testing.T) {
	for _, n := range []int{7, 12, 23} {
		g := Grid{n}
		for face := 0; face < 6; face++ {
			for _, local := range []Tile{{0, 0}, {n - 1, n / 2}, {n / 3, n / 2}} {
				a := Tile{face%3*n + local.X, face/3*n + local.Y}
				for b, want := range bfs(g, a) {
					if (b.X+g.Width()*b.Y)%11 != 0 {
						continue
					}
					if got := g.Distance(a, b); got != want {
						t.Fatalf("compressed N=%d %v->%v got %d want %d", n, a, b, got, want)
					}
				}
			}
		}
	}
}

func TestPolarCellsDoNotCollapse(t *testing.T) {
	g := Grid{128}
	min, max := math.Inf(1), 0.0
	for _, f := range []int{0, 1, 2, 3, 4, 5} {
		for _, i := range []int{0, 1, 63, 64, 126, 127} {
			for _, j := range []int{0, 1, 63, 64, 126, 127} {
				a := Tile{f%3*g.Size + i, f/3*g.Size + j}
				av := g.Normal(a)
				for d := North; d <= West; d++ {
					b, _ := g.Step(a, d)
					bv := g.Normal(b)
					length := math.Sqrt(math.Pow(av[0]-bv[0], 2) + math.Pow(av[1]-bv[1], 2) + math.Pow(av[2]-bv[2], 2))
					min = math.Min(min, length)
					max = math.Max(max, length)
				}
			}
		}
	}
	if max/min > 1.5 {
		t.Fatalf("collapsed cells: min=%g max=%g ratio=%g", min, max, max/min)
	}
}

func BenchmarkOppositeFaceDistance(b *testing.B) {
	g := Grid{64}
	for i := 0; i < b.N; i++ {
		g.Distance(Tile{32, 32}, Tile{160, 32})
	}
}

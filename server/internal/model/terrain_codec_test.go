package model

import (
	"testing"

	"siliconworld/internal/terrain"
)

func TestTerrainRunsCodecRoundTrip(t *testing.T) {
	ws := NewWorldState("planet", 4)
	// 6 行 × 12 列，写点有代表性的地形。
	ws.Grid[0][0].Terrain = terrain.TileWater
	ws.Grid[0][1].Terrain = terrain.TileWater
	ws.Grid[0][2].Terrain = terrain.TileBlocked
	ws.Grid[3][7].Terrain = terrain.TileLava
	ws.Grid[7][11].Terrain = terrain.TileBlocked

	encoded := TerrainRuns(ws.Grid, ws.MapWidth, ws.MapHeight)
	decoded, err := DecodeTerrainRuns(encoded, ws.MapWidth, ws.MapHeight)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(decoded) != ws.MapHeight || len(decoded[0]) != ws.MapWidth {
		t.Fatalf("shape mismatch: %dx%d", len(decoded), len(decoded[0]))
	}
	for y := 0; y < ws.MapHeight; y++ {
		for x := 0; x < ws.MapWidth; x++ {
			if decoded[y][x] != ws.Grid[y][x].Terrain {
				t.Fatalf("terrain mismatch at %d,%d: %s != %s", x, y, decoded[y][x], ws.Grid[y][x].Terrain)
			}
		}
	}
}

func TestTerrainRunsCodecEmptyIsAllBuildable(t *testing.T) {
	grid, err := DecodeTerrainRuns("", 6, 4)
	if err != nil {
		t.Fatalf("decode empty: %v", err)
	}
	for y := range grid {
		for x := range grid[y] {
			if grid[y][x] != terrain.TileBuildable {
				t.Fatalf("expected buildable at %d,%d, got %s", x, y, grid[y][x])
			}
		}
	}
	ws := NewWorldState("planet", 2)
	if encoded := TerrainRuns(ws.Grid, ws.MapWidth, ws.MapHeight); encoded != "2" {
		t.Fatalf("all-buildable grid should encode to the face-size header only, got %q", encoded)
	}
}

func TestTerrainRunsCodecRejectsMalformedPayloads(t *testing.T) {
	cases := []string{
		"zzz",         // 头部不是数字
		"3;0,0,1,w",   // 头部 face_size 与 6×4 不匹配
		"2;0,0",       // 游程字段不足
		"2;0,0,1,zzz", // 未知地形码
		"2;99,0,1,w",  // 行越界
		"2;0,99,1,w",  // 列越界
		"2;0,0,0,w",   // 游程长度为 0
		"2;0,11,3,w",  // 游程越过行尾
	}
	for _, payload := range cases {
		if _, err := DecodeTerrainRuns(payload, 6, 4); err == nil {
			t.Fatalf("expected error for payload %q", payload)
		}
	}
}

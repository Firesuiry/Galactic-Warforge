package model

import (
	"fmt"
	"strconv"
	"strings"

	"siliconworld/internal/terrain"
)

// terrainRunsCodec 把整幅地形编码成「非 buildable 格的行内游程」：
// 一行里 terrain 与上一个不同的位置记一条 {row, at, terrain}，默认 buildable。
//
// 细分网格后世界边长 ×3，地形是 6×face_size² 个 cell（遭遇战 49.8 万格），
// 整表逐格写进快照要 5.5MB（缩进后 7.7MB）——而地形只由地图配置与 seed 决定，
// 可由 mapgen 确定性重建。实测遭遇战地图非 buildable 格 11.9 万、行内游程
// 仅 2597 条，编码后约 77KB。
//
// 字符串格式（紧凑、确定性、便于快照里人眼排查）：
//
//	"faceSize:row,at,length,terrain;row,at,length,terrain;..."
//
// terrain 用它的首字母（b=blocked/w=water/l=lava），buildable 不出现。
type terrainRunsCodec struct{}

// TerrainRuns 编码地形游程；所有格都是 buildable 时返回空串。
func TerrainRuns(grid [][]MapTile, width, height int) string {
	var codec terrainRunsCodec
	return codec.Encode(grid, width, height)
}

// DecodeTerrainRuns 解码地形游程，返回 height×width 的完整地形表。空串表示全 buildable。
func DecodeTerrainRuns(encoded string, width, height int) ([][]terrain.TileType, error) {
	var codec terrainRunsCodec
	return codec.Decode(encoded, width, height)
}

// Encode 编码地形游程；所有格都是 buildable 时返回空串。
func (terrainRunsCodec) Encode(grid [][]MapTile, width, height int) string {
	if width <= 0 || height <= 0 {
		return ""
	}
	var b strings.Builder
	faceSize := width / 3
	fmt.Fprintf(&b, "%d", faceSize)
	for y := 0; y < height && y < len(grid); y++ {
		row := grid[y]
		prev := terrain.TileBuildable
		start := 0
		flush := func(at, length int, t terrain.TileType) {
			if t == terrain.TileBuildable || length <= 0 {
				return
			}
			b.WriteByte(';')
			b.WriteString(strconv.Itoa(y))
			b.WriteByte(',')
			b.WriteString(strconv.Itoa(at))
			b.WriteByte(',')
			b.WriteString(strconv.Itoa(length))
			b.WriteByte(',')
			b.WriteString(terrainRunCode(t))
		}
		for x := 0; x < width && x < len(row); x++ {
			cur := row[x].Terrain
			if cur != prev {
				flush(start, x-start, prev)
				prev = cur
				start = x
			}
		}
		flush(start, width-start, prev)
	}
	return b.String()
}

// Decode 解码地形游程，返回 height×width 的完整地形表。空串表示全 buildable。
func (terrainRunsCodec) Decode(encoded string, width, height int) ([][]terrain.TileType, error) {
	if width <= 0 || height <= 0 {
		return nil, fmt.Errorf("terrain grid size must be positive, got %dx%d", width, height)
	}
	grid := make([][]terrain.TileType, height)
	for y := range grid {
		row := make([]terrain.TileType, width)
		for x := range row {
			row[x] = terrain.TileBuildable
		}
		grid[y] = row
	}
	if encoded == "" {
		return grid, nil
	}
	head, runs, _ := strings.Cut(encoded, ";")
	faceSize, err := strconv.Atoi(head)
	if err != nil || faceSize < 1 || width != 3*faceSize || height != 2*faceSize {
		return nil, fmt.Errorf("terrain payload size mismatch: header %q vs atlas %dx%d", head, width, height)
	}
	for _, run := range strings.Split(runs, ";") {
		if run == "" {
			continue
		}
		fields := strings.Split(run, ",")
		if len(fields) != 4 {
			return nil, fmt.Errorf("malformed terrain run %q", run)
		}
		y, errY := strconv.Atoi(fields[0])
		x, errX := strconv.Atoi(fields[1])
		length, errLen := strconv.Atoi(fields[2])
		t, errT := parseTerrainRunCode(fields[3])
		if errY != nil || errX != nil || errLen != nil || errT != nil {
			return nil, fmt.Errorf("malformed terrain run %q", run)
		}
		if y < 0 || y >= height || x < 0 || length < 1 || x+length > width {
			return nil, fmt.Errorf("terrain run out of bounds: %q", run)
		}
		for i := 0; i < length; i++ {
			grid[y][x+i] = t
		}
	}
	return grid, nil
}

// terrainRunCode 是每种地形的单字符编码（buildable 不编码，故不在此列）。
func terrainRunCode(t terrain.TileType) string {
	switch t {
	case terrain.TileBlocked:
		return "b"
	case terrain.TileWater:
		return "w"
	case terrain.TileLava:
		return "l"
	default:
		return "?"
	}
}

func parseTerrainRunCode(code string) (terrain.TileType, error) {
	switch code {
	case "b":
		return terrain.TileBlocked, nil
	case "w":
		return terrain.TileWater, nil
	case "l":
		return terrain.TileLava, nil
	default:
		return "", fmt.Errorf("unknown terrain code %q", code)
	}
}

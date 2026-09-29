package query

import "math"

func sliceHeight(grid [][]float32, bounds SceneBounds) [][]float64 {
	if bounds.Width <= 0 || bounds.Height <= 0 || len(grid) == 0 {
		return nil
	}
	out := make([][]float64, 0, bounds.Height)
	for y := 0; y < bounds.Height; y++ {
		sourceY := bounds.Y + y
		if sourceY < 0 || sourceY >= len(grid) {
			break
		}
		row := grid[sourceY]
		if bounds.X < 0 || bounds.X >= len(row) {
			out = append(out, []float64{})
			continue
		}
		endX := bounds.X + bounds.Width
		if endX > len(row) {
			endX = len(row)
		}
		dst := make([]float64, endX-bounds.X)
		for i, v := range row[bounds.X:endX] {
			dst[i] = math.Round(float64(v)*1000) / 1000
		}
		out = append(out, dst)
	}
	return omitFlatHeight(out)
}

func maskHeightToExplored(height [][]float64, explored [][]bool) [][]float64 {
	if len(height) == 0 {
		return nil
	}
	if explored != nil {
		for y := range height {
			for x := range height[y] {
				if y >= len(explored) || x >= len(explored[y]) || !explored[y][x] {
					height[y][x] = 0
				}
			}
		}
	}
	return omitFlatHeight(height)
}

func omitFlatHeight(height [][]float64) [][]float64 {
	for _, row := range height {
		for _, v := range row {
			if v != 0 {
				return height
			}
		}
	}
	return nil
}

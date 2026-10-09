package model

import (
	"sync"
	"testing"
)

// TileKey 走惰性缓存：缓存内外、负坐标、并发首次填充都必须给出与旧实现相同的 "x,y"。
func TestTileKeyFormatAcrossCacheBoundary(t *testing.T) {
	cases := map[[2]int]string{
		{0, 0}:     "0,0",
		{17, 4}:    "17,4",
		{287, 191}: "287,191",
		{tileKeyCacheDim - 1, tileKeyCacheDim - 1}: "511,511",
		{tileKeyCacheDim, 3}:                       "512,3",
		{-1, 5}:                                    "-1,5",
		{4, -12}:                                   "4,-12",
	}
	for xy, want := range cases {
		for round := 0; round < 2; round++ { // 第二轮命中缓存
			if got := TileKey(xy[0], xy[1]); got != want {
				t.Fatalf("TileKey(%d,%d) round %d = %q, want %q", xy[0], xy[1], round, got, want)
			}
		}
	}
	if NewWorldState("p", 4).NextEntityID("b") != "b-1" {
		t.Fatal("NextEntityID must keep the prefix-counter format")
	}
}

func TestTileKeyConcurrentFill(t *testing.T) {
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for y := 300; y < 340; y++ {
				for x := 400; x < 440; x++ {
					if got := TileKey(x, y); got != itoaPair(x, y) {
						t.Errorf("TileKey(%d,%d) = %q", x, y, got)
						return
					}
				}
			}
		}()
	}
	wg.Wait()
}

func itoaPair(x, y int) string { return int64ToStr(int64(x)) + "," + int64ToStr(int64(y)) }

package mapmodel

import "testing"

func TestUniversePrimaryLookups(t *testing.T) {
	u := &Universe{
		Galaxies: map[string]*Galaxy{
			"g-1": {ID: "g-1", Name: "alpha"},
		},
		Systems: map[string]*System{
			"s-1": {ID: "s-1", GalaxyID: "g-1"},
		},
		Planets: map[string]*Planet{
			"p-1": {ID: "p-1", SystemID: "s-1"},
		},
		PrimaryGalaxyID: "g-1",
		PrimaryPlanetID: "p-1",
	}

	if got := u.PrimaryGalaxy(); got == nil || got.ID != "g-1" {
		t.Fatalf("expected primary galaxy g-1, got %+v", got)
	}
	if got := u.PrimaryPlanet(); got == nil || got.ID != "p-1" {
		t.Fatalf("expected primary planet p-1, got %+v", got)
	}
	if _, ok := u.System("s-1"); !ok {
		t.Fatal("expected system lookup to succeed")
	}
}

func TestSystemsLinkedByLane(t *testing.T) {
	// 直线四星系 s1—s2—s3—s4（等距 10），k=2 近邻航线规则：
	// 每系连最近 2 个邻居，任一端点名即成立。
	newLineUniverse := func() *Universe {
		systems := map[string]*System{}
		ids := []string{"s-1", "s-2", "s-3", "s-4"}
		for i, id := range ids {
			systems[id] = &System{
				ID:       id,
				GalaxyID: "g-1",
				Position: Vec2{X: float64(i) * 10, Y: 0},
			}
		}
		return &Universe{
			Galaxies: map[string]*Galaxy{
				"g-1": {ID: "g-1", SystemIDs: ids},
				"g-2": {ID: "g-2", SystemIDs: []string{"x-1"}},
			},
			Systems: systems,
		}
	}

	u := newLineUniverse()
	cases := []struct {
		from, to string
		linked   bool
	}{
		{"s-1", "s-2", true},  // 互为最近邻
		{"s-1", "s-3", true},  // s-1 的次近邻
		{"s-2", "s-4", true},  // s-4 的次近邻（反向点名成立）
		{"s-1", "s-4", false}, // 两端互不在对方最近 2 邻居内
		{"s-1", "s-1", false}, // 自身
		{"s-1", "s-9", false}, // 不存在
		{"s-9", "s-1", false},
	}
	for _, tc := range cases {
		if got := u.SystemsLinkedByLane(tc.from, tc.to, 2); got != tc.linked {
			t.Fatalf("SystemsLinkedByLane(%s, %s) = %v, want %v", tc.from, tc.to, got, tc.linked)
		}
	}

	// 跨银河：把 s-2 挪到 g-2 后不再连通
	u.Systems["s-2"].GalaxyID = "g-2"
	if u.SystemsLinkedByLane("s-1", "s-2", 2) {
		t.Fatal("expected cross-galaxy systems to be unlinked")
	}

	// 单星系银河没有任何航线
	u.Systems["s-2"].GalaxyID = "g-1"
	if u.SystemsLinkedByLane("s-1", "s-2", 0) {
		t.Fatal("expected neighborCount < 1 to be rejected")
	}
}

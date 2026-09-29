package model

// SettlementReport 终局结算报告（F2）：宣判胜利时聚合并冻结。
//
// 报告在宣判瞬间生成后不再随世界继续模拟而变化（终局后黑雾仍可能造成伤亡，
// 那些不计入本报告）。报告随 save.json runtime_state 持久化；回滚/回放经
// 快照重放宣判路径时按当时冻结的双边统计重建，保持确定性。
//
// 时间线引用只放 tick 指针（start_tick/declared_tick/duration_ticks），事件流
// 本体由 /events/snapshot 提供，不复制进报告。
type SettlementReport struct {
	WinnerID      string                  `json:"winner_id"`
	TeamID        string                  `json:"team_id,omitempty"`
	Reason        string                  `json:"reason"`
	VictoryRule   string                  `json:"victory_rule"`
	TechID        string                  `json:"tech_id,omitempty"`
	StartTick     int64                   `json:"start_tick"`
	DeclaredTick  int64                   `json:"declared_tick"`
	DurationTicks int64                   `json:"duration_ticks"`
	Players       []SettlementPlayerStats `json:"players"`
}

// SettlementPlayerStats 是结算报告中单个玩家宣判时刻冻结的战果/战损。
type SettlementPlayerStats struct {
	PlayerID           string `json:"player_id"`
	TeamID             string `json:"team_id,omitempty"`
	IsAlive            bool   `json:"is_alive"`
	Winner             bool   `json:"winner,omitempty"`
	UnitsKilled        int    `json:"units_killed"`
	UnitsLost          int    `json:"units_lost"`
	BuildingsDestroyed int    `json:"buildings_destroyed"`
	BuildingsLost      int    `json:"buildings_lost"`
}

// Clone 深拷贝结算报告。
func (r *SettlementReport) Clone() *SettlementReport {
	if r == nil {
		return nil
	}
	out := *r
	out.Players = append([]SettlementPlayerStats(nil), r.Players...)
	return &out
}

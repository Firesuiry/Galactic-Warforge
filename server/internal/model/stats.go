package model

// PlayerStats 玩家统计数据
type PlayerStats struct {
	PlayerID        string          `json:"player_id"`
	Tick            int64           `json:"tick"`
	ProductionStats ProductionStats `json:"production_stats"` // 生产统计
	EnergyStats     EnergyStats     `json:"energy_stats"`     // 能源统计
	LogisticsStats  LogisticsStats  `json:"logistics_stats"`  // 物流统计
	CombatStats     CombatStats     `json:"combat_stats"`     // 战斗统计
}

// ProductionStats 生产统计
type ProductionStats struct {
	TotalOutput    int            `json:"total_output"`     // 总产出
	ByBuildingType map[string]int `json:"by_building_type"` // 按建筑类型
	ByItem         map[string]int `json:"by_item"`          // 按物品类型
	Efficiency     float64        `json:"efficiency"`       // 平均效率
}

// EnergyStats 能源统计
type EnergyStats struct {
	Generation    int   `json:"generation"`     // 发电量
	Consumption   int   `json:"consumption"`    // 耗电量
	Storage       int   `json:"storage"`        // 储能容量
	CurrentStored int   `json:"current_stored"` // 当前储能
	ShortageTicks int64 `json:"shortage_ticks"` // 缺电tick数
}

// LogisticsStats 物流统计
type LogisticsStats struct {
	Throughput    int     `json:"throughput"`      // 吞吐量
	AvgDistance   float64 `json:"avg_distance"`    // 平均运输距离
	AvgTravelTime float64 `json:"avg_travel_time"` // 平均运输时间
	Deliveries    int     `json:"deliveries"`      // 配送次数
}

// CombatStats 战斗统计
//
// 战损口径（F2，双边计数）：
//   - 受害方是玩家实体（单位/编组小队/建筑）时计入受害方 losses；
//   - 击杀方是玩家且与受害方不同归属时计入击杀方 kills（dark_fog 击杀只计受害方损失，
//     不进任何玩家的 kills；玩家摧毁黑雾巢穴/黑雾单位不计入 kills，黑雾不是玩家实体）；
//   - 编组小队整编被毁计 1 个单位击杀/损失。
//
// 计数随 PlayerState 走快照 clone/restore，读档/回放一致。
type CombatStats struct {
	UnitsKilled        int `json:"units_killed"`        // 击杀单位数（含小队整编）
	UnitsLost          int `json:"units_lost"`          // 损失单位数
	BuildingsDestroyed int `json:"buildings_destroyed"` // 摧毁建筑数
	BuildingsLost      int `json:"buildings_lost"`      // 损失建筑数
	ThreatLevel        int `json:"threat_level"`        // 当前威胁等级
	HighestThreat      int `json:"highest_threat"`      // 最高威胁等级
}

// NewPlayerStats 创建玩家统计数据
func NewPlayerStats(playerID string) *PlayerStats {
	return &PlayerStats{
		PlayerID: playerID,
		ProductionStats: ProductionStats{
			ByBuildingType: make(map[string]int),
			ByItem:         make(map[string]int),
		},
		CombatStats: CombatStats{
			HighestThreat: 1,
		},
	}
}

package model

// PlayerStats 玩家统计数据
type PlayerStats struct {
	PlayerID       string        `json:"player_id"`
	Tick           int64         `json:"tick"`
	ProductionStats ProductionStats `json:"production_stats"` // 生产统计
	EnergyStats    EnergyStats   `json:"energy_stats"`      // 能源统计
	LogisticsStats LogisticsStats `json:"logistics_stats"`  // 物流统计
	CombatStats    CombatStats   `json:"combat_stats"`      // 战斗统计
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
	Generation     int   `json:"generation"`      // 发电量
	Consumption    int   `json:"consumption"`     // 耗电量
	Storage        int   `json:"storage"`         // 储能容量
	CurrentStored  int   `json:"current_stored"` // 当前储能
	ShortageTicks  int64 `json:"shortage_ticks"` // 缺电tick数
}

// LogisticsStats 物流统计
type LogisticsStats struct {
	Throughput    int     `json:"throughput"`     // 吞吐量
	AvgDistance   float64 `json:"avg_distance"`   // 平均运输距离
	AvgTravelTime float64 `json:"avg_travel_time"` // 平均运输时间
	Deliveries    int     `json:"deliveries"`     // 配送次数
}

// CombatStats 战斗统计
type CombatStats struct {
	UnitsLost     int `json:"units_lost"`      // 单位损失
	EnemiesKilled int `json:"enemies_killed"`  // 击杀敌人
	ThreatLevel   int `json:"threat_level"`    // 当前威胁等级
	HighestThreat int `json:"highest_threat"`   // 最高威胁等级
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
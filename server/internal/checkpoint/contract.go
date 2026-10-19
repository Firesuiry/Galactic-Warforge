package checkpoint

import "siliconworld/internal/model"

// 状态契约（checkpoint contract）：创建存档点时对当前世界做一次结构化断言。
// regression 存档点要求逐条通过才允许创建；bug 存档点只记录结果。
//
// 谓词词表（每条可选 player 字段；缺省针对全体玩家，任一玩家满足即通过）：
//
//	tick_gte            {tick}          当前 tick >= tick
//	tick_lt             {tick}          当前 tick < tick
//	game_not_finished   {}              对局未宣判结束
//	player_alive        {}              玩家存活
//	tech_researched     {tech_id}       已完成该科技（等级 > 0）
//	research_in_progress {tech_id?}     该玩家当前有进行中的研究；给了 tech_id 时还要求正在研究的就是它
//	research_progress_gte {tech_id?, n} 进行中的研究进度 >= n（证明研究在推进，不是卡在 waiting_matrix）
//	building_count_gte  {type, n}       存活建筑数 >= n
//	building_running_gte {type, n}      存活且 state=running 的建筑数 >= n
//	building_item_gte   {type, item_id, n} 玩家该类存活建筑的库存里该物品总数 >= n
//	building_item_at_gte {position, item_id, n} 该落点（锚点格）上玩家建筑的该物品 >= n
//	building_item_at_lt  {position, item_id, n} 该落点（锚点格）上玩家建筑的该物品 < n
//	building_no_alert_since {position, alert_type?, tick} 该落点建筑自 tick 起没有仍成立的该类生产告警
//	building_alert_since {position, alert_type, tick} 该落点建筑自 tick 起出现过且此刻仍成立的该类生产告警 >= 1
//	unit_count_gte      {type, n}       存活单位数 >= n（含机甲 executor）
//	unit_near           {position, radius, type?, n}  该玩家在 position 半径内的存活单位数 >= n
//	item_gte            {item_id, n}    玩家可用物资 >= n
//	no_alert_since      {alert_type, tick, type?}  从 tick 起没有该类型的生产告警
//	item_growth         {position, item_id, growth, advance_ticks?}（构建步骤，非契约）
//	dark_fog_hostile    {bool}          黑雾对该玩家是否敌对
//	dark_fog_calmed     {tick}          自 tick 起该玩家出现过 dark_fog_calmed（冷静期到期恢复中立）
//	enemy_attack_seen   {bool}          该玩家是否已被敌方玩家造成过伤害/损失
//
// 「玩家可用物资」口径：所有机甲背包之和（采矿、手搓、战利品都落这里，
// 也是 transfer / build 的扣料来源）。第 16 轮去掉资金维度后建造/升级只扣背包物品，
// 玩家级资源池只剩 resources.energy（电网结余的只读展示）。

// ContractCheck 是契约里的一条谓词。
type ContractCheck struct {
	Kind   string `json:"kind"`
	Player string `json:"player,omitempty"`

	Tick      int64  `json:"tick,omitempty"`
	TechID    string `json:"tech_id,omitempty"`
	Type      string `json:"type,omitempty"`
	N         int    `json:"n,omitempty"`
	ItemID    string `json:"item_id,omitempty"`
	AlertType string `json:"alert_type,omitempty"`
	// Position 是「按落点定位一台建筑」的锚点格（见 building_item_at_gte /
	// building_item_at_lt / building_no_alert_since）。用落点而不是建筑 ID：
	// 建筑 ID 是运行时分配的（b-121 这种），换一次重建就变了，写进构建记录
	// 会让契约在别的存档点里指到另一台机器。
	Position *model.Position `json:"position,omitempty"`
	Boolean  bool            `json:"bool,omitempty"`
	// Radius 是 unit_near 的搜索半径（格，按 cube-sphere 图距）。
	Radius int `json:"radius,omitempty"`
}

// Contract 是一份状态契约。
type Contract struct {
	Checks []ContractCheck `json:"checks"`
}

// ContractResult 是单条谓词的评估结果。
type ContractResult struct {
	Check  ContractCheck `json:"check"`
	Passed bool          `json:"passed"`
	Actual string        `json:"actual"`
	Detail string        `json:"detail,omitempty"`
}

// ContractReport 是整份契约的评估结果。
type ContractReport struct {
	Passed  bool             `json:"passed"`
	Results []ContractResult `json:"results"`
}

package checkpoint

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
//	building_count_gte  {type, n}       存活建筑数 >= n
//	unit_count_gte      {type, n}       存活单位数 >= n（含机甲 executor）
//	item_gte            {item_id, n}    玩家可用物资 >= n
//	dark_fog_hostile    {bool}          黑雾对该玩家是否敌对
//	enemy_attack_seen   {bool}          该玩家是否已被敌方玩家造成过伤害/损失
//
// 「玩家可用物资」口径：PlayerState.Inventory（就是机甲背包——采矿、手搓、战利品都落这里，
// 也是 transfer / build 的扣料来源）；minerals/energy 是资源池，不在物品背包里。

// ContractCheck 是契约里的一条谓词。
type ContractCheck struct {
	Kind   string `json:"kind"`
	Player string `json:"player,omitempty"`

	Tick    int64  `json:"tick,omitempty"`
	TechID  string `json:"tech_id,omitempty"`
	Type    string `json:"type,omitempty"`
	N       int    `json:"n,omitempty"`
	ItemID  string `json:"item_id,omitempty"`
	Boolean bool   `json:"bool,omitempty"`
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

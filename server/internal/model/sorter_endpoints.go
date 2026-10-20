package model

// 分拣器端点诊断（第 22 轮）：分拣器两端都有效才搬运，摆错时它静默不动、
// 也不报警。判定逻辑在 gamecore（sorterProbeEndpoint），这里只放随 inspect
// 下发的数据结构，让 query 不必依赖 gamecore（gamecore 的测试依赖 query）。

// 端点失败原因（写入 SorterEndpointView.Reason）。
const (
	SorterEndpointReasonNoBuilding       = "no_building"
	SorterEndpointReasonNotOwned         = "not_owned"
	SorterEndpointReasonBlockedBySorter  = "blocked_by_sorter"
	SorterEndpointReasonSplitter         = "splitter"
	SorterEndpointReasonConveyorInactive = "conveyor_inactive"
	SorterEndpointReasonConveyorSide     = "conveyor_rejects_side"
	SorterEndpointReasonNoPort           = "no_port"
	SorterEndpointReasonNoStorage        = "no_storage"
)

// SorterEndpointView 是 inspect 下发的单个端点诊断。
//
// 连上时给出 building_* / position / direction / steps；没连上时给出 reason，
// 若扫描轴上有建筑（挡住的那个）再给 blocker_* 与 steps。
type SorterEndpointView struct {
	BuildingID   string       `json:"building_id,omitempty"`
	BuildingType BuildingType `json:"building_type,omitempty"`
	BuildingName string       `json:"building_name,omitempty"`
	Position     *Position    `json:"position,omitempty"`
	Direction    string       `json:"direction,omitempty"`
	Steps        int          `json:"steps,omitempty"`
	// Pending 表示该端点来自尚未落成的施工任务（inspect 里不会出现，
	// 建造回执的预判会出现）。
	Pending bool   `json:"pending,omitempty"`
	Reason  string `json:"reason,omitempty"`
	// Blocker* 是没连上时扫描轴上第一个建筑（挡住的那个）。
	BlockerID       string       `json:"blocker_id,omitempty"`
	BlockerType     BuildingType `json:"blocker_type,omitempty"`
	BlockerName     string       `json:"blocker_name,omitempty"`
	BlockerPosition *Position    `json:"blocker_position,omitempty"`
}

// SorterEndpointsView 是分拣器两端诊断：pick = 背面取货端，drop = 正面放货端。
type SorterEndpointsView struct {
	Pick SorterEndpointView `json:"pick"`
	Drop SorterEndpointView `json:"drop"`
}

package model

// 运输机器人（§2）的路线与行程状态。
//
// 路线是玩家下达的持久意图（unit_order order=haul 写入），行程是每 tick 结算
// 推进的运行时状态；两者都挂在单位上，随单位快照/克隆一起存读档。

// HaulPhase 运输机器人的当前阶段。
type HaulPhase string

const (
	// HaulPhaseToSource 前往起点建筑外圈。
	HaulPhaseToSource HaulPhase = "to_source"
	// HaulPhaseLoading 已在起点外圈，正在装货。
	HaulPhaseLoading HaulPhase = "loading"
	// HaulPhaseToTarget 前往终点建筑外圈。
	HaulPhaseToTarget HaulPhase = "to_target"
	// HaulPhaseUnloading 已在终点外圈，正在卸货。
	HaulPhaseUnloading HaulPhase = "unloading"
	// HaulPhaseWaitingSource 起点暂时取不到货，在起点等。
	HaulPhaseWaitingSource HaulPhase = "waiting_source"
	// HaulPhaseWaitingTarget 终点暂时收不下，在终点等。
	HaulPhaseWaitingTarget HaulPhase = "waiting_target"
)

// UnitHaulState 运输机器人的路线与行程状态（unit JSON 的 haul 字段）。
//
// 路线字段（FromBuildingID/ToBuildingID/ItemID）由 haul 指令写入，
// 行程字段（Phase/Cargo/DeliveredTotal）由结算推进。
type UnitHaulState struct {
	FromBuildingID string     `json:"from_building_id"`
	ToBuildingID   string     `json:"to_building_id"`
	ItemID         string     `json:"item_id,omitempty"`
	Phase          HaulPhase  `json:"phase"`
	Cargo          ItemAmount `json:"cargo"`
	DeliveredTotal int        `json:"delivered_total"`
}

// Clone returns a deep copy of the haul state for read-only snapshots.
func (h *UnitHaulState) Clone() *UnitHaulState {
	if h == nil {
		return nil
	}
	out := *h
	return &out
}

// CargoQuantity 车上当前货物件数。
func (h *UnitHaulState) CargoQuantity() int {
	if h == nil || h.Cargo.Quantity <= 0 {
		return 0
	}
	return h.Cargo.Quantity
}

// Load 装货：只接受与车上货物同类（或空车时确定货种）且不超载的量。
func (h *UnitHaulState) Load(itemID string, quantity int) int {
	if h == nil || quantity <= 0 || itemID == "" {
		return 0
	}
	if h.Cargo.Quantity > 0 && h.Cargo.ItemID != itemID {
		return 0
	}
	if quantity > 0 {
		h.Cargo.ItemID = itemID
		h.Cargo.Quantity += quantity
	}
	return quantity
}

// Unload 卸货：卸空后清掉货种。
func (h *UnitHaulState) Unload(quantity int) {
	if h == nil || quantity <= 0 {
		return
	}
	h.Cargo.Quantity -= quantity
	if h.Cargo.Quantity <= 0 {
		h.Cargo = ItemAmount{}
	}
}

// ClearHaul 清空路线与行程（stop 指令、端点建筑消失时调用）。
func (h *UnitHaulState) ClearHaul() {
	if h == nil {
		return
	}
	h.FromBuildingID = ""
	h.ToBuildingID = ""
	h.ItemID = ""
	h.Phase = ""
	h.Cargo = ItemAmount{}
	h.DeliveredTotal = 0
}

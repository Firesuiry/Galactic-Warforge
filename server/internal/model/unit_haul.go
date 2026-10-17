package model

// 运输机器人（§2）的路线、模式与行程状态。
//
// 模式是玩家下达的持久意图（unit_order order=haul/auto_haul/stop 写入），
// 路线是固定路线模式下的往返端点，行程是每 tick 结算推进的运行时状态；
// 三者都挂在单位上，随单位快照/克隆一起存读档（含自动模式的在途认领 Claim，
// 读档后由机器人当前任务直接恢复，不需要额外重建）。

// HaulMode 运输机器人的模式（§2.1）。
type HaulMode string

const (
	// HaulModeAuto 全局自动模式（出厂默认）：按本行星需求/供给自动派单。
	HaulModeAuto HaulMode = "auto"
	// HaulModeRoute 固定路线模式：玩家用 unit_order order=haul 指定的往返路线。
	HaulModeRoute HaulMode = "route"
	// HaulModeIdle 待命：不接自动派单，也没有固定路线。
	HaulModeIdle HaulMode = "idle"
)

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
	// HaulPhaseIdle 没有任务：原地待命（自动模式无需求，或已被停止）。
	HaulPhaseIdle HaulPhase = "idle"
)

// HaulClaim 自动模式的一次在途认领（§2.1）：从 SupplyBuildingID 取 ItemID
// 送往 DemandBuildingID，数量 Quantity。
//
// SupplyBuildingID 为空表示「货已在车上」（上一条任务剩下的货改派，或端点消失后
// 回收的货）——需求端仍然成立，供给端不需要再去取。
type HaulClaim struct {
	SupplyBuildingID string `json:"supply_building_id,omitempty"`
	DemandBuildingID string `json:"demand_building_id"`
	ItemID           string `json:"item_id"`
	Quantity         int    `json:"quantity"`
}

// Clone returns a deep copy of the claim.
func (c *HaulClaim) Clone() *HaulClaim {
	if c == nil {
		return nil
	}
	out := *c
	return &out
}

// UnitHaulState 运输机器人的模式、路线与行程状态（unit JSON 的 haul 字段）。
//
// Mode 决定结算走哪条状态机（auto 自动派单 / route 固定路线 / idle 待命）；
// 路线字段（FromBuildingID/ToBuildingID/ItemID）在两种有任务模式下都是
// 「当前任务的取货建筑 → 送货建筑」（自动模式下由派单写入，供客户端画线）；
// 行程字段（Phase/Cargo/DeliveredTotal）由结算推进。
type UnitHaulState struct {
	Mode           HaulMode   `json:"mode"`
	FromBuildingID string     `json:"from_building_id"`
	ToBuildingID   string     `json:"to_building_id"`
	ItemID         string     `json:"item_id,omitempty"`
	Phase          HaulPhase  `json:"phase"`
	Cargo          ItemAmount `json:"cargo"`
	DeliveredTotal int        `json:"delivered_total"`
	// Claim 自动模式的在途认领（route/idle 模式下为空）。
	Claim *HaulClaim `json:"claim,omitempty"`
	// UnreachableAttempts / UnreachableSinceTick 自动模式连续「找不到落点或路径」
	// 的尝试次数与这段连续失败的起始 tick。成功规划出一条路就清零。
	UnreachableAttempts  int   `json:"unreachable_attempts,omitempty"`
	UnreachableSinceTick int64 `json:"unreachable_since_tick,omitempty"`
	// UnreachableCooldowns 本机器人对「到不了的建筑」的冷却（buildingID → 冷却结束
	// tick）：冷却期内派单跳过这些建筑，让机器人去服务别的需求。到得了之后自动删除。
	// 「任务中止」（端点不属于本玩家/消失等）也记在这张表里，避免同一座建筑被
	// 立刻重新选中形成 abort → 改派 → abort 的死循环。
	UnreachableCooldowns map[string]int64 `json:"unreachable_cooldowns,omitempty"`
	// IdleReason 自动模式空闲时「为什么没活干」（仅 mode=auto 且无任务时有值）：
	//   - no_demand：本行星己方没有缺料建筑，或唯一缺料的建筑都由分拣器喂料
	//     （这类建筑被有意排除在派单外，IdleDetail 会说明「缺料机器都由分拣器喂料」）；
	//   - cargo_no_destination：车上有货但没有任何需求、也没有能收下它的仓储；
	//   - no_reachable_demand：有需求（不是分拣器喂料的）但都到不了/没有可用供给
	//     （见 unreachable_cooldowns）；
	//   - last_aborted：上一单被中止（端点消失/不属于本玩家），详见 IdleDetail。
	// 客户端选中条据此说明机器人为什么空转（试玩 1016 一般 2）。
	IdleReason string `json:"idle_reason,omitempty"`
	// IdleDetail 空闲原因的补充文案（中文，例如上一单的中止原因）。
	IdleDetail string `json:"idle_detail,omitempty"`
}

// HaulIdleReason 自动模式空闲原因（unit haul.idle_reason）。
type HaulIdleReason string

const (
	HaulIdleNoDemand           HaulIdleReason = "no_demand"
	HaulIdleCargoNoDestination HaulIdleReason = "cargo_no_destination"
	HaulIdleNoReachableDemand  HaulIdleReason = "no_reachable_demand"
	HaulIdleLastAborted        HaulIdleReason = "last_aborted"
)

// SetIdleReason 记录空闲原因（自动模式空转时由派单/收尾路径写入）。
func (h *UnitHaulState) SetIdleReason(reason HaulIdleReason, detail string) {
	if h == nil {
		return
	}
	h.IdleReason = string(reason)
	h.IdleDetail = detail
}

// ClearIdleReason 有任务或重新派单时清掉空闲原因。
func (h *UnitHaulState) ClearIdleReason() {
	if h == nil {
		return
	}
	h.IdleReason = ""
	h.IdleDetail = ""
}

// Clone returns a deep copy of the haul state for read-only snapshots.
func (h *UnitHaulState) Clone() *UnitHaulState {
	if h == nil {
		return nil
	}
	out := *h
	out.Claim = h.Claim.Clone()
	if h.UnreachableCooldowns != nil {
		out.UnreachableCooldowns = make(map[string]int64, len(h.UnreachableCooldowns))
		for id, until := range h.UnreachableCooldowns {
			out.UnreachableCooldowns[id] = until
		}
	}
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

// ClearRoute 清空当前任务（端点、货种、阶段、认领），保留模式与车上货物。
// 端点建筑消失、供给取空、需求已满时调用：车上的货不能凭空消失（§2.1）。
func (h *UnitHaulState) ClearRoute() {
	if h == nil {
		return
	}
	h.FromBuildingID = ""
	h.ToBuildingID = ""
	h.ItemID = ""
	h.Phase = ""
	h.Claim = nil
	h.IdleReason = ""
	h.IdleDetail = ""
}

// ClearHaul 停止：清空当前任务并进入待命模式。车上货物保留（玩家重新下令后继续用）。
func (h *UnitHaulState) ClearHaul() {
	if h == nil {
		return
	}
	h.ClearRoute()
	h.Mode = HaulModeIdle
	h.DeliveredTotal = 0
}

// SetMode 切换模式并清空当前任务（模式切换总是从干净状态开始）。
func (h *UnitHaulState) SetMode(mode HaulMode) {
	if h == nil {
		return
	}
	h.ClearRoute()
	h.Mode = mode
	h.DeliveredTotal = 0
}

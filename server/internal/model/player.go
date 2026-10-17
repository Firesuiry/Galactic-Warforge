package model

import "strings"

// ExecutorState captures executor capability parameters and its unit reference.
type ExecutorState struct {
	RespawnAtTick   int64   `json:"respawn_at_tick,omitempty"`
	UnitID          string  `json:"unit_id"`
	BuildEfficiency float64 `json:"build_efficiency"`
	OperateRange    int     `json:"operate_range"`
	ConcurrentTasks int     `json:"concurrent_tasks"`
	ResearchBoost   float64 `json:"research_boost"`
}

// NewExecutorState builds a normalized executor state.
func NewExecutorState(unitID string, buildEfficiency float64, operateRange, concurrentTasks int, researchBoost float64) *ExecutorState {
	if buildEfficiency <= 0 {
		buildEfficiency = 1.0
	}
	if operateRange < 0 {
		operateRange = 0
	}
	if concurrentTasks <= 0 {
		concurrentTasks = 1
	}
	return &ExecutorState{
		UnitID:          unitID,
		BuildEfficiency: buildEfficiency,
		OperateRange:    operateRange,
		ConcurrentTasks: concurrentTasks,
		ResearchBoost:   researchBoost,
	}
}

func cloneExecutorState(exec *ExecutorState) *ExecutorState {
	if exec == nil {
		return nil
	}
	clone := *exec
	return &clone
}

// SetPlanetExecutor registers an executor for a specific planet.
func (ps *PlayerState) SetPlanetExecutor(planetID string, exec *ExecutorState) {
	if ps == nil || planetID == "" || exec == nil {
		return
	}
	if ps.Executors == nil {
		ps.Executors = make(map[string]*ExecutorState)
	}
	ps.Executors[planetID] = cloneExecutorState(exec)
}

// ExecutorForPlanet returns the executor bound to a planet.
func (ps *PlayerState) ExecutorForPlanet(planetID string) *ExecutorState {
	if ps == nil {
		return nil
	}
	return ps.Executors[planetID]
}

// SetPermissions normalizes and sets permissions on the player state.
func (ps *PlayerState) SetPermissions(perms []string) {
	ps.Permissions = normalizePermissions(perms)
	ps.permissionSet = buildPermissionSet(ps.Permissions)
}

// HasPermission checks whether a player has permission to issue a command type.
func (ps *PlayerState) HasPermission(cmdType CommandType) bool {
	if ps == nil {
		return false
	}
	if ps.permissionSet == nil {
		ps.permissionSet = buildPermissionSet(ps.Permissions)
	}
	if _, ok := ps.permissionSet["*"]; ok {
		return true
	}
	_, ok := ps.permissionSet[strings.ToLower(string(cmdType))]
	return ok
}

// EnsureInventory returns a writable inventory map.
func (ps *PlayerState) EnsureInventory() ItemInventory {
	if ps == nil {
		return nil
	}
	if ps.Inventory == nil {
		ps.Inventory = make(ItemInventory)
	}
	return ps.Inventory
}

// HasItems checks whether the player has the required item amounts.
func (ps *PlayerState) HasItems(cost []ItemAmount) bool {
	if len(cost) == 0 {
		return true
	}
	if ps == nil || ps.Inventory == nil {
		return false
	}
	for _, item := range cost {
		if item.Quantity <= 0 {
			continue
		}
		if ps.Inventory[item.ItemID] < item.Quantity {
			return false
		}
	}
	return true
}

// DeductItems removes item amounts from inventory if possible.
func (ps *PlayerState) DeductItems(cost []ItemAmount) bool {
	if len(cost) == 0 {
		return true
	}
	if !ps.HasItems(cost) {
		return false
	}
	inv := ps.EnsureInventory()
	for _, item := range cost {
		if item.Quantity <= 0 {
			continue
		}
		inv[item.ItemID] -= item.Quantity
		if inv[item.ItemID] <= 0 {
			delete(inv, item.ItemID)
		}
	}
	return true
}

// InventoryCount returns how many items the bag holds in total.
func (ps *PlayerState) InventoryCount() int {
	if ps == nil {
		return 0
	}
	total := 0
	for _, qty := range ps.Inventory {
		total += qty
	}
	return total
}

// InventorySlotsUsed 返回背包占用的格数：每种物品占 ceil(数量/该物品的单格上限)
// 格，再把各物品相加（DSP 机甲背包口径：格子数 + 每格按物品的堆叠上限）。
// 单格上限取 items.yaml 的 stack_limit；目录里查不到的物品按 1 格算（宁可多占）。
func (ps *PlayerState) InventorySlotsUsed() int {
	if ps == nil {
		return 0
	}
	slots := 0
	for id, qty := range ps.Inventory {
		if qty <= 0 {
			continue
		}
		slots += ItemSlots(id, qty)
	}
	return slots
}

// ItemSlots 返回 qty 件该物品占用的背包格数（向上取整到 stack_limit）。
func ItemSlots(itemID string, qty int) int {
	if qty <= 0 {
		return 0
	}
	def, ok := Item(itemID)
	if !ok || def.StackLimit <= 0 {
		return qty
	}
	return (qty + def.StackLimit - 1) / def.StackLimit
}

// AddItems adds item amounts to inventory and returns how many were accepted.
// slots > 0 是背包格数上限（本行星执行体的 inventory_slots）：按每件物品的
// stack_limit 折算占格，装不下的部分直接丢弃，任何调用方都不可能把背包顶到
// 上限之上（试玩 1014：手搓产出无视上限，背包 200/200 时搓出 1 个磁铁变成
// 201/200）。slots <= 0 表示不限。
func (ps *PlayerState) AddItems(items []ItemAmount, slots int) int {
	if len(items) == 0 || ps == nil {
		return 0
	}
	inv := ps.EnsureInventory()
	accepted := 0
	for _, item := range items {
		if item.Quantity <= 0 {
			continue
		}
		add := item.Quantity
		if slots > 0 {
			add = min(add, ps.InventoryFreeSlotsFor(item.ItemID, slots))
			if add <= 0 {
				continue
			}
		}
		inv[item.ItemID] += add
		accepted += add
	}
	return accepted
}

// InventoryFreeSlotsFor 返回在 slots 格上限下还能再装下多少件 itemID：
// 已有该物品时先用满当前那格剩余的堆叠空间，再按整格上限算剩余格数。
// slots <= 0 表示不限，返回 maxInt。
func (ps *PlayerState) InventoryFreeSlotsFor(itemID string, slots int) int {
	if slots <= 0 {
		return maxInt
	}
	free := slots - ps.InventorySlotsUsed()
	if free < 0 {
		free = 0
	}
	have := 0
	if ps != nil {
		have = ps.Inventory[itemID]
	}
	room := 0
	if def, ok := Item(itemID); ok && def.StackLimit > 0 && have > 0 {
		room = def.StackLimit - have%def.StackLimit
		if room == def.StackLimit {
			room = 0
		}
	}
	return room + free*stackSize(itemID)
}

// ItemStackSize 返回该物品单格可堆叠的数量（items.yaml 的 stack_limit；
// 目录缺失时按 1）。
func ItemStackSize(itemID string) int {
	if def, ok := Item(itemID); ok && def.StackLimit > 0 {
		return def.StackLimit
	}
	return 1
}

func stackSize(itemID string) int { return ItemStackSize(itemID) }

// EnsureWarBlueprints returns a writable blueprint map.
func (ps *PlayerState) EnsureWarBlueprints() map[string]*WarBlueprint {
	if ps == nil {
		return nil
	}
	if ps.WarBlueprints == nil {
		ps.WarBlueprints = make(map[string]*WarBlueprint)
	}
	return ps.WarBlueprints
}

// EnsureWarIndustry returns a writable warfare industry state.
func (ps *PlayerState) EnsureWarIndustry() *WarIndustryState {
	if ps == nil {
		return nil
	}
	if ps.WarIndustry == nil {
		ps.WarIndustry = &WarIndustryState{
			ProductionOrders: make(map[string]*WarProductionOrder),
			RefitOrders:      make(map[string]*WarRefitOrder),
			ProductionLines:  make(map[string]*WarProductionLineState),
			DeploymentHubs:   make(map[string]*WarDeploymentHubState),
		}
	}
	if ps.WarIndustry.ProductionOrders == nil {
		ps.WarIndustry.ProductionOrders = make(map[string]*WarProductionOrder)
	}
	if ps.WarIndustry.RefitOrders == nil {
		ps.WarIndustry.RefitOrders = make(map[string]*WarRefitOrder)
	}
	if ps.WarIndustry.ProductionLines == nil {
		ps.WarIndustry.ProductionLines = make(map[string]*WarProductionLineState)
	}
	if ps.WarIndustry.DeploymentHubs == nil {
		ps.WarIndustry.DeploymentHubs = make(map[string]*WarDeploymentHubState)
	}
	return ps.WarIndustry
}

// EnsureWarCoordination returns a writable warfare coordination state.
func (ps *PlayerState) EnsureWarCoordination() *WarCoordinationState {
	if ps == nil {
		return nil
	}
	if ps.WarCoordination == nil {
		ps.WarCoordination = &WarCoordinationState{
			TaskForces: make(map[string]*WarTaskForce),
			Theaters:   make(map[string]*WarTheater),
		}
	}
	if ps.WarCoordination.TaskForces == nil {
		ps.WarCoordination.TaskForces = make(map[string]*WarTaskForce)
	}
	if ps.WarCoordination.Theaters == nil {
		ps.WarCoordination.Theaters = make(map[string]*WarTheater)
	}
	return ps.WarCoordination
}

func normalizePermissions(perms []string) []string {
	if len(perms) == 0 {
		return nil
	}
	out := make([]string, 0, len(perms))
	seen := make(map[string]struct{}, len(perms))
	for _, p := range perms {
		p = strings.TrimSpace(strings.ToLower(p))
		if p == "" {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

func buildPermissionSet(perms []string) map[string]struct{} {
	set := make(map[string]struct{}, len(perms))
	for _, p := range perms {
		if p == "" {
			continue
		}
		set[p] = struct{}{}
	}
	return set
}

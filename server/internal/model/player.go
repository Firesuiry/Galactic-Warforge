package model

import "strings"

// ExecutorState captures executor capability parameters and its unit reference.
type ExecutorState struct {
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

// SetPlanetExecutor registers an executor for a specific planet and keeps the legacy field aligned.
func (ps *PlayerState) SetPlanetExecutor(planetID string, exec *ExecutorState) {
	if ps == nil || planetID == "" || exec == nil {
		return
	}
	if ps.Executors == nil {
		ps.Executors = make(map[string]*ExecutorState)
	}
	ps.Executors[planetID] = cloneExecutorState(exec)
	if ps.Executor == nil {
		ps.Executor = cloneExecutorState(exec)
	}
}

// ExecutorForPlanet returns the executor bound to a planet, falling back to the legacy field.
func (ps *PlayerState) ExecutorForPlanet(planetID string) *ExecutorState {
	if ps == nil {
		return nil
	}
	if ps.Executors != nil {
		if exec := ps.Executors[planetID]; exec != nil {
			return exec
		}
	}
	return ps.Executor
}

// SyncLegacyExecutor makes the legacy Executor field mirror the current planet context.
func (ps *PlayerState) SyncLegacyExecutor(planetID string) {
	if ps == nil {
		return
	}
	if exec := ps.ExecutorForPlanet(planetID); exec != nil {
		ps.Executor = cloneExecutorState(exec)
	}
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

// AddItems adds item amounts to inventory.
func (ps *PlayerState) AddItems(items []ItemAmount) {
	if len(items) == 0 || ps == nil {
		return
	}
	inv := ps.EnsureInventory()
	for _, item := range items {
		if item.Quantity <= 0 {
			continue
		}
		inv[item.ItemID] += item.Quantity
	}
}

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
